import { useCallback, useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Ban, Bot, Check, ExternalLink, Loader2, MessageCircle, Paperclip, Plus, Send, Sparkles, X } from 'lucide-react'
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
}

interface Confirmation {
  actionId: string
  summary: string
  toolName: string
  expiresAt: string
}

const GREETING: ChatMessage = {
  id: 'greeting',
  role: 'assistant',
  content: 'Olá! Posso consultar e operar estoque, retiradas, devoluções, colaboradores, obras e veículos. Toda alteração será mostrada para sua confirmação antes de executar.',
}

function messageId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
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

export function KimiAssistant() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const [open, setOpen] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([GREETING])
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [attachments, setAttachments] = useState<ChatAttachment[]>([])
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const storageKey = profile?.id ? `jamaaw-kimi-conversation:${profile.id}` : null

  useEffect(() => {
    if (!storageKey) return
    setConversationId(localStorage.getItem(storageKey))
    setLoaded(false)
  }, [storageKey])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [busy, confirmation, messages])

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
    if (!response.ok) throw new Error(data?.error || 'O assistente não conseguiu responder.')
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

  useEffect(() => {
    void loadHistory()
  }, [loadHistory])

  const rememberConversation = (id: string | null) => {
    setConversationId(id)
    if (!storageKey) return
    if (id) localStorage.setItem(storageKey, id)
    else localStorage.removeItem(storageKey)
  }

  const addAssistantResponse = (data: { message?: string; linkPath?: string | null }) => {
    if (!data.message) return
    setMessages((current) => [...current, {
      id: messageId(),
      role: 'assistant',
      content: data.message!,
      linkPath: data.linkPath,
    }])
  }

  const send = async () => {
    const message = input.trim()
    if ((!message && attachments.length === 0) || busy || confirmation) return
    setError(null)
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
      const data = await callAssistant({
        conversationId,
        message,
        attachments: sentAttachments,
      })
      if (data.conversationId) rememberConversation(data.conversationId)
      addAssistantResponse(data)
      setConfirmation(data.confirmation ?? null)
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : 'Falha ao enviar a mensagem.')
    } finally {
      setBusy(false)
    }
  }

  const answerConfirmation = async (approved: boolean) => {
    if (!confirmation || busy) return
    setBusy(true)
    setError(null)
    try {
      const data = await callAssistant({
        conversationId,
        confirmation: { actionId: confirmation.actionId, approved },
      })
      setConfirmation(null)
      addAssistantResponse(data)
    } catch (confirmationError) {
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
    setLoaded(true)
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          'fixed bottom-4 right-4 z-40 flex h-14 items-center gap-2 rounded-2xl border border-orange-300/25 bg-[linear-gradient(135deg,_#f97316,_#ea580c)] px-4 text-white shadow-[0_18px_50px_rgba(249,115,22,0.32)] transition-all hover:-translate-y-0.5 hover:shadow-[0_22px_60px_rgba(249,115,22,0.42)]',
          open && 'pointer-events-none translate-y-3 opacity-0',
        )}
        aria-label="Abrir assistente Kimi"
      >
        <MessageCircle size={22} />
        <span className="hidden text-sm font-semibold sm:inline">Assistente</span>
      </button>

      <aside
        className={cn(
          'fixed inset-0 z-[70] flex flex-col overflow-hidden border-white/10 bg-[#0d0e11] shadow-[0_30px_100px_rgba(0,0,0,0.58)] transition-all duration-300 sm:inset-auto sm:bottom-4 sm:right-4 sm:h-[min(720px,calc(100dvh-2rem))] sm:w-[440px] sm:rounded-[24px] sm:border',
          open ? 'translate-y-0 opacity-100 sm:translate-x-0' : 'pointer-events-none translate-y-full opacity-0 sm:translate-x-[110%] sm:translate-y-0',
        )}
        aria-hidden={!open}
      >
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-white/8 bg-[radial-gradient(circle_at_top_left,_rgba(249,115,22,0.18),_transparent_55%)] px-4">
          <div className="flex items-center gap-3">
            <div className="relative flex h-10 w-10 items-center justify-center rounded-xl border border-orange-300/20 bg-orange-500/12 text-orange-200">
              <Bot size={22} />
              <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-[#0d0e11] bg-emerald-400" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <h2 className="text-sm font-semibold text-white">Assistente JamaaW</h2>
                <Sparkles size={13} className="text-orange-300" />
              </div>
              <p className="text-[11px] text-gray-500">Kimi K3 · confirma antes de alterar</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button type="button" onClick={newConversation} className="rounded-lg p-2 text-gray-500 hover:bg-white/5 hover:text-white" aria-label="Nova conversa"><Plus size={18} /></button>
            <button type="button" onClick={() => setOpen(false)} className="rounded-lg p-2 text-gray-500 hover:bg-white/5 hover:text-white" aria-label="Fechar"><X size={19} /></button>
          </div>
        </header>

        <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-4">
          {messages.map((message) => (
            <div key={message.id} className={cn('flex', message.role === 'user' ? 'justify-end' : 'justify-start')}>
              <div className={cn(
                'max-w-[88%] rounded-2xl px-3.5 py-2.5 text-sm leading-5',
                message.role === 'user'
                  ? 'rounded-br-md bg-orange-500 text-white'
                  : 'rounded-bl-md border border-white/8 bg-white/[0.045] text-gray-200',
              )}>
                <p className="whitespace-pre-wrap">{message.content}</p>
                {message.linkPath && (
                  <button
                    type="button"
                    onClick={() => { navigate(message.linkPath!); setOpen(false) }}
                    className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-black/15 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-black/25"
                  >
                    Abrir registro <ExternalLink size={12} />
                  </button>
                )}
              </div>
            </div>
          ))}

          {busy && (
            <div className="flex justify-start">
              <div className="flex items-center gap-2 rounded-2xl rounded-bl-md border border-white/8 bg-white/[0.045] px-3 py-2 text-xs text-gray-400">
                <Loader2 size={14} className="animate-spin text-orange-300" />
                Consultando e validando…
              </div>
            </div>
          )}

          {confirmation && (
            <div className="rounded-2xl border border-orange-400/25 bg-orange-500/8 p-3">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-orange-200">
                <Sparkles size={14} /> Confirmação obrigatória
              </div>
              <p className="mt-2 text-sm leading-5 text-white">{confirmation.summary}</p>
              <p className="mt-2 text-[11px] text-gray-500">Nada foi alterado ainda.</p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void answerConfirmation(false)}
                  className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-gray-300 hover:bg-white/8"
                >
                  <Ban size={14} /> Cancelar
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void answerConfirmation(true)}
                  className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-orange-500 px-3 py-2 text-xs font-semibold text-white hover:bg-orange-400"
                >
                  <Check size={14} /> Confirmar
                </button>
              </div>
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-red-400/20 bg-red-500/8 px-3 py-2 text-xs leading-5 text-red-200">{error}</div>
          )}
        </div>

        <footer className="shrink-0 border-t border-white/8 bg-[#0a0b0d] p-3">
          {attachments.length > 0 && (
            <div className="mb-2 flex gap-1.5 overflow-x-auto pb-1">
              {attachments.map((attachment, index) => (
                <span key={`${attachment.name}-${index}`} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-white/8 bg-white/5 px-2 py-1 text-[11px] text-gray-300">
                  <Paperclip size={11} /> {attachment.name}
                  <button type="button" onClick={() => setAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index))} className="text-gray-600 hover:text-white"><X size={11} /></button>
                </span>
              ))}
            </div>
          )}
          <div className="flex items-end gap-2 rounded-2xl border border-white/10 bg-white/[0.045] p-2 focus-within:border-orange-400/35">
            <input ref={fileInputRef} type="file" multiple accept="image/*,.pdf,.doc,.docx,.txt,.csv" className="hidden" onChange={(event) => void handleFiles(event)} />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy || Boolean(confirmation)}
              className="rounded-xl p-2 text-gray-500 hover:bg-white/5 hover:text-white disabled:opacity-40"
              aria-label="Anexar arquivos"
            >
              <Paperclip size={18} />
            </button>
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleKeyDown}
              disabled={busy || Boolean(confirmation)}
              rows={1}
              placeholder={confirmation ? 'Confirme ou cancele a ação acima' : 'Peça uma consulta ou operação…'}
              className="max-h-28 min-h-[36px] flex-1 resize-none bg-transparent px-1 py-2 text-sm text-white outline-none placeholder:text-gray-600 disabled:opacity-50"
            />
            <button
              type="button"
              onClick={() => void send()}
              disabled={busy || Boolean(confirmation) || (!input.trim() && attachments.length === 0)}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-orange-500 text-white transition-colors hover:bg-orange-400 disabled:cursor-not-allowed disabled:bg-gray-800 disabled:text-gray-600"
              aria-label="Enviar"
            >
              <Send size={16} />
            </button>
          </div>
          <p className="mt-1.5 text-center text-[10px] text-gray-700">Revise as informações antes de confirmar qualquer alteração.</p>
        </footer>
      </aside>
    </>
  )
}
