import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from 'react'
import { Camera, Car, FileText, Fuel, Gauge, Plus, UserRound, Warehouse } from 'lucide-react'
import type { Tables } from '../../types/database'
import { supabase } from '../../lib/supabase'
import { uploadFileToStorage, uploadImageToStorage } from '../../lib/storage'
import { DEFAULT_IMAGE_UPLOAD_OPTIONS, formatDateTime } from '../../lib/utils'
import { Alert, Badge, Button, Card, EmptyState, Input, Modal, Select, Spinner } from '../../components/ui'

type PersonRow = Tables<'people'>
type VehicleEventType = 'pickup' | 'return' | 'fuel'
type FuelLevelRange = 'reserva' | 'baixo' | 'meio' | 'alto' | 'cheio'

interface VehicleRow {
  id: string
  code: string
  plate: string | null
  model: string
  color: string | null
  year: number | null
  responsible_person_id: string | null
  photo_url: string | null
  document_url: string | null
  document_name: string | null
  notes: string | null
  is_active: boolean
  created_by: string | null
  created_at: string
  updated_at: string
  responsible_person?: Pick<PersonRow, 'id' | 'full_name' | 'employee_id'> | null
}

interface VehicleLogRow {
  id: string
  vehicle_id: string
  responsible_person_id: string | null
  event_type: VehicleEventType
  occurred_at: string
  odometer_km: number | null
  fuel_level_percent: number | null
  fuel_level_range: FuelLevelRange | null
  fuel_liters: number | null
  fuel_amount: number | null
  station_name: string | null
  photo_url: string | null
  ocr_text: string | null
  ai_summary: string | null
  ai_confidence: number | null
  needs_review: boolean
  notes: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  responsible_person?: Pick<PersonRow, 'id' | 'full_name' | 'employee_id'> | null
}

interface VehicleFormState {
  code: string
  plate: string
  model: string
  color: string
  year: string
  responsible_person_id: string
  photo_url: string | null
  document_url: string | null
  document_name: string | null
  notes: string
}

interface LogFormState {
  event_type: VehicleEventType
  photo_url: string | null
  odometer_km: string
  fuel_level_percent: string
  fuel_level_range: FuelLevelRange | ''
  fuel_bars_filled: string
  fuel_bars_total: string
  fuel_liters: string
  fuel_amount: string
  station_name: string
  notes: string
  ocr_text: string | null
  ai_summary: string | null
  ai_confidence: number | null
  needs_review: boolean
}

interface UntypedQueryBuilder {
  select: (query?: string) => UntypedQueryBuilder
  insert: (payload: unknown) => PromiseLike<{ error: { message: string } | null }>
  order: (column: string, options?: unknown) => PromiseLike<unknown>
  eq: (column: string, value: unknown) => UntypedQueryBuilder
}

const initialVehicleForm: VehicleFormState = {
  code: 'JAMAAW-T30-01',
  plate: '',
  model: 'Shineray TLux T30 2025',
  color: '',
  year: '2025',
  responsible_person_id: '',
  photo_url: null,
  document_url: null,
  document_name: null,
  notes: '',
}

const initialLogForm: LogFormState = {
  event_type: 'pickup',
  photo_url: null,
  odometer_km: '',
  fuel_level_percent: '',
  fuel_level_range: '',
  fuel_bars_filled: '',
  fuel_bars_total: '',
  fuel_liters: '',
  fuel_amount: '',
  station_name: '',
  notes: '',
  ocr_text: null,
  ai_summary: null,
  ai_confidence: null,
  needs_review: false,
}

function eventLabel(type: VehicleEventType): string {
  if (type === 'pickup') return 'Saida'
  if (type === 'return') return 'Chegada'
  return 'Abastecimento'
}

function eventDescription(type: VehicleEventType): string {
  if (type === 'pickup') return 'Foto antes de sair do galpao, com km e combustivel visiveis.'
  if (type === 'return') return 'Foto ao chegar no galpao, repetindo km e combustivel.'
  return 'Foto do painel, bomba ou comprovante para registrar abastecimento.'
}

function fuelRangeLabel(range: FuelLevelRange | '' | null): string {
  if (range === 'reserva') return 'Reserva'
  if (range === 'baixo') return 'Baixo'
  if (range === 'meio') return 'Meio tanque'
  if (range === 'alto') return 'Alto'
  if (range === 'cheio') return 'Cheio'
  return '-'
}

function numericOrNull(value: string): number | null {
  const parsed = Number.parseFloat(value.replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : null
}

function integerOrNull(value: string): number | null {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : null
}

export function VehiclesPage() {
  const db = useMemo(() => supabase as unknown as { from: (table: string) => UntypedQueryBuilder }, [])
  const [vehicles, setVehicles] = useState<VehicleRow[]>([])
  const [logs, setLogs] = useState<VehicleLogRow[]>([])
  const [people, setPeople] = useState<PersonRow[]>([])
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [savingVehicle, setSavingVehicle] = useState(false)
  const [savingLog, setSavingLog] = useState(false)
  const [analyzingImage, setAnalyzingImage] = useState(false)
  const [showVehicleModal, setShowVehicleModal] = useState(false)
  const [showLogModal, setShowLogModal] = useState(false)
  const [vehicleForm, setVehicleForm] = useState<VehicleFormState>(initialVehicleForm)
  const [logForm, setLogForm] = useState<LogFormState>(initialLogForm)
  const [error, setError] = useState<string | null>(null)

  const selectedVehicle = useMemo(
    () => vehicles.find((vehicle) => vehicle.id === selectedVehicleId) ?? vehicles[0] ?? null,
    [selectedVehicleId, vehicles],
  )

  const selectedLogs = useMemo(
    () => logs.filter((log) => log.vehicle_id === selectedVehicle?.id),
    [logs, selectedVehicle?.id],
  )

  const isFuelLog = logForm.event_type === 'fuel'

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [vehicleResult, logsResult, peopleResult] = await Promise.all([
        (db.from('vehicles').select('*, responsible_person:people!vehicles_responsible_person_id_fkey(id, full_name, employee_id)') as unknown as PromiseLike<{ data: VehicleRow[] | null; error: { message: string } | null }>),
        (db.from('vehicle_usage_logs').select('*, responsible_person:people!vehicle_usage_logs_responsible_person_id_fkey(id, full_name, employee_id)').order('occurred_at', { ascending: false }) as unknown as PromiseLike<{ data: VehicleLogRow[] | null; error: { message: string } | null }>),
        supabase
          .from('people')
          .select('id, full_name, employee_id, profile_id, role, job_title, sector, cpf, photo_url, document_attachments, is_active, created_at, updated_at')
          .eq('is_active', true)
          .order('full_name', { ascending: true }),
      ])

      if (vehicleResult.error) throw new Error(vehicleResult.error.message)
      if (logsResult.error) throw new Error(logsResult.error.message)
      if (peopleResult.error) throw new Error(peopleResult.error.message)

      setVehicles(vehicleResult.data ?? [])
      setLogs(logsResult.data ?? [])
      setPeople((peopleResult.data as PersonRow[]) ?? [])
      setSelectedVehicleId((current) => current ?? vehicleResult.data?.[0]?.id ?? null)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Nao foi possivel carregar os veiculos.')
    } finally {
      setLoading(false)
    }
  }, [db])

  useEffect(() => {
    void load()
  }, [load])

  const peopleOptions = people.map((person) => ({
    value: person.id,
    label: person.employee_id ? `${person.full_name} (${person.employee_id})` : person.full_name,
  }))

  const handleVehiclePhoto = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      const url = await uploadImageToStorage({
        file,
        scope: 'vehicles/photos',
        entityId: vehicleForm.code || 'novo-veiculo',
        options: DEFAULT_IMAGE_UPLOAD_OPTIONS,
      })
      setVehicleForm((prev) => ({ ...prev, photo_url: url }))
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Nao foi possivel enviar a foto do veiculo.')
    } finally {
      event.target.value = ''
    }
  }

  const handleVehicleDocument = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      const url = await uploadFileToStorage({
        file,
        scope: 'vehicles/documents',
        entityId: vehicleForm.code || 'novo-veiculo',
      })
      setVehicleForm((prev) => ({ ...prev, document_url: url, document_name: file.name }))
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Nao foi possivel enviar o documento.')
    } finally {
      event.target.value = ''
    }
  }

  const handleSaveVehicle = async () => {
    if (!vehicleForm.code.trim() || !vehicleForm.model.trim()) {
      setError('Informe codigo e modelo do veiculo.')
      return
    }

    setSavingVehicle(true)
    setError(null)
    try {
      const payload = {
        code: vehicleForm.code.trim(),
        plate: vehicleForm.plate.trim() || null,
        model: vehicleForm.model.trim(),
        color: vehicleForm.color.trim() || null,
        year: integerOrNull(vehicleForm.year),
        responsible_person_id: vehicleForm.responsible_person_id || null,
        photo_url: vehicleForm.photo_url,
        document_url: vehicleForm.document_url,
        document_name: vehicleForm.document_name,
        notes: vehicleForm.notes.trim() || null,
      }
      const result = await (db.from('vehicles').insert(payload) as PromiseLike<{ error: { message: string } | null }>)
      if (result.error) throw new Error(result.error.message)

      setShowVehicleModal(false)
      setVehicleForm(initialVehicleForm)
      await load()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Nao foi possivel cadastrar o veiculo.')
    } finally {
      setSavingVehicle(false)
    }
  }

  const handleLogPhoto = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file || !selectedVehicle) return

    setAnalyzingImage(true)
    setError(null)
    try {
      const storageUrl = await uploadImageToStorage({
        file,
        scope: 'vehicles/logs',
        entityId: selectedVehicle.id,
        options: DEFAULT_IMAGE_UPLOAD_OPTIONS,
      })
      const analysisResponse = await fetch('/api/vehicle-image-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: storageUrl, eventType: logForm.event_type }),
      })
      const analysis = await analysisResponse.json().catch(() => null)
      if (!analysisResponse.ok) {
        setLogForm((prev) => ({ ...prev, photo_url: storageUrl }))
        throw new Error(analysis?.error || 'Nao foi possivel analisar a imagem.')
      }

      setLogForm((prev) => ({
        ...prev,
        photo_url: storageUrl,
        odometer_km: analysis.odometerKm != null ? String(analysis.odometerKm) : prev.odometer_km,
        fuel_level_percent: analysis.fuelLevelPercent != null ? String(analysis.fuelLevelPercent) : prev.fuel_level_percent,
        fuel_level_range: analysis.fuelLevelRange ?? prev.fuel_level_range,
        fuel_bars_filled: analysis.fuelBarsFilled != null ? String(analysis.fuelBarsFilled) : prev.fuel_bars_filled,
        fuel_bars_total: analysis.fuelBarsTotal != null ? String(analysis.fuelBarsTotal) : prev.fuel_bars_total,
        fuel_liters: analysis.fuelLiters != null ? String(analysis.fuelLiters) : prev.fuel_liters,
        fuel_amount: analysis.fuelAmount != null ? String(analysis.fuelAmount) : prev.fuel_amount,
        station_name: analysis.stationName ?? prev.station_name,
        ocr_text: analysis.ocrText ?? null,
        ai_summary: analysis.summary ?? null,
        ai_confidence: analysis.confidence ?? null,
        needs_review: Boolean(analysis.needsReview),
      }))
    } catch (uploadError) {
      setError(uploadError instanceof Error
        ? `${uploadError.message} A foto ficou anexada; revise os campos e salve manualmente se necessario.`
        : 'Nao foi possivel processar a foto do registro. A foto ficou anexada; revise os campos e salve manualmente se necessario.')
    } finally {
      setAnalyzingImage(false)
      event.target.value = ''
    }
  }

  const handleSaveLog = async () => {
    if (!selectedVehicle) return
    if (!logForm.photo_url) {
      setError('Anexe a foto da kilometragem, combustivel ou abastecimento antes de salvar.')
      return
    }

    setSavingLog(true)
    setError(null)
    try {
      const payload = {
        vehicle_id: selectedVehicle.id,
        responsible_person_id: selectedVehicle.responsible_person_id,
        event_type: logForm.event_type,
        odometer_km: numericOrNull(logForm.odometer_km),
        fuel_level_percent: integerOrNull(logForm.fuel_level_percent),
        fuel_level_range: logForm.fuel_level_range || null,
        fuel_liters: numericOrNull(logForm.fuel_liters),
        fuel_amount: numericOrNull(logForm.fuel_amount),
        station_name: logForm.station_name.trim() || null,
        photo_url: logForm.photo_url,
        ocr_text: logForm.ocr_text,
        ai_summary: logForm.ai_summary,
        ai_confidence: logForm.ai_confidence,
        needs_review: logForm.needs_review,
        notes: logForm.notes.trim() || null,
      }
      const result = await (db.from('vehicle_usage_logs').insert(payload) as PromiseLike<{ error: { message: string } | null }>)
      if (result.error) throw new Error(result.error.message)

      setShowLogModal(false)
      setLogForm(initialLogForm)
      await load()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Nao foi possivel salvar o registro do carro.')
    } finally {
      setSavingLog(false)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[420px] items-center justify-center">
        <Spinner />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Carros JamaaW</h1>
          <p className="mt-1 text-sm text-gray-400">Cadastro, responsavel, kilometragem, combustivel e abastecimentos com evidencia por foto.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setShowVehicleModal(true)} leftIcon={<Plus size={16} />}>
            Cadastrar carro
          </Button>
          <Button onClick={() => setShowLogModal(true)} disabled={!selectedVehicle} leftIcon={<Camera size={16} />}>
            Registrar uso
          </Button>
        </div>
      </div>

      {error ? <Alert variant="danger">{error}</Alert> : null}

      {vehicles.length === 0 ? (
        <EmptyState
          icon={<Car size={48} />}
          title="Nenhum carro cadastrado"
          description="Cadastre o Shineray TLux T30 2025 e defina a pessoa responsavel pelo controle."
          action={{ label: 'Cadastrar carro', onClick: () => setShowVehicleModal(true) }}
        />
      ) : (
        <div className="grid gap-5 xl:grid-cols-[420px_minmax(0,1fr)]">
          <div className="space-y-4">
            {vehicles.map((vehicle) => (
              <button key={vehicle.id} type="button" onClick={() => setSelectedVehicleId(vehicle.id)} className="w-full text-left">
                <Card variant="bordered" className={`overflow-hidden border-white/8 ${selectedVehicle?.id === vehicle.id ? 'bg-orange-500/10' : 'bg-white/3'}`}>
                  <div className="grid grid-cols-[112px_minmax(0,1fr)] gap-4">
                    <div className="aspect-[3/4] overflow-hidden rounded-2xl border border-white/10 bg-black/30">
                      {vehicle.photo_url ? (
                        <img src={vehicle.photo_url} alt={vehicle.model} className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full items-center justify-center text-orange-200"><Car size={42} /></div>
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="text-[11px] uppercase tracking-[0.22em] text-orange-200/70">Carteira digital</p>
                      <h2 className="mt-1 truncate text-lg font-semibold text-white">{vehicle.code}</h2>
                      <p className="mt-1 text-sm text-gray-300">{vehicle.model}</p>
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <MiniMetric label="Placa" value={vehicle.plate ?? '-'} />
                        <MiniMetric label="Ano" value={vehicle.year ? String(vehicle.year) : '-'} />
                      </div>
                      <div className="mt-3 flex items-center gap-2 text-xs text-gray-400">
                        <UserRound size={14} />
                        <span className="truncate">{vehicle.responsible_person?.full_name ?? 'Sem responsavel'}</span>
                      </div>
                    </div>
                  </div>
                </Card>
              </button>
            ))}
          </div>

          {selectedVehicle ? (
            <Card variant="bordered" className="border-white/8 bg-[#101114]">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <Badge variant="warning">Responsavel: {selectedVehicle.responsible_person?.full_name ?? 'nao definido'}</Badge>
                  <h2 className="mt-3 text-2xl font-semibold text-white">{selectedVehicle.model}</h2>
                  <p className="mt-1 text-sm text-gray-400">{selectedVehicle.plate ?? 'Sem placa'} • {selectedVehicle.color ?? 'Cor nao informada'}</p>
                </div>
                {selectedVehicle.document_url ? (
                  <a href={selectedVehicle.document_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-sm text-orange-200 hover:bg-white/5">
                    <FileText size={16} />
                    Documento
                  </a>
                ) : null}
              </div>

              <div className="mt-6 grid gap-3 md:grid-cols-3">
                <MetricCard icon={<Gauge size={18} />} label="Ultima km" value={selectedLogs.find((log) => log.odometer_km != null)?.odometer_km?.toLocaleString('pt-BR') ?? '-'} />
                <MetricCard icon={<Fuel size={18} />} label="Combustivel" value={selectedLogs.find((log) => log.fuel_level_percent != null)?.fuel_level_percent != null ? `${selectedLogs.find((log) => log.fuel_level_percent != null)?.fuel_level_percent}%` : '-'} />
                <MetricCard icon={<Camera size={18} />} label="Registros" value={String(selectedLogs.length)} />
              </div>

              <div className="mt-6 space-y-3">
                <h3 className="text-lg font-semibold text-white">Historico do carro</h3>
                {selectedLogs.length === 0 ? (
                  <p className="rounded-2xl border border-white/8 bg-white/3 p-4 text-sm text-gray-400">Nenhum registro feito para este carro.</p>
                ) : (
                  selectedLogs.map((log) => (
                    <div key={log.id} className="grid gap-4 rounded-2xl border border-white/8 bg-white/4 p-4 md:grid-cols-[92px_minmax(0,1fr)]">
                      {log.photo_url ? <img src={log.photo_url} alt={eventLabel(log.event_type)} className="h-24 w-full rounded-xl object-cover md:w-24" /> : <div className="flex h-24 items-center justify-center rounded-xl bg-black/30"><Camera size={24} /></div>}
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant={log.event_type === 'fuel' ? 'warning' : 'info'}>{eventLabel(log.event_type)}</Badge>
                          {log.needs_review ? <Badge variant="warning">Revisar leitura</Badge> : null}
                          <span className="text-xs text-gray-500">{formatDateTime(log.occurred_at)}</span>
                        </div>
                        <p className="mt-2 text-sm text-gray-300">
                          Km: {log.odometer_km ?? '-'} • Combustivel: {log.fuel_level_percent != null ? `${log.fuel_level_percent}%` : '-'}
                          {log.fuel_level_range ? ` (${fuelRangeLabel(log.fuel_level_range)})` : ''}
                          {log.fuel_liters ? ` • ${log.fuel_liters} L` : ''}
                        </p>
                        {log.ai_summary ? <p className="mt-2 text-sm text-gray-400">{log.ai_summary}</p> : null}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </Card>
          ) : null}
        </div>
      )}

      <Modal isOpen={showVehicleModal} onClose={() => setShowVehicleModal(false)} title="Cadastrar carro" size="xl">
        <div className="grid gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
          <div className="rounded-[28px] border border-white/10 bg-black/30 p-4">
            <div className="aspect-[3/4] overflow-hidden rounded-3xl border border-white/10 bg-[#16171a]">
              {vehicleForm.photo_url ? <img src={vehicleForm.photo_url} alt="Carro" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-orange-200"><Car size={64} /></div>}
            </div>
            <input type="file" accept="image/*" onChange={(event) => void handleVehiclePhoto(event)} className="mt-4 block w-full text-xs text-gray-400 file:mr-3 file:rounded-lg file:border-0 file:bg-orange-500 file:px-3 file:py-2 file:text-xs file:font-medium file:text-white" />
          </div>
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <Input label="Codigo" value={vehicleForm.code} onChange={(event) => setVehicleForm((prev) => ({ ...prev, code: event.target.value }))} />
              <Input label="Placa" value={vehicleForm.plate} onChange={(event) => setVehicleForm((prev) => ({ ...prev, plate: event.target.value }))} />
              <Input label="Modelo" value={vehicleForm.model} onChange={(event) => setVehicleForm((prev) => ({ ...prev, model: event.target.value }))} />
              <Input label="Ano" value={vehicleForm.year} onChange={(event) => setVehicleForm((prev) => ({ ...prev, year: event.target.value }))} />
              <Input label="Cor" value={vehicleForm.color} onChange={(event) => setVehicleForm((prev) => ({ ...prev, color: event.target.value }))} />
              <Select label="Responsavel" value={vehicleForm.responsible_person_id} onChange={(event) => setVehicleForm((prev) => ({ ...prev, responsible_person_id: event.target.value }))} options={peopleOptions} placeholder="Selecione" />
            </div>
            <Input label="Observacoes" value={vehicleForm.notes} onChange={(event) => setVehicleForm((prev) => ({ ...prev, notes: event.target.value }))} />
            <div>
              <label className="text-sm font-medium text-gray-300">Documento do carro</label>
              <input type="file" accept="application/pdf,image/*" onChange={(event) => void handleVehicleDocument(event)} className="mt-2 block w-full text-sm text-gray-400 file:mr-4 file:rounded-lg file:border-0 file:bg-orange-500 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white" />
              {vehicleForm.document_name ? <p className="mt-2 text-xs text-orange-200">{vehicleForm.document_name}</p> : null}
            </div>
            <div className="flex justify-end gap-3 border-t border-white/8 pt-4">
              <Button variant="secondary" onClick={() => setShowVehicleModal(false)}>Cancelar</Button>
              <Button onClick={() => void handleSaveVehicle()} isLoading={savingVehicle}>Salvar carro</Button>
            </div>
          </div>
        </div>
      </Modal>

      <Modal isOpen={showLogModal && Boolean(selectedVehicle)} onClose={() => setShowLogModal(false)} title="Registrar uso do carro" size="xl">
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            {([
              { value: 'pickup', title: 'Saida', detail: 'Antes de sair', icon: <Car size={18} /> },
              { value: 'return', title: 'Chegada', detail: 'Volta ao galpao', icon: <Warehouse size={18} /> },
              { value: 'fuel', title: 'Abastecimento', detail: 'Combustivel e cupom', icon: <Fuel size={18} /> },
            ] as const).map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setLogForm((prev) => ({
                  ...prev,
                  event_type: option.value,
                  fuel_liters: option.value === 'fuel' ? prev.fuel_liters : '',
                  fuel_amount: option.value === 'fuel' ? prev.fuel_amount : '',
                  station_name: option.value === 'fuel' ? prev.station_name : '',
                }))}
                className={`rounded-2xl border p-4 text-left transition-colors ${
                  logForm.event_type === option.value
                    ? 'border-orange-400/35 bg-orange-500/12 text-orange-100'
                    : 'border-white/8 bg-white/3 text-gray-300 hover:bg-white/6'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className="rounded-xl border border-white/10 bg-black/20 p-2">{option.icon}</div>
                  <div>
                    <p className="text-sm font-medium text-white">{option.title}</p>
                    <p className="mt-1 text-xs text-gray-400">{option.detail}</p>
                  </div>
                </div>
              </button>
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="space-y-4 rounded-3xl border border-white/8 bg-white/3 p-4">
              <div>
                <p className="text-sm font-medium text-white">{eventLabel(logForm.event_type)}</p>
                <p className="mt-1 text-xs text-gray-400">{eventDescription(logForm.event_type)}</p>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <Input label="Kilometragem" value={logForm.odometer_km} onChange={(event) => setLogForm((prev) => ({ ...prev, odometer_km: event.target.value }))} />
                <Input label="Combustivel %" value={logForm.fuel_level_percent} onChange={(event) => setLogForm((prev) => ({ ...prev, fuel_level_percent: event.target.value }))} />
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <Input label="Barras preenchidas" value={logForm.fuel_bars_filled} onChange={(event) => setLogForm((prev) => ({ ...prev, fuel_bars_filled: event.target.value }))} />
                <Input label="Total de barras" value={logForm.fuel_bars_total} onChange={(event) => setLogForm((prev) => ({ ...prev, fuel_bars_total: event.target.value }))} />
              </div>
              <Select
                label="Faixa do combustivel"
                value={logForm.fuel_level_range}
                onChange={(event) => setLogForm((prev) => ({ ...prev, fuel_level_range: event.target.value as FuelLevelRange | '' }))}
                placeholder="Selecione se precisar corrigir"
                options={[
                  { value: 'reserva', label: 'Reserva' },
                  { value: 'baixo', label: 'Baixo' },
                  { value: 'meio', label: 'Meio tanque' },
                  { value: 'alto', label: 'Alto' },
                  { value: 'cheio', label: 'Cheio' },
                ]}
              />
              {isFuelLog ? (
                <div className="grid gap-3 md:grid-cols-3">
                  <Input label="Litros abastecidos" value={logForm.fuel_liters} onChange={(event) => setLogForm((prev) => ({ ...prev, fuel_liters: event.target.value }))} />
                  <Input label="Valor abastecido" value={logForm.fuel_amount} onChange={(event) => setLogForm((prev) => ({ ...prev, fuel_amount: event.target.value }))} />
                  <Input label="Posto" value={logForm.station_name} onChange={(event) => setLogForm((prev) => ({ ...prev, station_name: event.target.value }))} />
                </div>
              ) : null}
            </div>

            <div className="rounded-3xl border border-dashed border-white/12 bg-black/20 p-4">
              <div className="aspect-[4/3] overflow-hidden rounded-2xl border border-white/10 bg-[#15161a]">
                {logForm.photo_url ? (
                  <img src={logForm.photo_url} alt="Evidencia do registro" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full flex-col items-center justify-center gap-2 text-gray-500">
                    <Camera size={34} />
                    <span className="text-xs">Foto da evidencia</span>
                  </div>
                )}
              </div>
              <input type="file" accept="image/*" onChange={(event) => void handleLogPhoto(event)} disabled={analyzingImage} className="mt-4 block w-full text-sm text-gray-400 file:mr-4 file:rounded-lg file:border-0 file:bg-orange-500 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white" />
              <p className="mt-2 text-xs text-gray-500">A foto passa por GLM-OCR e analise visual para preencher km e combustivel.</p>
            </div>
          </div>

          <div className="rounded-2xl border border-white/8 bg-black/20 p-4">
            <div className="grid gap-3 md:grid-cols-3">
              <MiniMetric label="Km lida" value={logForm.odometer_km || '-'} />
              <MiniMetric label="Combustivel" value={logForm.fuel_level_percent ? `${logForm.fuel_level_percent}% (${fuelRangeLabel(logForm.fuel_level_range)})` : fuelRangeLabel(logForm.fuel_level_range)} />
              <MiniMetric label="Barras" value={logForm.fuel_bars_filled && logForm.fuel_bars_total ? `${logForm.fuel_bars_filled}/${logForm.fuel_bars_total}` : '-'} />
            </div>
            <div className="mt-3">
              <MiniMetric label="Confianca IA" value={logForm.ai_confidence != null ? `${Math.round(logForm.ai_confidence * 100)}%` : '-'} />
            </div>
            {analyzingImage ? <p className="mt-2 text-xs text-orange-300">Analisando imagem...</p> : null}
            {logForm.needs_review ? (
              <Alert variant="warning" className="mt-3">
                A leitura do combustivel precisa de conferencia manual antes de salvar.
              </Alert>
            ) : null}
            {logForm.ai_summary ? <Alert variant="info" className="mt-3">{logForm.ai_summary}</Alert> : null}
          </div>
          <Input label="Observacoes" value={logForm.notes} onChange={(event) => setLogForm((prev) => ({ ...prev, notes: event.target.value }))} />
          <div className="flex justify-end gap-3 border-t border-white/8 pt-4">
            <Button variant="secondary" onClick={() => setShowLogModal(false)}>Cancelar</Button>
            <Button onClick={() => void handleSaveLog()} isLoading={savingLog} disabled={analyzingImage}>Salvar registro</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/8 bg-black/20 px-3 py-2">
      <p className="text-[10px] uppercase tracking-[0.18em] text-gray-500">{label}</p>
      <p className="mt-1 truncate text-sm font-medium text-white">{value}</p>
    </div>
  )
}

function MetricCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <Card variant="bordered" className="border-white/8 bg-white/3">
      <div className="flex items-center gap-3">
        <div className="rounded-xl border border-orange-500/15 bg-orange-500/10 p-2 text-orange-200">{icon}</div>
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-gray-500">{label}</p>
          <p className="mt-1 text-lg font-semibold text-white">{value}</p>
        </div>
      </div>
    </Card>
  )
}
