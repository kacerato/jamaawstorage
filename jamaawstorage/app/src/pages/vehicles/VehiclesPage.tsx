import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, Bell, CalendarDays, Camera, Car, CheckCircle2, FileText, Fuel, Gauge, Info, Pencil, Plus, QrCode, Trash2, UserRound, Warehouse, Wrench } from 'lucide-react'
import type { Tables } from '../../types/database'
import { supabase } from '../../lib/supabase'
import { uploadFileToStorage, uploadImageToStorage } from '../../lib/storage'
import { DEFAULT_IMAGE_UPLOAD_OPTIONS, formatDateTime } from '../../lib/utils'
import { Alert, Badge, Button, Card, EmptyState, Input, Modal, Select, Spinner } from '../../components/ui'

type PersonRow = Tables<'people'>
type VehicleEventType = 'pickup' | 'return' | 'fuel'
type FuelLevelRange = 'reserva' | 'baixo' | 'meio' | 'alto' | 'cheio'
type VehicleMaintenanceAlertType = 'oil_change' | 'scheduled_review' | 'tires' | 'brakes' | 'document' | 'custom'
type VehicleMaintenanceStatus = 'active' | 'completed' | 'disabled'
type MaintenanceTargetMode = 'km' | 'date' | 'both'

const VEHICLE_LOG_IMAGE_OPTIONS = {
  maxFileSizeMb: 18,
  maxDimension: 1600,
  quality: 0.84,
} as const

interface VehicleImageAnalysis {
  odometerKm: number | null
  fuelLevelPercent: number | null
  fuelLevelRange: FuelLevelRange | null
  fuelBarsFilled: number | null
  fuelBarsTotal: number | null
  fuelLiters: number | null
  fuelAmount: number | null
  stationName: string | null
  ocrText: string | null
  summary: string | null
  confidence: number | null
  needsReview: boolean
  method?: string
  qrPayload?: string | null
  timingsMs?: { total?: number }
}

interface PendingVehicleAnalysis {
  savedLogId: string | null
  saveCompleted: Promise<void> | null
  preserveManual: Partial<Record<keyof LogFormState, boolean>>
}

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
  fuel_bars_filled: number | null
  fuel_bars_total: number | null
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

interface VehicleMaintenanceAlertRow {
  id: string
  vehicle_id: string
  alert_type: VehicleMaintenanceAlertType
  title: string
  due_date: string | null
  due_odometer_km: number | null
  advance_days: number
  advance_km: number
  repeat_interval_days: number | null
  repeat_interval_km: number | null
  status: VehicleMaintenanceStatus
  completed_at: string | null
  completed_odometer_km: number | null
  notes: string | null
  created_by: string | null
  created_at: string
  updated_at: string
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

interface MaintenanceFormState {
  alert_type: VehicleMaintenanceAlertType
  title: string
  due_date: string
  due_odometer_km: string
  advance_days: string
  advance_km: string
  repeat_interval_days: string
  repeat_interval_km: string
  notes: string
}

interface UntypedQueryBuilder {
  select: (query?: string) => UntypedQueryBuilder
  insert: (payload: unknown) => PromiseLike<{ error: { message: string } | null }>
  update: (payload: unknown) => { eq: (column: string, value: unknown) => PromiseLike<{ error: { message: string } | null }> }
  delete: () => { eq: (column: string, value: unknown) => PromiseLike<{ error: { message: string } | null }> }
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

const initialMaintenanceForm: MaintenanceFormState = {
  alert_type: 'oil_change',
  title: 'Troca de oleo',
  due_date: '',
  due_odometer_km: '',
  advance_days: '7',
  advance_km: '500',
  repeat_interval_days: '',
  repeat_interval_km: '3000',
  notes: '',
}

const maintenanceTypeOptions: { value: VehicleMaintenanceAlertType; label: string }[] = [
  { value: 'oil_change', label: 'Troca de oleo' },
  { value: 'scheduled_review', label: 'Revisao programada' },
  { value: 'tires', label: 'Pneus' },
  { value: 'brakes', label: 'Freios' },
  { value: 'document', label: 'Documento' },
  { value: 'custom', label: 'Customizado' },
]

const maintenanceTypeVisuals: Record<VehicleMaintenanceAlertType, { icon: React.ReactNode; preset: Partial<MaintenanceFormState> }> = {
  oil_change: { icon: <Fuel size={18} />, preset: { title: 'Troca de oleo', advance_km: '500', repeat_interval_km: '3000', repeat_interval_days: '' } },
  scheduled_review: { icon: <Wrench size={18} />, preset: { title: 'Revisao programada', advance_days: '15', advance_km: '500', repeat_interval_days: '90', repeat_interval_km: '' } },
  tires: { icon: <Gauge size={18} />, preset: { title: 'Pneus', advance_days: '15', advance_km: '500', repeat_interval_days: '', repeat_interval_km: '' } },
  brakes: { icon: <AlertTriangle size={18} />, preset: { title: 'Freios', advance_days: '15', advance_km: '500', repeat_interval_days: '', repeat_interval_km: '' } },
  document: { icon: <FileText size={18} />, preset: { title: 'Documento', advance_days: '30', advance_km: '0', repeat_interval_days: '365', repeat_interval_km: '' } },
  custom: { icon: <Bell size={18} />, preset: { title: 'Alerta customizado', advance_days: '7', advance_km: '500', repeat_interval_days: '', repeat_interval_km: '' } },
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

function maintenanceTypeLabel(type: VehicleMaintenanceAlertType): string {
  return maintenanceTypeOptions.find((option) => option.value === type)?.label ?? 'Customizado'
}

function dateInputValueFromDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function todayDateInputValue(): string {
  return dateInputValueFromDate(new Date())
}

function addDaysToDateInput(dateInput: string, days: number): string {
  const date = new Date(`${dateInput}T00:00:00`)
  date.setDate(date.getDate() + days)
  return dateInputValueFromDate(date)
}

function formatDateOnly(dateInput: string | null): string {
  if (!dateInput) return '-'
  return new Date(`${dateInput}T00:00:00`).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

function numericOrNull(value: string): number | null {
  const parsed = Number.parseFloat(value.replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : null
}

function maintenanceState(alert: VehicleMaintenanceAlertRow, currentOdometerKm: number | null): {
  label: string
  variant: 'default' | 'success' | 'warning' | 'danger' | 'info'
  priority: number
} {
  if (alert.status === 'completed') return { label: 'Concluida', variant: 'success', priority: 4 }
  if (alert.status === 'disabled') return { label: 'Inativa', variant: 'default', priority: 5 }

  const today = new Date(`${todayDateInputValue()}T00:00:00`)
  const dateDaysLeft = alert.due_date
    ? Math.ceil((new Date(`${alert.due_date}T00:00:00`).getTime() - today.getTime()) / 86_400_000)
    : null
  const kmLeft = alert.due_odometer_km != null && currentOdometerKm != null
    ? alert.due_odometer_km - currentOdometerKm
    : null

  if ((dateDaysLeft != null && dateDaysLeft < 0) || (kmLeft != null && kmLeft <= 0)) {
    return { label: 'Vencida', variant: 'danger', priority: 0 }
  }
  if ((dateDaysLeft != null && dateDaysLeft <= alert.advance_days) || (kmLeft != null && kmLeft <= alert.advance_km)) {
    return { label: 'Proxima', variant: 'warning', priority: 1 }
  }

  return { label: 'Em dia', variant: 'success', priority: 2 }
}

function maintenanceTargetSummary(alert: VehicleMaintenanceAlertRow): string {
  const parts = [
    alert.due_date ? `Data: ${formatDateOnly(alert.due_date)}` : null,
    alert.due_odometer_km != null ? `Km: ${alert.due_odometer_km.toLocaleString('pt-BR')}` : null,
  ].filter(Boolean)

  return parts.length > 0 ? parts.join(' | ') : '-'
}

function integerOrNull(value: string): number | null {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : null
}

export function VehiclesPage() {
  const db = useMemo(() => supabase as unknown as { from: (table: string) => UntypedQueryBuilder }, [])
  const [vehicles, setVehicles] = useState<VehicleRow[]>([])
  const [logs, setLogs] = useState<VehicleLogRow[]>([])
  const [maintenanceAlerts, setMaintenanceAlerts] = useState<VehicleMaintenanceAlertRow[]>([])
  const [people, setPeople] = useState<PersonRow[]>([])
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [savingVehicle, setSavingVehicle] = useState(false)
  const [savingLog, setSavingLog] = useState(false)
  const [savingMaintenance, setSavingMaintenance] = useState(false)
  const [completingMaintenanceAlertId, setCompletingMaintenanceAlertId] = useState<string | null>(null)
  const [uploadingLogImage, setUploadingLogImage] = useState(false)
  const [analyzingImage, setAnalyzingImage] = useState(false)
  const [analysisMethod, setAnalysisMethod] = useState<string | null>(null)
  const [analysisDurationMs, setAnalysisDurationMs] = useState<number | null>(null)
  const [showVehicleModal, setShowVehicleModal] = useState(false)
  const [showLogModal, setShowLogModal] = useState(false)
  const [showMaintenanceModal, setShowMaintenanceModal] = useState(false)
  const [editingVehicleId, setEditingVehicleId] = useState<string | null>(null)
  const [editingLogId, setEditingLogId] = useState<string | null>(null)
  const [editingMaintenanceAlertId, setEditingMaintenanceAlertId] = useState<string | null>(null)
  const [vehicleForm, setVehicleForm] = useState<VehicleFormState>(initialVehicleForm)
  const [logForm, setLogForm] = useState<LogFormState>(initialLogForm)
  const [maintenanceForm, setMaintenanceForm] = useState<MaintenanceFormState>(initialMaintenanceForm)
  const [maintenanceTargetMode, setMaintenanceTargetMode] = useState<MaintenanceTargetMode>('km')
  const [error, setError] = useState<string | null>(null)
  const pendingAnalysisRef = useRef<PendingVehicleAnalysis | null>(null)

  const selectedVehicle = useMemo(
    () => vehicles.find((vehicle) => vehicle.id === selectedVehicleId) ?? vehicles[0] ?? null,
    [selectedVehicleId, vehicles],
  )

  const selectedLogs = useMemo(
    () => logs.filter((log) => log.vehicle_id === selectedVehicle?.id),
    [logs, selectedVehicle?.id],
  )

  const currentOdometerKm = selectedLogs.find((log) => log.odometer_km != null)?.odometer_km ?? null

  const selectedMaintenanceAlerts = useMemo(
    () => maintenanceAlerts
      .filter((alert) => alert.vehicle_id === selectedVehicle?.id)
      .sort((left, right) => {
        const leftState = maintenanceState(left, currentOdometerKm)
        const rightState = maintenanceState(right, currentOdometerKm)
        if (leftState.priority !== rightState.priority) return leftState.priority - rightState.priority
        return new Date(left.due_date ?? left.created_at).getTime() - new Date(right.due_date ?? right.created_at).getTime()
      }),
    [currentOdometerKm, maintenanceAlerts, selectedVehicle?.id],
  )

  const urgentMaintenanceCount = selectedMaintenanceAlerts.filter((alert) => {
    const state = maintenanceState(alert, currentOdometerKm)
    return state.variant === 'danger' || state.variant === 'warning'
  }).length

  const isFuelLog = logForm.event_type === 'fuel'

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [vehicleResult, logsResult, maintenanceResult, peopleResult] = await Promise.all([
        (db.from('vehicles').select('*, responsible_person:people!vehicles_responsible_person_id_fkey(id, full_name, employee_id)') as unknown as PromiseLike<{ data: VehicleRow[] | null; error: { message: string } | null }>),
        (db.from('vehicle_usage_logs').select('*, responsible_person:people!vehicle_usage_logs_responsible_person_id_fkey(id, full_name, employee_id)').order('occurred_at', { ascending: false }) as unknown as PromiseLike<{ data: VehicleLogRow[] | null; error: { message: string } | null }>),
        (db.from('vehicle_maintenance_alerts').select('*').order('created_at', { ascending: false }) as unknown as PromiseLike<{ data: VehicleMaintenanceAlertRow[] | null; error: { message: string } | null }>),
        supabase
          .from('people')
          .select('id, full_name, employee_id, profile_id, role, job_title, sector, cpf, photo_url, document_attachments, is_active, created_at, updated_at')
          .eq('is_active', true)
          .order('full_name', { ascending: true }),
      ])

      if (vehicleResult.error) throw new Error(vehicleResult.error.message)
      if (logsResult.error) throw new Error(logsResult.error.message)
      if (maintenanceResult.error) throw new Error(maintenanceResult.error.message)
      if (peopleResult.error) throw new Error(peopleResult.error.message)

      setVehicles(vehicleResult.data ?? [])
      setLogs(logsResult.data ?? [])
      setMaintenanceAlerts(maintenanceResult.data ?? [])
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

  const openCreateVehicleModal = () => {
    setEditingVehicleId(null)
    setVehicleForm(initialVehicleForm)
    setShowVehicleModal(true)
  }

  const openEditVehicleModal = (vehicle: VehicleRow) => {
    setEditingVehicleId(vehicle.id)
    setVehicleForm({
      code: vehicle.code,
      plate: vehicle.plate ?? '',
      model: vehicle.model,
      color: vehicle.color ?? '',
      year: vehicle.year != null ? String(vehicle.year) : '',
      responsible_person_id: vehicle.responsible_person_id ?? '',
      photo_url: vehicle.photo_url,
      document_url: vehicle.document_url,
      document_name: vehicle.document_name,
      notes: vehicle.notes ?? '',
    })
    setShowVehicleModal(true)
  }

  const closeVehicleModal = () => {
    setShowVehicleModal(false)
    setEditingVehicleId(null)
    setVehicleForm(initialVehicleForm)
  }

  const openCreateLogModal = () => {
    pendingAnalysisRef.current = null
    setAnalyzingImage(false)
    setUploadingLogImage(false)
    setEditingLogId(null)
    setLogForm(initialLogForm)
    setAnalysisMethod(null)
    setAnalysisDurationMs(null)
    setShowLogModal(true)
  }

  const openEditLogModal = (log: VehicleLogRow) => {
    pendingAnalysisRef.current = null
    setAnalyzingImage(false)
    setUploadingLogImage(false)
    setEditingLogId(log.id)
    setLogForm({
      event_type: log.event_type,
      photo_url: log.photo_url,
      odometer_km: log.odometer_km != null ? String(log.odometer_km) : '',
      fuel_level_percent: log.fuel_level_percent != null ? String(log.fuel_level_percent) : '',
      fuel_level_range: log.fuel_level_range ?? '',
      fuel_bars_filled: log.fuel_bars_filled != null ? String(log.fuel_bars_filled) : '',
      fuel_bars_total: log.fuel_bars_total != null ? String(log.fuel_bars_total) : '',
      fuel_liters: log.fuel_liters != null ? String(log.fuel_liters) : '',
      fuel_amount: log.fuel_amount != null ? String(log.fuel_amount) : '',
      station_name: log.station_name ?? '',
      notes: log.notes ?? '',
      ocr_text: log.ocr_text,
      ai_summary: log.ai_summary,
      ai_confidence: log.ai_confidence,
      needs_review: log.needs_review,
    })
    setShowLogModal(true)
  }

  const closeLogModal = () => {
    pendingAnalysisRef.current = null
    setShowLogModal(false)
    setEditingLogId(null)
    setLogForm(initialLogForm)
  }

  const inferMaintenanceTargetMode = (form: MaintenanceFormState): MaintenanceTargetMode => {
    if (form.due_date && form.due_odometer_km.trim()) return 'both'
    if (form.due_date) return 'date'
    return 'km'
  }

  const makeMaintenancePreset = (): MaintenanceFormState => ({
    ...initialMaintenanceForm,
    due_odometer_km: currentOdometerKm != null ? String(Math.round(currentOdometerKm + 3000)) : '',
  })

  const applyMaintenanceTargetMode = (mode: MaintenanceTargetMode) => {
    setMaintenanceTargetMode(mode)
    setMaintenanceForm((prev) => ({
      ...prev,
      due_date: mode === 'km' ? '' : prev.due_date || addDaysToDateInput(todayDateInputValue(), 90),
      due_odometer_km: mode === 'date' ? '' : prev.due_odometer_km || (currentOdometerKm != null ? String(Math.round(currentOdometerKm + 3000)) : ''),
      repeat_interval_days: mode === 'km' ? '' : prev.repeat_interval_days,
      repeat_interval_km: mode === 'date' ? '' : prev.repeat_interval_km,
    }))
  }

  const applyMaintenanceType = (alertType: VehicleMaintenanceAlertType) => {
    const visual = maintenanceTypeVisuals[alertType]
    setMaintenanceForm((prev) => ({
      ...prev,
      ...visual.preset,
      alert_type: alertType,
      due_date: alertType === 'document' && !prev.due_date ? addDaysToDateInput(todayDateInputValue(), 365) : prev.due_date,
      due_odometer_km: alertType === 'document' ? '' : prev.due_odometer_km,
    }))
    if (alertType === 'document') {
      setMaintenanceTargetMode('date')
    }
  }

  const openCreateMaintenanceModal = () => {
    const preset = makeMaintenancePreset()
    setEditingMaintenanceAlertId(null)
    setMaintenanceTargetMode(inferMaintenanceTargetMode(preset))
    setMaintenanceForm(preset)
    setShowMaintenanceModal(true)
  }

  const openEditMaintenanceModal = (alert: VehicleMaintenanceAlertRow) => {
    setEditingMaintenanceAlertId(alert.id)
    const nextForm = {
      alert_type: alert.alert_type,
      title: alert.title,
      due_date: alert.due_date ?? '',
      due_odometer_km: alert.due_odometer_km != null ? String(alert.due_odometer_km) : '',
      advance_days: String(alert.advance_days),
      advance_km: String(alert.advance_km),
      repeat_interval_days: alert.repeat_interval_days != null ? String(alert.repeat_interval_days) : '',
      repeat_interval_km: alert.repeat_interval_km != null ? String(alert.repeat_interval_km) : '',
      notes: alert.notes ?? '',
    }
    setMaintenanceTargetMode(inferMaintenanceTargetMode(nextForm))
    setMaintenanceForm(nextForm)
    setShowMaintenanceModal(true)
  }

  const closeMaintenanceModal = () => {
    setShowMaintenanceModal(false)
    setEditingMaintenanceAlertId(null)
    setMaintenanceForm(initialMaintenanceForm)
  }

  const handleSaveMaintenanceAlert = async () => {
    if (!selectedVehicle) return
    if (!maintenanceForm.title.trim()) {
      setError('Informe o nome do alerta de revisao.')
      return
    }
    if (!maintenanceForm.due_date && !maintenanceForm.due_odometer_km.trim()) {
      setError('Informe pelo menos uma meta: data da revisao ou kilometragem.')
      return
    }

    setSavingMaintenance(true)
    setError(null)
    try {
      const payload = {
        alert_type: maintenanceForm.alert_type,
        title: maintenanceForm.title.trim(),
        due_date: maintenanceForm.due_date || null,
        due_odometer_km: numericOrNull(maintenanceForm.due_odometer_km),
        advance_days: integerOrNull(maintenanceForm.advance_days) ?? 0,
        advance_km: numericOrNull(maintenanceForm.advance_km) ?? 0,
        repeat_interval_days: integerOrNull(maintenanceForm.repeat_interval_days),
        repeat_interval_km: numericOrNull(maintenanceForm.repeat_interval_km),
        notes: maintenanceForm.notes.trim() || null,
      }

      const result = editingMaintenanceAlertId
        ? await db.from('vehicle_maintenance_alerts').update(payload).eq('id', editingMaintenanceAlertId)
        : await (db.from('vehicle_maintenance_alerts').insert({ vehicle_id: selectedVehicle.id, ...payload }) as PromiseLike<{ error: { message: string } | null }>)
      if (result.error) throw new Error(result.error.message)

      closeMaintenanceModal()
      await load()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Nao foi possivel salvar o alerta de revisao.')
    } finally {
      setSavingMaintenance(false)
    }
  }

  const handleCompleteMaintenanceAlert = async (alert: VehicleMaintenanceAlertRow) => {
    const confirmed = window.confirm(`Marcar "${alert.title}" como revisao concluida?`)
    if (!confirmed) return

    setCompletingMaintenanceAlertId(alert.id)
    setError(null)
    try {
      const completedOdometer = currentOdometerKm ?? alert.due_odometer_km
      const updateResult = await db.from('vehicle_maintenance_alerts').update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        completed_odometer_km: completedOdometer,
      }).eq('id', alert.id)
      if (updateResult.error) throw new Error(updateResult.error.message)

      const nextDueDate = alert.repeat_interval_days != null
        ? addDaysToDateInput(todayDateInputValue(), alert.repeat_interval_days)
        : null
      const nextDueOdometer = alert.repeat_interval_km != null && completedOdometer != null
        ? completedOdometer + alert.repeat_interval_km
        : null

      if (nextDueDate || nextDueOdometer != null) {
        const insertResult = await (db.from('vehicle_maintenance_alerts').insert({
          vehicle_id: alert.vehicle_id,
          alert_type: alert.alert_type,
          title: alert.title,
          due_date: nextDueDate,
          due_odometer_km: nextDueOdometer,
          advance_days: alert.advance_days,
          advance_km: alert.advance_km,
          repeat_interval_days: alert.repeat_interval_days,
          repeat_interval_km: alert.repeat_interval_km,
          notes: alert.notes,
        }) as PromiseLike<{ error: { message: string } | null }>)
        if (insertResult.error) throw new Error(insertResult.error.message)
      }

      await load()
    } catch (completeError) {
      setError(completeError instanceof Error ? completeError.message : 'Nao foi possivel concluir a revisao.')
    } finally {
      setCompletingMaintenanceAlertId(null)
    }
  }

  const handleDeleteMaintenanceAlert = async (alert: VehicleMaintenanceAlertRow) => {
    const confirmed = window.confirm(`Excluir o alerta "${alert.title}"?`)
    if (!confirmed) return

    setSavingMaintenance(true)
    setError(null)
    try {
      const result = await db.from('vehicle_maintenance_alerts').delete().eq('id', alert.id)
      if (result.error) throw new Error(result.error.message)

      await load()
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Nao foi possivel excluir o alerta de revisao.')
    } finally {
      setSavingMaintenance(false)
    }
  }

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
      const result = editingVehicleId
        ? await db.from('vehicles').update(payload).eq('id', editingVehicleId)
        : await (db.from('vehicles').insert(payload) as PromiseLike<{ error: { message: string } | null }>)
      if (result.error) throw new Error(result.error.message)

      closeVehicleModal()
      await load()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Nao foi possivel salvar o veiculo.')
    } finally {
      setSavingVehicle(false)
    }
  }

  const handleDeleteVehicle = async (vehicle: VehicleRow) => {
    const confirmed = window.confirm(`Excluir o carro ${vehicle.code}? Isso tambem remove o historico de registros desse carro.`)
    if (!confirmed) return

    setSavingVehicle(true)
    setError(null)
    try {
      const result = await db.from('vehicles').delete().eq('id', vehicle.id)
      if (result.error) throw new Error(result.error.message)

      setSelectedVehicleId((current) => current === vehicle.id ? null : current)
      await load()
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Nao foi possivel excluir o carro.')
    } finally {
      setSavingVehicle(false)
    }
  }

  const handleLogPhoto = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file || !selectedVehicle) return

    setUploadingLogImage(true)
    setAnalysisMethod(null)
    setAnalysisDurationMs(null)
    setError(null)
    let storageUrl: string | null = null
    let analysisJob: PendingVehicleAnalysis | null = null
    try {
      storageUrl = await uploadImageToStorage({
        file,
        scope: 'vehicles/logs',
        entityId: selectedVehicle.id,
        options: VEHICLE_LOG_IMAGE_OPTIONS,
      })
      setLogForm((prev) => ({ ...prev, photo_url: storageUrl }))
      setUploadingLogImage(false)
      setAnalyzingImage(true)

      analysisJob = { savedLogId: null, saveCompleted: null, preserveManual: {} }
      pendingAnalysisRef.current = analysisJob
      const analysisResponse = await fetch('/api/vehicle-image-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: storageUrl, eventType: logForm.event_type }),
      })
      const analysis = await analysisResponse.json().catch(() => null) as VehicleImageAnalysis | null
      if (!analysisResponse.ok) {
        const responseError = analysis as unknown as { error?: string } | null
        throw new Error(responseError?.error || 'Nao foi possivel analisar a imagem.')
      }
      if (!analysis) throw new Error('A analise retornou uma resposta vazia.')

      setAnalysisMethod(analysis.method ?? null)
      setAnalysisDurationMs(analysis.timingsMs?.total ?? null)

      if (analysisJob.savedLogId) {
        if (analysisJob.saveCompleted) await analysisJob.saveCompleted
        if (!analysisJob.savedLogId) return
        const preserve = analysisJob.preserveManual
        const persistedPayload = {
          ...(!preserve.odometer_km ? { odometer_km: analysis.odometerKm } : {}),
          ...(!preserve.fuel_level_percent ? { fuel_level_percent: analysis.fuelLevelPercent } : {}),
          ...(!preserve.fuel_level_range ? { fuel_level_range: analysis.fuelLevelRange } : {}),
          ...(!preserve.fuel_bars_filled ? { fuel_bars_filled: analysis.fuelBarsFilled } : {}),
          ...(!preserve.fuel_bars_total ? { fuel_bars_total: analysis.fuelBarsTotal } : {}),
          ...(!preserve.fuel_liters ? { fuel_liters: analysis.fuelLiters } : {}),
          ...(!preserve.fuel_amount ? { fuel_amount: analysis.fuelAmount } : {}),
          ...(!preserve.station_name ? { station_name: analysis.stationName } : {}),
          ocr_text: analysis.ocrText,
          ai_summary: analysis.summary,
          ai_confidence: analysis.confidence,
          needs_review: Boolean(analysis.needsReview),
        }
        const updateResult = await db.from('vehicle_usage_logs').update(persistedPayload).eq('id', analysisJob.savedLogId)
        if (updateResult.error) throw new Error(updateResult.error.message)
        await load()
      } else if (pendingAnalysisRef.current === analysisJob) {
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
      }
    } catch (uploadError) {
      setError(uploadError instanceof Error
        ? `${uploadError.message} A foto ficou anexada; revise os campos e salve manualmente se necessario.`
        : 'Nao foi possivel processar a foto do registro. A foto ficou anexada; revise os campos e salve manualmente se necessario.')
    } finally {
      setUploadingLogImage(false)
      if (!analysisJob || pendingAnalysisRef.current === analysisJob || pendingAnalysisRef.current === null) {
        setAnalyzingImage(false)
      }
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
        fuel_bars_filled: integerOrNull(logForm.fuel_bars_filled),
        fuel_bars_total: integerOrNull(logForm.fuel_bars_total),
        fuel_liters: numericOrNull(logForm.fuel_liters),
        fuel_amount: numericOrNull(logForm.fuel_amount),
        station_name: logForm.station_name.trim() || null,
        photo_url: logForm.photo_url,
        ocr_text: logForm.ocr_text,
        ai_summary: logForm.ai_summary,
        ai_confidence: logForm.ai_confidence,
        needs_review: analyzingImage ? true : logForm.needs_review,
        notes: logForm.notes.trim() || null,
      }
      const targetLogId = editingLogId ?? crypto.randomUUID()
      const pendingJob = pendingAnalysisRef.current && analyzingImage ? pendingAnalysisRef.current : null
      const pendingSaveGate: { resolve?: () => void } = {}
      if (pendingJob) {
        pendingJob.savedLogId = targetLogId
        pendingJob.preserveManual = {
          odometer_km: Boolean(logForm.odometer_km),
          fuel_level_percent: Boolean(logForm.fuel_level_percent),
          fuel_level_range: Boolean(logForm.fuel_level_range),
          fuel_bars_filled: Boolean(logForm.fuel_bars_filled),
          fuel_bars_total: Boolean(logForm.fuel_bars_total),
          fuel_liters: Boolean(logForm.fuel_liters),
          fuel_amount: Boolean(logForm.fuel_amount),
          station_name: Boolean(logForm.station_name.trim()),
        }
        pendingJob.saveCompleted = new Promise((resolve) => {
          pendingSaveGate.resolve = resolve
        })
      }
      try {
        const result = editingLogId
          ? await db.from('vehicle_usage_logs').update(payload).eq('id', editingLogId)
          : await (db.from('vehicle_usage_logs').insert({ id: targetLogId, ...payload }) as PromiseLike<{ error: { message: string } | null }>)
        if (result.error) {
          if (pendingJob) pendingJob.savedLogId = null
          throw new Error(result.error.message)
        }
      } finally {
        pendingSaveGate.resolve?.()
      }

      closeLogModal()
      await load()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Nao foi possivel salvar o registro do carro.')
    } finally {
      setSavingLog(false)
    }
  }

  const handleDeleteLog = async (log: VehicleLogRow) => {
    const confirmed = window.confirm(`Excluir o registro de ${eventLabel(log.event_type)} de ${formatDateTime(log.occurred_at)}?`)
    if (!confirmed) return

    setSavingLog(true)
    setError(null)
    try {
      const result = await db.from('vehicle_usage_logs').delete().eq('id', log.id)
      if (result.error) throw new Error(result.error.message)

      await load()
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Nao foi possivel excluir o registro.')
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
          <Button onClick={openCreateVehicleModal} leftIcon={<Plus size={16} />}>
            Cadastrar carro
          </Button>
          <Button onClick={openCreateLogModal} disabled={!selectedVehicle} leftIcon={<Camera size={16} />}>
            Registrar uso
          </Button>
          {selectedVehicle ? (
            <a
              href={`/api/vehicle-marker?code=${encodeURIComponent(selectedVehicle.code)}`}
              download={`${selectedVehicle.code}-marker.png`}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-gray-200 transition-colors hover:bg-white/10"
            >
              <QrCode size={16} /> Baixar QR
            </a>
          ) : null}
        </div>
      </div>

      {error ? <Alert variant="danger">{error}</Alert> : null}

      {vehicles.length === 0 ? (
        <EmptyState
          icon={<Car size={48} />}
          title="Nenhum carro cadastrado"
          description="Cadastre o Shineray TLux T30 2025 e defina a pessoa responsavel pelo controle."
          action={{ label: 'Cadastrar carro', onClick: openCreateVehicleModal }}
        />
      ) : (
        <div className="grid gap-5 xl:grid-cols-[minmax(300px,380px)_minmax(0,1fr)]">
          <div className="space-y-4 xl:sticky xl:top-6 xl:max-h-[calc(100vh-150px)] xl:overflow-y-auto xl:pr-1">
            {vehicles.map((vehicle) => (
              <button key={vehicle.id} type="button" onClick={() => setSelectedVehicleId(vehicle.id)} className="w-full text-left">
                <Card variant="bordered" className={`overflow-hidden border-white/8 ${selectedVehicle?.id === vehicle.id ? 'bg-orange-500/10' : 'bg-white/3'}`}>
                  <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-4">
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
                        <MiniMetric label="Alertas" value={String(maintenanceAlerts.filter((alert) => alert.vehicle_id === vehicle.id && alert.status === 'active').length)} />
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
            <Card variant="bordered" className="min-w-0 overflow-hidden border-white/8 bg-[#101114]">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <Badge variant="warning">Responsavel: {selectedVehicle.responsible_person?.full_name ?? 'nao definido'}</Badge>
                  <h2 className="mt-3 text-2xl font-semibold text-white">{selectedVehicle.model}</h2>
                  <p className="mt-1 text-sm text-gray-400">{selectedVehicle.plate ?? 'Sem placa'} • {selectedVehicle.color ?? 'Cor nao informada'}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {selectedVehicle.document_url ? (
                    <a href={selectedVehicle.document_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-sm text-orange-200 hover:bg-white/5">
                      <FileText size={16} />
                      Documento
                    </a>
                  ) : null}
                  <Button variant="secondary" onClick={() => openEditVehicleModal(selectedVehicle)} leftIcon={<Pencil size={16} />}>
                    Editar carro
                  </Button>
                  <Button variant="danger" onClick={() => void handleDeleteVehicle(selectedVehicle)} leftIcon={<Trash2 size={16} />}>
                    Excluir
                  </Button>
                </div>
              </div>

              <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <MetricCard icon={<Gauge size={18} />} label="Ultima km" value={currentOdometerKm?.toLocaleString('pt-BR') ?? '-'} />
                <MetricCard icon={<Fuel size={18} />} label="Combustivel" value={selectedLogs.find((log) => log.fuel_level_percent != null)?.fuel_level_percent != null ? `${selectedLogs.find((log) => log.fuel_level_percent != null)?.fuel_level_percent}%` : '-'} />
                <MetricCard icon={<Wrench size={18} />} label="Alertas" value={urgentMaintenanceCount > 0 ? `${urgentMaintenanceCount} pendente(s)` : 'Em dia'} />
                <MetricCard icon={<Camera size={18} />} label="Registros" value={String(selectedLogs.length)} />
              </div>

              <div className="mt-6 space-y-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <h3 className="text-lg font-semibold text-white">Revisoes e alertas</h3>
                  <Button size="sm" variant="secondary" onClick={openCreateMaintenanceModal} leftIcon={<Plus size={14} />}>
                    Adicionar alerta
                  </Button>
                </div>
                {selectedMaintenanceAlerts.length === 0 ? (
                  <p className="rounded-xl border border-white/8 bg-white/3 p-4 text-sm text-gray-400">Nenhum alerta de revisao cadastrado para este carro.</p>
                ) : (
                  <div className="grid gap-3 2xl:grid-cols-2">
                    {selectedMaintenanceAlerts.map((alert) => {
                      const state = maintenanceState(alert, currentOdometerKm)
                      const isClosed = alert.status !== 'active'
                      return (
                        <div key={alert.id} className="min-w-0 rounded-xl border border-white/8 bg-white/4 p-4">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <Badge variant={state.variant}>{state.label}</Badge>
                                <Badge variant="info">{maintenanceTypeLabel(alert.alert_type)}</Badge>
                              </div>
                              <h4 className="mt-2 truncate text-sm font-semibold text-white">{alert.title}</h4>
                              <p className="mt-1 text-sm text-gray-300">{maintenanceTargetSummary(alert)}</p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <Button size="sm" variant="secondary" onClick={() => openEditMaintenanceModal(alert)} leftIcon={<Pencil size={14} />}>
                                Editar
                              </Button>
                              {!isClosed ? (
                                <Button size="sm" variant="outline" onClick={() => void handleCompleteMaintenanceAlert(alert)} isLoading={completingMaintenanceAlertId === alert.id} leftIcon={<CheckCircle2 size={14} />}>
                                  Concluir
                                </Button>
                              ) : null}
                              <Button size="sm" variant="danger" onClick={() => void handleDeleteMaintenanceAlert(alert)} leftIcon={<Trash2 size={14} />}>
                                Excluir
                              </Button>
                            </div>
                          </div>
                          <div className="mt-3 grid gap-2 text-xs text-gray-400 sm:grid-cols-2">
                            <span className="inline-flex items-center gap-1.5"><AlertTriangle size={13} /> Aviso: {alert.advance_days} dia(s) / {alert.advance_km.toLocaleString('pt-BR')} km antes</span>
                            <span className="inline-flex items-center gap-1.5"><CalendarDays size={13} /> Repete: {alert.repeat_interval_days ? `${alert.repeat_interval_days} dia(s)` : '-'} {alert.repeat_interval_km ? `/ ${alert.repeat_interval_km.toLocaleString('pt-BR')} km` : ''}</span>
                          </div>
                          {alert.notes ? <p className="mt-3 break-words text-sm text-gray-400">{alert.notes}</p> : null}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              <div className="mt-6 space-y-3">
                <h3 className="text-lg font-semibold text-white">Historico do carro</h3>
                {selectedLogs.length === 0 ? (
                  <p className="rounded-xl border border-white/8 bg-white/3 p-4 text-sm text-gray-400">Nenhum registro feito para este carro.</p>
                ) : (
                  <div className="max-h-[560px] space-y-3 overflow-y-auto pr-1">
                    {selectedLogs.map((log) => (
                      <div key={log.id} className="grid min-w-0 gap-4 rounded-xl border border-white/8 bg-white/4 p-4 md:grid-cols-[92px_minmax(0,1fr)]">
                        {log.photo_url ? <img src={log.photo_url} alt={eventLabel(log.event_type)} className="h-24 w-full rounded-lg object-cover md:w-24" /> : <div className="flex h-24 items-center justify-center rounded-lg bg-black/30"><Camera size={24} /></div>}
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge variant={log.event_type === 'fuel' ? 'warning' : 'info'}>{eventLabel(log.event_type)}</Badge>
                              {log.needs_review ? <Badge variant="warning">Revisar leitura</Badge> : null}
                              <span className="text-xs text-gray-500">{formatDateTime(log.occurred_at)}</span>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <Button size="sm" variant="secondary" onClick={() => openEditLogModal(log)} leftIcon={<Pencil size={14} />}>
                                Editar
                              </Button>
                              <Button size="sm" variant="danger" onClick={() => void handleDeleteLog(log)} leftIcon={<Trash2 size={14} />}>
                                Excluir
                              </Button>
                            </div>
                          </div>
                          <p className="mt-2 break-words text-sm text-gray-300">
                            Km: {log.odometer_km ?? '-'} | Combustivel: {log.fuel_level_percent != null ? `${log.fuel_level_percent}%` : '-'}
                            {log.fuel_level_range ? ` (${fuelRangeLabel(log.fuel_level_range)})` : ''}
                            {log.fuel_bars_filled != null && log.fuel_bars_total != null ? ` | ${log.fuel_bars_filled}/${log.fuel_bars_total} barras` : ''}
                            {log.fuel_liters ? ` | ${log.fuel_liters} L` : ''}
                          </p>
                          {log.ai_summary ? <p className="mt-2 break-words text-sm text-gray-400">{log.ai_summary}</p> : null}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </Card>
          ) : null}
        </div>
      )}

      <Modal isOpen={showVehicleModal} onClose={closeVehicleModal} title={editingVehicleId ? 'Editar carro' : 'Cadastrar carro'} size="xl">
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
              <Button variant="secondary" onClick={closeVehicleModal}>Cancelar</Button>
              <Button onClick={() => void handleSaveVehicle()} isLoading={savingVehicle}>
                {editingVehicleId ? 'Salvar alteracoes' : 'Salvar carro'}
              </Button>
            </div>
          </div>
        </div>
      </Modal>

      <Modal isOpen={showMaintenanceModal && Boolean(selectedVehicle)} onClose={closeMaintenanceModal} title={editingMaintenanceAlertId ? 'Editar alerta de revisao' : 'Novo alerta de revisao'} size="lg">
        <div className="space-y-5">
          <div>
            <SectionLabel label="Tipo" info="Escolha o motivo do alerta. Isso preenche valores comuns, mas voce pode ajustar tudo depois." />
            <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {maintenanceTypeOptions.map((option) => {
                const visual = maintenanceTypeVisuals[option.value]
                const selected = maintenanceForm.alert_type === option.value
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => applyMaintenanceType(option.value)}
                    className={`flex min-h-16 items-center gap-3 rounded-2xl border px-3 py-3 text-left transition-colors ${
                      selected
                        ? 'border-orange-400/50 bg-orange-500/14 text-orange-100 shadow-[inset_0_0_0_1px_rgba(251,146,60,0.12)]'
                        : 'border-white/8 bg-white/3 text-gray-300 hover:border-white/14 hover:bg-white/6'
                    }`}
                  >
                    <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border border-white/10 bg-black/20 text-orange-200">{visual.icon}</span>
                    <span className="text-sm font-medium text-white">{option.label}</span>
                  </button>
                )
              })}
            </div>
          </div>

          <div>
            <SectionLabel label="Nome" info="Use um nome curto para reconhecer o alerta na lista do carro." />
            <Input
              value={maintenanceForm.title}
              onChange={(event) => setMaintenanceForm((prev) => ({ ...prev, title: event.target.value }))}
            />
          </div>

          <div className="rounded-2xl border border-white/8 bg-white/3 p-4">
            <SectionLabel label="Vence por" info="Km e data podem trabalhar juntos. O alerta fica vencido quando qualquer meta passar." />
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              {([
                { value: 'km', label: 'Km', icon: <Gauge size={16} /> },
                { value: 'date', label: 'Data', icon: <CalendarDays size={16} /> },
                { value: 'both', label: 'Km + data', icon: <Wrench size={16} /> },
              ] as const).map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => applyMaintenanceTargetMode(option.value)}
                  className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium transition-colors ${
                    maintenanceTargetMode === option.value
                      ? 'border-orange-400/50 bg-orange-500/14 text-orange-100 shadow-[inset_0_0_0_1px_rgba(251,146,60,0.12)]'
                      : 'border-white/8 bg-black/20 text-gray-300 hover:border-white/14 hover:bg-white/6'
                  }`}
                >
                  {option.icon}
                  {option.label}
                </button>
              ))}
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {maintenanceTargetMode !== 'km' ? (
                <div>
                  <SectionLabel label="Data limite" info="Use para documento, revisao por calendario ou prazo fixo." />
                  <Input
                    type="date"
                    value={maintenanceForm.due_date}
                    onChange={(event) => setMaintenanceForm((prev) => ({ ...prev, due_date: event.target.value }))}
                  />
                </div>
              ) : null}
              {maintenanceTargetMode !== 'date' ? (
                <div>
                  <SectionLabel label="Km limite" info={`Km atual considerado: ${currentOdometerKm?.toLocaleString('pt-BR') ?? 'nao registrado'}.`} />
                  <Input
                    inputMode="decimal"
                    value={maintenanceForm.due_odometer_km}
                    onChange={(event) => setMaintenanceForm((prev) => ({ ...prev, due_odometer_km: event.target.value }))}
                  />
                </div>
              ) : null}
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-2xl border border-white/8 bg-black/20 p-4">
              <SectionLabel label="Antecedencia" info="Define quando o alerta muda de em dia para proximo." />
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {maintenanceTargetMode !== 'km' ? (
                  <Input
                    label="Dias antes"
                    inputMode="numeric"
                    value={maintenanceForm.advance_days}
                    onChange={(event) => setMaintenanceForm((prev) => ({ ...prev, advance_days: event.target.value }))}
                  />
                ) : null}
                {maintenanceTargetMode !== 'date' ? (
                  <Input
                    label="Km antes"
                    inputMode="decimal"
                    value={maintenanceForm.advance_km}
                    onChange={(event) => setMaintenanceForm((prev) => ({ ...prev, advance_km: event.target.value }))}
                  />
                ) : null}
              </div>
            </div>

            <div className="rounded-2xl border border-white/8 bg-black/20 p-4">
              <SectionLabel label="Recorrencia" info="Opcional. Ao concluir, o sistema cria automaticamente o proximo alerta usando esse intervalo." />
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {maintenanceTargetMode !== 'km' ? (
                  <Input
                    label="A cada dias"
                    inputMode="numeric"
                    value={maintenanceForm.repeat_interval_days}
                    onChange={(event) => setMaintenanceForm((prev) => ({ ...prev, repeat_interval_days: event.target.value }))}
                  />
                ) : null}
                {maintenanceTargetMode !== 'date' ? (
                  <Input
                    label="A cada km"
                    inputMode="decimal"
                    value={maintenanceForm.repeat_interval_km}
                    onChange={(event) => setMaintenanceForm((prev) => ({ ...prev, repeat_interval_km: event.target.value }))}
                  />
                ) : null}
              </div>
            </div>
          </div>

          <div>
            <SectionLabel label="Observacoes" info="Opcional. Use para detalhes como filtro, marca do oleo, oficina ou item a conferir." />
            <Input
              value={maintenanceForm.notes}
              onChange={(event) => setMaintenanceForm((prev) => ({ ...prev, notes: event.target.value }))}
              placeholder="Detalhes opcionais"
            />
          </div>

          <div className="flex justify-end gap-3 border-t border-white/8 pt-4">
            <Button variant="secondary" onClick={closeMaintenanceModal}>Cancelar</Button>
            <Button onClick={() => void handleSaveMaintenanceAlert()} isLoading={savingMaintenance}>
              {editingMaintenanceAlertId ? 'Salvar alerta' : 'Criar alerta'}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={showLogModal && Boolean(selectedVehicle)} onClose={closeLogModal} title={editingLogId ? 'Editar registro do carro' : 'Registrar uso do carro'} size="xl">
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
              <input type="file" accept="image/*" onChange={(event) => void handleLogPhoto(event)} disabled={uploadingLogImage || analyzingImage} className="mt-4 block w-full text-sm text-gray-400 file:mr-4 file:rounded-lg file:border-0 file:bg-orange-500 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white" />
              <p className="mt-2 text-xs text-gray-500">A imagem recebida e otimizada, enviada e lida primeiro por visao computacional local. A IA so entra quando houver duvida.</p>
            </div>
          </div>

          <div className="rounded-2xl border border-white/8 bg-black/20 p-4">
            <div className="grid gap-3 md:grid-cols-3">
              <MiniMetric label="Km lida" value={logForm.odometer_km || '-'} />
              <MiniMetric label="Combustivel" value={logForm.fuel_level_percent ? `${logForm.fuel_level_percent}% (${fuelRangeLabel(logForm.fuel_level_range)})` : fuelRangeLabel(logForm.fuel_level_range)} />
              <MiniMetric label="Barras" value={logForm.fuel_bars_filled && logForm.fuel_bars_total ? `${logForm.fuel_bars_filled}/${logForm.fuel_bars_total}` : '-'} />
            </div>
            <div className="mt-3">
              <MiniMetric label="Confianca da leitura" value={logForm.ai_confidence != null ? `${Math.round(logForm.ai_confidence * 100)}%` : '-'} />
            </div>
            {uploadingLogImage ? <p className="mt-2 text-xs text-orange-300">Enviando imagem otimizada...</p> : null}
            {analyzingImage ? <p className="mt-2 text-xs text-orange-300">Leitura computacional em andamento. Voce ja pode salvar e continuar.</p> : null}
            {analysisMethod ? <p className="mt-2 text-xs text-emerald-300">Metodo: {analysisMethod}{analysisDurationMs != null ? ` • ${Math.round(analysisDurationMs)} ms` : ''}</p> : null}
            {logForm.needs_review ? (
              <Alert variant="warning" className="mt-3">
                A leitura do combustivel precisa de conferencia manual antes de salvar.
              </Alert>
            ) : null}
            {logForm.ai_summary ? <Alert variant="info" className="mt-3">{logForm.ai_summary}</Alert> : null}
          </div>
          <Input label="Observacoes" value={logForm.notes} onChange={(event) => setLogForm((prev) => ({ ...prev, notes: event.target.value }))} />
          <div className="flex justify-end gap-3 border-t border-white/8 pt-4">
            <Button variant="secondary" onClick={closeLogModal}>Cancelar</Button>
            <Button onClick={() => void handleSaveLog()} isLoading={savingLog} disabled={uploadingLogImage}>
              {analyzingImage ? 'Salvar e continuar analise' : editingLogId ? 'Salvar alteracoes' : 'Salvar registro'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

function SectionLabel({ label, info }: { label: string; info: string }) {
  return (
    <div className="mb-2 flex min-h-6 items-center gap-1.5">
      <span className="text-sm font-medium leading-none text-gray-300">{label}</span>
      <InfoTip text={info} />
    </div>
  )
}

function InfoTip({ text }: { text: string }) {
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [position, setPosition] = useState<{ left: number; top: number; placement: 'top' | 'bottom' } | null>(null)

  const updatePosition = useCallback(() => {
    const button = buttonRef.current
    if (!button) return

    const rect = button.getBoundingClientRect()
    const width = 288
    const margin = 16
    const left = Math.min(
      Math.max(rect.left + rect.width / 2 - width / 2, margin),
      window.innerWidth - width - margin,
    )
    const bottomTop = rect.bottom + 8
    const estimatedHeight = 104
    const opensAbove = bottomTop + estimatedHeight > window.innerHeight - margin

    setPosition({
      left,
      top: opensAbove ? Math.max(rect.top - estimatedHeight - 8, margin) : bottomTop,
      placement: opensAbove ? 'top' : 'bottom',
    })
  }, [])

  useEffect(() => {
    if (!isOpen) return

    updatePosition()

    const handlePointerDown = (event: PointerEvent) => {
      if (buttonRef.current?.contains(event.target as Node)) return
      setIsOpen(false)
    }
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false)
    }

    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleEscape)

    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [isOpen, updatePosition])

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => {
          setIsOpen((current) => !current)
          window.requestAnimationFrame(updatePosition)
        }}
        className={`inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-lg border text-gray-400 transition-colors focus:outline-none focus:ring-2 focus:ring-orange-500/35 ${
          isOpen
            ? 'border-orange-400/45 bg-orange-500/15 text-orange-200'
            : 'border-white/10 bg-white/5 hover:border-orange-400/35 hover:bg-white/8 hover:text-orange-200'
        }`}
        aria-label="Informacao"
        aria-expanded={isOpen}
      >
        <Info size={12} />
      </button>
      {isOpen && position ? createPortal(
        <div
          className="fixed z-[80] w-72 rounded-2xl border border-white/10 bg-[#17181c] p-3 text-xs leading-relaxed text-gray-300 shadow-2xl shadow-black/45"
          style={{ left: position.left, top: position.top }}
          role="tooltip"
        >
          <div
            className={`absolute left-1/2 h-3 w-3 -translate-x-1/2 rotate-45 border-white/10 bg-[#17181c] ${
              position.placement === 'bottom'
                ? '-top-1.5 border-l border-t'
                : '-bottom-1.5 border-b border-r'
            }`}
          />
          <p className="relative">{text}</p>
        </div>,
        document.body,
      ) : null}
    </>
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
