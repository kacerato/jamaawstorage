import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ChangeEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Ban,
  BrainCircuit,
  Check,
  ChevronRight,
  Command,
  Database,
  Download,
  ExternalLink,
  FileText,
  Grip,
  Loader2,
  MemoryStick,
  MapPin,
  Paperclip,
  PackageCheck,
  Plus,
  Printer,
  Search,
  Send,
  ShieldCheck,
  X,
} from 'lucide-react'
import jamaawAssistant from '../../assets/jamaaw-assistant.png'
import { AssistantRichMessage } from './AssistantRichMessage'
import { createAssistantMessagePdfReport, downloadAssistantPdf, isAssistantPdfReport, type AssistantPdfReport } from './assistantPdf'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { cn } from '../../lib/utils'

interface ChatAttachment {
  name: string
  type: string
  size: number
  base64: string
}

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  linkPath?: string | null
  createdAt?: string
  pdfReport?: AssistantPdfReport | null
  withdrawalResult?: WithdrawalResult | null
}

interface WithdrawalResult {
  id: string
  code: string
  status: string
  itemCount: number
  destinationLabel: string
  linkPath: string
  printPath: string
}

interface Confirmation {
  actionId: string
  summary: string
  toolName: string
  expiresAt: string
}

interface AssistantMemory {
  id: string
  title: string
  content: string
  memory_type: 'fact' | 'preference' | 'procedure' | 'alias' | 'rule'
  trigger_terms: string[]
  tags: string[]
  importance: number
  is_pinned: boolean
  last_accessed_at: string | null
  updated_at: string
}

interface Position {
  x: number
  y: number
}

type AssistantView = 'operate' | 'memory'

const LAUNCHER_SIZE = 68
const POSITION_STORAGE_KEY = 'jamaaw-assistant-launcher-position'

const GREETING: ChatMessage = {
  id: 'greeting',
  role: 'assistant',
  content: 'Central pronta. Posso investigar dados, cruzar períodos e preparar operações em todo o JamaaW. Alterações continuam dependendo da sua confirmação.',
}

const QUICK_COMMANDS = [
  { label: 'Nova retirada', prompt: 'Quero fazer uma retirada. Conduza o preenchimento completo, confira os dados e prepare para minha autorização.', icon: PackageCheck },
  { label: 'Resumo do mês', prompt: 'Faça um resumo operacional completo deste mês.', icon: Database },
  { label: 'Estoque crítico', prompt: 'Quais itens estão abaixo ou próximos do estoque mínimo?', icon: Search },
  { label: 'Devoluções', prompt: 'Mostre as devoluções pendentes e o que precisa de decisão.', icon: FileText },
]

const MEMORY_LABELS: Record<AssistantMemory['memory_type'], string> = {
  fact: 'Fato',
  preference: 'Preferência',
  procedure: 'Procedimento',
  alias: 'Apelido',
  rule: 'Regra',
}

function messageId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function normalizeWithdrawalResult(value: unknown): WithdrawalResult | null {
  if (!value || typeof value !== 'object') return null
  const result = value as Record<string, unknown>
  if (
    typeof result.id !== 'string'
    || typeof result.code !== 'string'
    || typeof result.linkPath !== 'string'
    || typeof result.printPath !== 'string'
  ) return null

  return {
    id: result.id,
    code: result.code,
    status: typeof result.status === 'string' ? result.status : 'completed',
    itemCount: Number(result.itemCount || 0),
    destinationLabel: typeof result.destinationLabel === 'string' ? result.destinationLabel : 'Destino informado',
    linkPath: result.linkPath,
    printPath: result.printPath,
  }
}

function reservePrintWindow(): Window | null {
  const printWindow = window.open('', '_blank')
  if (!printWindow) return null
  printWindow.document.title = 'Preparando retirada — JAMAAW'
  printWindow.document.body.style.cssText = 'margin:0;min-height:100vh;display:grid;place-items:center;background:#171719;color:#f3f4f6;font:600 15px system-ui,sans-serif'
  printWindow.document.body.textContent = 'Criando a retirada e preparando o termo para impressão…'
  return printWindow
}

function clampPosition(position: Position): Position {
  if (typeof window === 'undefined') return position
  return {
    x: Math.max(12, Math.min(window.innerWidth - LAUNCHER_SIZE - 12, position.x)),
    y: Math.max(12, Math.min(window.innerHeight - LAUNCHER_SIZE - 12, position.y)),
  }
}

function initialPosition(): Position {
  if (typeof window === 'undefined') return { x: 24, y: 24 }
  try {
    const saved = JSON.parse(localStorage.getItem(POSITION_STORAGE_KEY) || 'null') as Position | null
    if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) return clampPosition(saved)
  } catch {
    // Posicao invalida volta ao ponto padrao.
  }
  return clampPosition({ x: window.innerWidth - LAUNCHER_SIZE - 20, y: window.innerHeight - LAUNCHER_SIZE - 20 })
}

async function fileToAttachment(file: File): Promise<ChatAttachment> {
  if (file.size > 4 * 1024 * 1024) throw new Error(`${file.name} excede o limite de 4 MB.`)
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
    reader.onerror = () => reject(new Error(`Não foi possível ler ${file.name}.`))
    reader.readAsDataURL(file)
  })
  return { name: file.name, type: file.type || 'application/octet-stream', size: file.size, base64 }
}

function Mascot({ className }: { className?: string }) {
  return (
    <div className={cn('relative overflow-hidden bg-surface', className)}>
      <img
        src={jamaawAssistant}
        alt=""
        className="absolute inset-0 h-full w-full scale-[1.68] object-cover object-center -translate-y-[10%]"
      />
    </div>
  )
}

export function KimiAssistant() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<AssistantView>('operate')
  const [loaded, setLoaded] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([GREETING])
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [attachments, setAttachments] = useState<ChatAttachment[]>([])
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)
  const [memories, setMemories] = useState<AssistantMemory[]>([])
  const [memoriesLoaded, setMemoriesLoaded] = useState(false)
  const [memoryBusy, setMemoryBusy] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [launcherPosition, setLauncherPosition] = useState<Position>(initialPosition)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; origin: Position; moved: boolean } | null>(null)

  const storageKey = profile?.id ? `jamaaw-kimi-conversation:${profile.id}` : null

  const panelPosition = useMemo(() => {
    if (typeof window === 'undefined') return { left: 12, top: 12, height: 720 }
    const width = 480
    const height = Math.min(760, window.innerHeight - 24)
    const preferredLeft = launcherPosition.x + LAUNCHER_SIZE / 2 > window.innerWidth / 2
      ? launcherPosition.x + LAUNCHER_SIZE - width
      : launcherPosition.x
    const preferredTop = launcherPosition.y + LAUNCHER_SIZE / 2 > window.innerHeight / 2
      ? launcherPosition.y + LAUNCHER_SIZE - height
      : launcherPosition.y
    return {
      left: Math.max(12, Math.min(window.innerWidth - width - 12, preferredLeft)),
      top: Math.max(12, Math.min(window.innerHeight - height - 12, preferredTop)),
      height,
    }
  }, [launcherPosition])

  const panelStyle = {
    '--assistant-left': `${panelPosition.left}px`,
    '--assistant-top': `${panelPosition.top}px`,
    '--assistant-height': `${panelPosition.height}px`,
  } as CSSProperties

  useEffect(() => {
    if (!storageKey) return
    setConversationId(localStorage.getItem(storageKey))
    setLoaded(false)
  }, [storageKey])

  useEffect(() => {
    const handleResize = () => setLauncherPosition((current) => clampPosition(current))
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  useEffect(() => {
    if (view === 'operate') {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
    }
  }, [busy, confirmation, messages, view])

  const callAssistant = useCallback(async (payload: Record<string, unknown>) => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.access_token) throw new Error('Sua sessão expirou. Entre novamente no app.')
    const response = await fetch('/api/kimi-assistant', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(payload),
    })
    const data = await response.json().catch(() => null)
    if (!response.ok) throw new Error(data?.error || 'O JAMAAW Assistente não conseguiu responder.')
    return data
  }, [])

  const loadHistory = useCallback(async () => {
    if (loaded || !open) return
    setLoaded(true)
    if (!conversationId) return
    setBusy(true)
    try {
      const data = await callAssistant({ conversationId, loadHistory: true })
      const history = (data.messages ?? [])
        .filter((message: { role: string }) => message.role === 'user' || message.role === 'assistant')
        .map((message: { id: string; role: 'user' | 'assistant'; content: string; metadata?: Record<string, unknown>; created_at: string }) => ({
          id: message.id,
          role: message.role,
          content: message.content,
          linkPath: typeof message.metadata?.link_path === 'string' ? message.metadata.link_path : null,
          pdfReport: isAssistantPdfReport(message.metadata?.pdf_report) ? message.metadata.pdf_report : null,
          withdrawalResult: normalizeWithdrawalResult(message.metadata?.withdrawal_result),
          createdAt: message.created_at,
        }))
      if (history.length) setMessages(history)
      setConfirmation(data.confirmation ?? null)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Não foi possível recuperar a conversa.')
    } finally {
      setBusy(false)
    }
  }, [callAssistant, conversationId, loaded, open])

  const loadMemories = useCallback(async () => {
    if (memoriesLoaded || memoryBusy || !open) return
    setMemoryBusy(true)
    try {
      const data = await callAssistant({ loadMemories: true })
      setMemories(data.memories ?? [])
      setMemoriesLoaded(true)
    } catch (memoryError) {
      setError(memoryError instanceof Error ? memoryError.message : 'Não foi possível carregar a memória.')
    } finally {
      setMemoryBusy(false)
    }
  }, [callAssistant, memoriesLoaded, memoryBusy, open])

  useEffect(() => {
    void loadHistory()
  }, [loadHistory])

  useEffect(() => {
    if (view === 'memory') void loadMemories()
  }, [loadMemories, view])

  const rememberConversation = (id: string | null) => {
    setConversationId(id)
    if (!storageKey) return
    if (id) localStorage.setItem(storageKey, id)
    else localStorage.removeItem(storageKey)
  }

  const addAssistantResponse = (data: { message?: string; linkPath?: string | null; pdfReport?: unknown; withdrawalResult?: unknown }) => {
    if (!data.message) return
    const pdfReport = isAssistantPdfReport(data.pdfReport) ? data.pdfReport : null
    setMessages((current) => [...current, {
      id: messageId(),
      role: 'assistant',
      content: data.message!,
      linkPath: data.linkPath,
      pdfReport,
      withdrawalResult: normalizeWithdrawalResult(data.withdrawalResult),
    }])
    if (pdfReport) {
      void downloadAssistantPdf(pdfReport).catch((pdfError) => {
        setError(pdfError instanceof Error ? pdfError.message : 'Não foi possível gerar o PDF.')
      })
    }
  }

  const send = async (overrideMessage?: string) => {
    const message = (overrideMessage ?? input).trim()
    if ((!message && attachments.length === 0) || busy || confirmation) return
    setView('operate')
    setError(null)
    setNotice(null)
    setBusy(true)
    setMessages((current) => [...current, {
      id: messageId(),
      role: 'user',
      content: message || `Anexei ${attachments.map((item) => item.name).join(', ')}.`,
    }])
    setInput('')
    const sentAttachments = attachments
    setAttachments([])

    try {
      const data = await callAssistant({ conversationId, message, attachments: sentAttachments })
      if (data.conversationId) rememberConversation(data.conversationId)
      addAssistantResponse(data)
      setConfirmation(data.confirmation ?? null)
      setMemoriesLoaded(false)
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : 'Falha ao enviar o comando.')
    } finally {
      setBusy(false)
    }
  }

  const answerConfirmation = async (approved: boolean) => {
    if (!confirmation || busy) return
    const expectsWithdrawalPrint = approved && confirmation.toolName === 'create_withdrawal'
    const printWindow = expectsWithdrawalPrint ? reservePrintWindow() : null
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const data = await callAssistant({
        conversationId,
        confirmation: { actionId: confirmation.actionId, approved },
      })
      setConfirmation(null)
      addAssistantResponse(data)
      const withdrawalResult = normalizeWithdrawalResult(data.withdrawalResult)
      if (printWindow && withdrawalResult) {
        printWindow.location.replace(new URL(withdrawalResult.printPath, window.location.origin).toString())
      } else {
        printWindow?.close()
        if (expectsWithdrawalPrint && withdrawalResult) {
          setNotice('A retirada foi criada, mas o navegador bloqueou a aba de impressão. Use “Imprimir termo” no cartão abaixo.')
        }
      }
    } catch (confirmationError) {
      printWindow?.close()
      setError(confirmationError instanceof Error ? confirmationError.message : 'Não foi possível concluir a confirmação.')
    } finally {
      setBusy(false)
    }
  }

  const handleFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []).slice(0, 3)
    event.target.value = ''
    if (!files.length) return
    setError(null)
    setNotice(null)
    try {
      const next = await Promise.all(files.map(fileToAttachment))
      setAttachments((current) => [...current, ...next].slice(0, 3))
    } catch (fileError) {
      setError(fileError instanceof Error ? fileError.message : 'Não foi possível anexar o arquivo.')
    }
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void send()
    }
  }

  const newConversation = () => {
    rememberConversation(null)
    setMessages([GREETING])
    setConfirmation(null)
    setAttachments([])
    setInput('')
    setError(null)
    setNotice(null)
    setLoaded(true)
    setView('operate')
  }

  const handleLauncherPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origin: launcherPosition,
      moved: false,
    }
  }

  const handleLauncherPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const deltaX = event.clientX - drag.startX
    const deltaY = event.clientY - drag.startY
    if (Math.hypot(deltaX, deltaY) > 5) drag.moved = true
    if (drag.moved) setLauncherPosition(clampPosition({ x: drag.origin.x + deltaX, y: drag.origin.y + deltaY }))
  }

  const handleLauncherPointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragRef.current = null
    if (drag.moved) {
      const finalPosition = clampPosition({
        x: drag.origin.x + event.clientX - drag.startX,
        y: drag.origin.y + event.clientY - drag.startY,
      })
      setLauncherPosition(finalPosition)
      localStorage.setItem(POSITION_STORAGE_KEY, JSON.stringify(finalPosition))
    } else {
      setOpen(true)
    }
  }

  const applyMemory = (memory: AssistantMemory) => {
    setInput(`Use a memória “${memory.title}” como contexto e `)
    setView('operate')
  }

  return (
    <>
      <button
        type="button"
        onPointerDown={handleLauncherPointerDown}
        onPointerMove={handleLauncherPointerMove}
        onPointerUp={handleLauncherPointerUp}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') setOpen(true)
        }}
        className={cn(
          'group fixed z-40 h-[68px] w-[68px] touch-none select-none rounded-none border border-line bg-surface p-1.5 transition-[opacity,transform] hover:scale-[1.04] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink',
          open && 'pointer-events-none scale-75 opacity-0',
        )}
        style={{ left: launcherPosition.x, top: launcherPosition.y }}
        aria-label="Abrir ou arrastar o JAMAAW Assistente"
        title="Clique para abrir · arraste para mover"
      >
        <Mascot className="h-full w-full rounded-none" />
        <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full border-2 border-[#181719] bg-blaze text-ink">
          <Grip size={10} />
        </span>
        <span className="absolute -bottom-1 -left-1 h-3.5 w-3.5 rounded-full border-[3px] border-[#181719] bg-emerald-400" />
      </button>

      <aside
        className={cn(
          'fixed inset-0 z-[70] flex flex-col overflow-hidden bg-void transition-[opacity,transform] duration-300 sm:inset-auto sm:left-[var(--assistant-left)] sm:top-[var(--assistant-top)] sm:h-[var(--assistant-height)] sm:w-[480px] sm:rounded-none sm:border sm:border-line',
          open ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-full opacity-0 sm:translate-y-6 sm:scale-95',
        )}
        style={panelStyle}
        aria-hidden={!open}
      >
        <div className="pointer-events-none absolute inset-x-0 top-0 h-44 bg-surface" />
        <header className="relative shrink-0 border-b border-line px-4 pb-3 pt-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <Mascot className="h-12 w-12 shrink-0 rounded-none border border-line" />
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="truncate text-base font-black tracking-[-0.02em] text-ink">JAMAAW Assistente</h2>
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                </div>
                <p className="mt-0.5 truncate text-[10px] font-semibold uppercase tracking-[0.18em] text-ink">Central operacional inteligente</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button type="button" onClick={newConversation} className="rounded-none p-2 text-ink-mute hover:bg-surface hover:text-ink" aria-label="Nova operação"><Plus size={18} /></button>
              <button type="button" onClick={() => setOpen(false)} className="rounded-none p-2 text-ink-mute hover:bg-surface hover:text-ink" aria-label="Fechar"><X size={19} /></button>
            </div>
          </div>

          <nav className="mt-3 grid grid-cols-2 gap-1 rounded-none bg-surface p-1" aria-label="Áreas do assistente">
            <button
              type="button"
              onClick={() => setView('operate')}
              className={cn('flex items-center justify-center gap-2 rounded-none px-3 py-2 text-xs font-semibold transition-colors', view === 'operate' ? 'bg-blaze text-ink' : 'text-ink-mute hover:text-ink')}
            >
              <Command size={14} /> Operar
            </button>
            <button
              type="button"
              onClick={() => setView('memory')}
              className={cn('flex items-center justify-center gap-2 rounded-none px-3 py-2 text-xs font-semibold transition-colors', view === 'memory' ? 'bg-blaze text-ink' : 'text-ink-mute hover:text-ink')}
            >
              <MemoryStick size={14} /> Memória {memories.length > 0 && <span className="rounded-none bg-void px-1.5 text-[10px]">{memories.length}</span>}
            </button>
          </nav>
        </header>

        {view === 'operate' ? (
          <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-y-auto px-4 py-4">
            {messages.length === 1 && messages[0].id === 'greeting' && (
              <section className="mb-5 overflow-hidden rounded-none border border-line bg-surface p-4">
                <div className="flex items-start gap-4">
                  <Mascot className="h-[74px] w-[74px] shrink-0 rounded-none border border-line" />
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-ink">Controle unificado</p>
                    <h3 className="mt-1 text-lg font-bold leading-tight text-ink">Pergunte, investigue ou prepare uma ação.</h3>
                    <p className="mt-2 text-xs leading-5 text-ink-dim">Consulto períodos completos no banco, recupero contexto da memória e mostro qualquer alteração antes de executar.</p>
                  </div>
                </div>
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  {QUICK_COMMANDS.map(({ label, prompt, icon: Icon }) => (
                    <button
                      key={label}
                      type="button"
                      onClick={() => void send(prompt)}
                      className="group flex items-center justify-between gap-2 rounded-none border border-line bg-void px-3 py-2.5 text-left text-[11px] font-medium text-ink-dim hover:border-ink-mute hover:bg-surface hover:text-ink"
                    >
                      <span className="flex items-center gap-2"><Icon size={13} className="text-ink" /> {label}</span>
                      <ChevronRight size={12} className="text-ink-mute group-hover:text-ink" />
                    </button>
                  ))}
                </div>
              </section>
            )}

            <div className="space-y-4">
              {messages.filter((message) => message.id !== 'greeting' || messages.length > 1).map((message) => (
                message.role === 'user' ? (
                  <div key={message.id} className="ml-8 flex items-start justify-end gap-2">
                    <div className="rounded-none border border-line bg-surface px-3.5 py-2.5 text-sm leading-5 text-ink">
                      <p className="whitespace-pre-wrap">{message.content}</p>
                    </div>
                    <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-none bg-blaze text-ink"><Command size={13} /></div>
                  </div>
                ) : (
                  <article key={message.id} className="overflow-hidden rounded-none border border-line bg-surface">
                    <div className="flex items-center gap-2 border-b border-line px-3 py-2">
                      <Mascot className="h-7 w-7 rounded-none" />
                      <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-ink">JAMAAW análise</span>
                      <span className="ml-auto flex items-center gap-1 text-[10px] text-ink-mute"><Database size={11} /> dados do app</span>
                    </div>
                    <div className="px-3.5 py-3 text-sm leading-6 text-ink-dim">
                      <AssistantRichMessage content={message.content} />
                      {message.withdrawalResult && (
                        <div className="mt-3 overflow-hidden rounded-none border border-ok bg-ok/[0.07]">
                          <div className="flex items-center gap-3 border-b border-ok px-3.5 py-3">
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-none bg-ok/15 text-ok"><PackageCheck size={18} /></div>
                            <div className="min-w-0">
                              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-ok">Retirada concluída</p>
                              <p className="truncate text-sm font-bold text-ink">{message.withdrawalResult.code}</p>
                            </div>
                            <span className="ml-auto rounded-none border border-ok bg-ok/15 px-2 py-1 text-[9px] font-bold uppercase text-ok">registrada</span>
                          </div>
                          <div className="grid grid-cols-2 gap-2 px-3.5 py-3 text-[11px] text-ink-dim">
                            <span className="flex items-center gap-1.5"><MapPin size={12} className="text-ink" /> <span className="truncate">{message.withdrawalResult.destinationLabel}</span></span>
                            <span className="text-right">{message.withdrawalResult.itemCount} {message.withdrawalResult.itemCount === 1 ? 'item' : 'itens'}</span>
                          </div>
                          <div className="grid grid-cols-2 gap-2 border-t border-line p-2.5">
                            <button
                              type="button"
                              onClick={() => { navigate(message.withdrawalResult!.linkPath); setOpen(false) }}
                              className="inline-flex items-center justify-center gap-1.5 rounded-none bg-blaze px-3 py-2.5 text-xs font-bold text-ink hover:bg-blaze"
                            >
                              Abrir retirada <ExternalLink size={12} />
                            </button>
                            <button
                              type="button"
                              onClick={() => window.open(message.withdrawalResult!.printPath, '_blank', 'noopener,noreferrer')}
                              className="inline-flex items-center justify-center gap-1.5 rounded-none border border-line bg-surface px-3 py-2.5 text-xs font-semibold text-ink-dim hover:border-ink-mute hover:bg-surface"
                            >
                              Imprimir termo <Printer size={13} />
                            </button>
                          </div>
                        </div>
                      )}
                      {(message.linkPath || message.role === 'assistant') && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {message.linkPath && !message.withdrawalResult && (
                            <button
                              type="button"
                              onClick={() => { navigate(message.linkPath!); setOpen(false) }}
                              className="inline-flex items-center gap-1.5 rounded-none border border-line bg-surface px-3 py-2 text-xs font-semibold text-ink hover:bg-surface"
                            >
                              Abrir no JamaaW <ExternalLink size={12} />
                            </button>
                          )}
                          {message.role === 'assistant' && !message.withdrawalResult && (
                            <button
                              type="button"
                              onClick={() => void downloadAssistantPdf(message.pdfReport ?? createAssistantMessagePdfReport(message.content)).catch((pdfError) => setError(pdfError instanceof Error ? pdfError.message : 'Não foi possível gerar o PDF.'))}
                              className="inline-flex items-center gap-1.5 rounded-none border border-line bg-surface px-3 py-2 text-xs font-semibold text-ink-dim hover:border-ink-mute hover:bg-surface hover:text-ink"
                            >
                              {message.pdfReport ? 'Baixar PDF novamente' : 'Exportar em PDF'} <Download size={13} />
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </article>
                )
              ))}

              {busy && (
                <div className="flex items-center gap-3 rounded-none border border-line bg-blaze/[0.06] px-3 py-3 text-xs text-ink-dim">
                  <div className="relative flex h-8 w-8 items-center justify-center rounded-none bg-surface text-ink"><Loader2 size={15} className="animate-spin" /></div>
                  <div><p className="font-semibold text-ink-dim">Investigando no JamaaW</p><p className="mt-0.5 text-[10px] text-ink-mute">Consultando fontes e validando o resultado…</p></div>
                </div>
              )}

              {confirmation && (
                <section className="rounded-none border border-line bg-surface p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-ink"><ShieldCheck size={15} /> Sua autorização</div>
                    <span className="rounded-none border border-line bg-void px-2 py-1 text-[9px] font-medium text-ink-mute">não executado</span>
                  </div>
                  <div className="mt-3 text-sm font-medium leading-6 text-ink"><AssistantRichMessage content={confirmation.summary} /></div>
                  <p className="mt-2 text-[11px] leading-4 text-ink-mute">Confira os dados. Uma confirmação autoriza somente esta operação.</p>
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <button type="button" disabled={busy} onClick={() => void answerConfirmation(false)} className="inline-flex items-center justify-center gap-1.5 rounded-none border border-line bg-surface px-3 py-2.5 text-xs font-semibold text-ink-dim hover:bg-surface"><Ban size={14} /> Cancelar</button>
                    <button type="button" disabled={busy} onClick={() => void answerConfirmation(true)} className="inline-flex items-center justify-center gap-1.5 rounded-none bg-blaze px-3 py-2.5 text-xs font-bold text-ink hover:bg-blaze"><Check size={14} /> {confirmation.toolName === 'create_withdrawal' ? 'Autorizar e imprimir' : 'Autorizar'}</button>
                  </div>
                </section>
              )}

              {notice && <div className="rounded-none border border-warn bg-warn/15 px-3 py-2 text-xs leading-5 text-warn">{notice}</div>}
              {error && <div className="rounded-none border border-crit bg-crit/15 px-3 py-2 text-xs leading-5 text-crit">{error}</div>}
            </div>
          </div>
        ) : (
          <div className="relative min-h-0 flex-1 overflow-y-auto px-4 py-4">
            <div className="mb-4 flex items-start gap-3 rounded-none border border-violet-300/10 bg-violet-400/[0.055] p-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-none bg-violet-400/10 text-violet-300"><BrainCircuit size={20} /></div>
              <div><h3 className="text-sm font-bold text-ink">Memória operacional</h3><p className="mt-1 text-xs leading-5 text-ink-mute">Fatos estáveis são recuperados por gatilhos. Dados atuais do app sempre têm prioridade.</p></div>
            </div>

            {memoryBusy ? (
              <div className="flex items-center justify-center gap-2 py-12 text-xs text-ink-mute"><Loader2 size={15} className="animate-spin text-ink" /> Recuperando memórias…</div>
            ) : memories.length === 0 ? (
              <div className="rounded-none border border-dashed border-line px-6 py-10 text-center">
                <MemoryStick size={28} className="mx-auto text-ink-mute" />
                <p className="mt-3 text-sm font-semibold text-ink-dim">Nenhuma memória criada ainda</p>
                <p className="mt-1 text-xs leading-5 text-ink-mute">Diga algo como “sempre considere bobina como bobina de fibra” ou descreva um procedimento recorrente.</p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {memories.map((memory) => (
                  <button
                    key={memory.id}
                    type="button"
                    onClick={() => applyMemory(memory)}
                    className="group w-full rounded-none border border-line bg-surface p-3.5 text-left hover:border-ink-mute hover:bg-blaze/[0.055]"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="rounded-none bg-violet-400/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-violet-300">{MEMORY_LABELS[memory.memory_type]}</span>
                          {memory.is_pinned && <span className="text-[9px] font-semibold text-ink">FIXADA</span>}
                        </div>
                        <h4 className="mt-2 text-sm font-semibold text-ink">{memory.title}</h4>
                      </div>
                      <div className="flex shrink-0 gap-0.5" title={`Importância ${memory.importance} de 5`}>
                        {Array.from({ length: 5 }, (_, index) => <span key={index} className={cn('h-1.5 w-1.5 rounded-full', index < memory.importance ? 'bg-blaze' : 'bg-surface')} />)}
                      </div>
                    </div>
                    <p className="mt-2 line-clamp-3 text-xs leading-5 text-ink-dim">{memory.content}</p>
                    {memory.trigger_terms.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {memory.trigger_terms.slice(0, 5).map((trigger) => <span key={trigger} className="rounded-none border border-line bg-void px-2 py-1 text-[9px] text-ink-mute">#{trigger}</span>)}
                      </div>
                    )}
                    <span className="mt-3 flex items-center gap-1 text-[10px] font-semibold text-ink transition-colors group-hover:text-ink">Usar como contexto <ChevronRight size={11} /></span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <footer className="relative shrink-0 border-t border-line bg-void p-3">
          {attachments.length > 0 && (
            <div className="mb-2 flex gap-1.5 overflow-x-auto pb-1">
              {attachments.map((attachment, index) => (
                <span key={`${attachment.name}-${index}`} className="inline-flex shrink-0 items-center gap-1.5 rounded-none border border-line bg-surface px-2 py-1 text-[11px] text-ink-dim">
                  <Paperclip size={11} /> {attachment.name}
                  <button type="button" onClick={() => setAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index))} className="text-ink-mute hover:text-ink"><X size={11} /></button>
                </span>
              ))}
            </div>
          )}
          <div className="flex items-end gap-2 rounded-none border border-line bg-surface p-2 shadow-inner focus-within:border-line focus-within:bg-blaze/[0.035]">
            <input ref={fileInputRef} type="file" multiple accept="image/*,.pdf,.doc,.docx,.txt,.csv" className="hidden" onChange={(event) => void handleFiles(event)} />
            <button type="button" onClick={() => fileInputRef.current?.click()} disabled={busy || Boolean(confirmation)} className="rounded-none p-2 text-ink-mute hover:bg-surface hover:text-ink disabled:opacity-40" aria-label="Anexar arquivos"><Paperclip size={18} /></button>
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleKeyDown}
              onFocus={() => setView('operate')}
              disabled={busy || Boolean(confirmation)}
              rows={1}
              placeholder={confirmation ? 'Autorize ou cancele a operação acima' : 'Digite um comando para o JamaaW…'}
              className="max-h-28 min-h-[36px] flex-1 resize-none bg-transparent px-1 py-2 text-sm text-ink outline-none placeholder:text-ink-mute disabled:opacity-50"
            />
            <button type="button" onClick={() => void send()} disabled={busy || Boolean(confirmation) || (!input.trim() && attachments.length === 0)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-none bg-blaze text-ink transition-colors hover:bg-blaze disabled:cursor-not-allowed disabled:bg-surface disabled:text-ink-mute" aria-label="Executar comando"><Send size={16} /></button>
          </div>
        </footer>
      </aside>
    </>
  )
}
