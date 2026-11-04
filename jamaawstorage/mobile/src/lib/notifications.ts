import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Device from 'expo-device'
import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'
import type { VehicleMaintenanceAlertRow, VehicleRow } from '../data/database.types'
import { maintenanceState } from '../data/maintenance'

/**
 * Notificacao LOCAL de manutencao vencida.
 *
 * Como funciona: quando o app abre e encontra alerta vencido ou proximo,
 * agenda um lembiro diario no proprio aparelho. Nao precisa de servidor,
 * nao precisa de build na nuvem, funciona no Expo Go.
 *
 * O limite, que e real: notificacao local so e agendada quando o app roda.
 * Se o supervisor nao abrir o app por uma semana, nada chega nessa semana —
 * o agendamento ja feito continua disparando, mas um alerta que venceu
 * depois da ultima abertura nao gera aviso.
 *
 * Para aviso que chega com o app fechado e sem ninguem abrir nada, seria
 * preciso push remoto: Edge Function no Supabase (ja escrita em
 * supabase/functions/notify-maintenance) mais um build proprio do app com
 * credencial de push. Ver README, secao "Notificacao".
 */

const CHANNEL_ID = 'maintenance'
const SCHEDULED_KEY = 'jamaaw.notifications.scheduled'
/** Hora do lembrete: inicio do turno, antes de o supervisor sair para o patio. */
const REMINDER_HOUR = 7
const REMINDER_MINUTE = 0

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
})

export type PermissionState = 'granted' | 'denied' | 'undetermined' | 'unsupported'

export async function getPermissionState(): Promise<PermissionState> {
  if (!Device.isDevice) return 'unsupported'

  const { status } = await Notifications.getPermissionsAsync()
  if (status === 'granted') return 'granted'
  if (status === 'denied') return 'denied'
  return 'undetermined'
}

export async function requestPermission(): Promise<PermissionState> {
  if (!Device.isDevice) return 'unsupported'

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: 'Manutenção de veículos',
      importance: Notifications.AndroidImportance.HIGH,
      sound: 'default',
      // Sem cor customizada: o laranja da identidade e para acao preenchida
      // na tela, nao para enfeite de notificacao do sistema.
    })
  }

  const { status } = await Notifications.requestPermissionsAsync()
  return status === 'granted' ? 'granted' : status === 'denied' ? 'denied' : 'undetermined'
}

interface ScheduleInput {
  vehicles: VehicleRow[]
  alerts: VehicleMaintenanceAlertRow[]
  odometerByVehicle: Record<string, number | null>
}

export interface ScheduleResult {
  scheduled: boolean
  overdueCount: number
  dueSoonCount: number
  reason?: 'no_permission' | 'nothing_due' | 'unsupported'
}

/**
 * Reagenda o lembrete diario conforme o estado atual dos alertas.
 *
 * Sempre cancela o que havia antes: sem isso, cada abertura do app
 * empilharia uma notificacao a mais para o mesmo alerta.
 */
export async function syncMaintenanceReminder(input: ScheduleInput): Promise<ScheduleResult> {
  if (!Device.isDevice) {
    return { scheduled: false, overdueCount: 0, dueSoonCount: 0, reason: 'unsupported' }
  }

  const permission = await getPermissionState()

  const overdue: string[] = []
  const dueSoon: string[] = []

  for (const alert of input.alerts) {
    const vehicle = input.vehicles.find((candidate) => candidate.id === alert.vehicle_id)
    if (!vehicle) continue

    const state = maintenanceState(alert, input.odometerByVehicle[alert.vehicle_id] ?? null)
    const line = `${alert.title} · ${vehicle.plate ?? vehicle.code}`

    if (state.severity === 'overdue') overdue.push(line)
    else if (state.severity === 'due_soon') dueSoon.push(line)
  }

  await cancelMaintenanceReminder()

  if (overdue.length === 0 && dueSoon.length === 0) {
    return { scheduled: false, overdueCount: 0, dueSoonCount: 0, reason: 'nothing_due' }
  }

  if (permission !== 'granted') {
    return {
      scheduled: false,
      overdueCount: overdue.length,
      dueSoonCount: dueSoon.length,
      reason: 'no_permission',
    }
  }

  const title =
    overdue.length > 0
      ? overdue.length === 1
        ? 'Manutenção vencida'
        : `${overdue.length} manutenções vencidas`
      : dueSoon.length === 1
        ? 'Manutenção próxima'
        : `${dueSoon.length} manutenções próximas`

  // Corpo com os itens, nao so a contagem: o aviso deve ser util na tela
  // de bloqueio, sem precisar abrir o app.
  const lines = [...overdue, ...dueSoon].slice(0, 3)
  const extra = overdue.length + dueSoon.length - lines.length
  const body = extra > 0 ? `${lines.join('\n')}\n+${extra} outras` : lines.join('\n')

  const identifier = await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      data: { screen: 'vehicles' },
      ...(Platform.OS === 'android' ? { channelId: CHANNEL_ID } : {}),
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour: REMINDER_HOUR,
      minute: REMINDER_MINUTE,
    },
  })

  await AsyncStorage.setItem(SCHEDULED_KEY, identifier).catch(() => {
    // Sem o id guardado o cancelamento cai no fallback de cancelar tudo.
  })

  return { scheduled: true, overdueCount: overdue.length, dueSoonCount: dueSoon.length }
}

export async function cancelMaintenanceReminder(): Promise<void> {
  try {
    const identifier = await AsyncStorage.getItem(SCHEDULED_KEY)

    if (identifier) {
      await Notifications.cancelScheduledNotificationAsync(identifier)
      await AsyncStorage.removeItem(SCHEDULED_KEY)
      return
    }

    // Sem id guardado: cancela os agendamentos deste app. Seguro porque
    // este e o unico lembrete que o app agenda.
    await Notifications.cancelAllScheduledNotificationsAsync()
  } catch {
    // Nada a fazer: o pior caso e um lembrete a mais, nunca um dado errado.
  }
}
