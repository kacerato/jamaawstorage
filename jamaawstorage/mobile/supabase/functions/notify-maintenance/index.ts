// deno-lint-ignore-file no-explicit-any
/**
 * notify-maintenance — push de manutencao vencida.
 *
 * ESTADO: escrita e pronta para deploy, NAO ativada.
 *
 * Por que nao esta ativa: push remoto exige que o app tenha um build proprio
 * com credencial de notificacao (FCM no Android). O Expo Go nao recebe push
 * remoto — e limite da plataforma, nao desta funcao. Enquanto nao houver
 * build, o app usa notificacao local (src/lib/notifications.ts), que cobre
 * o caso de "abri o app e tem revisao vencida".
 *
 * O que falta para ligar (ordem):
 *   1. Criar a tabela de tokens (migration abaixo, em migrations/).
 *   2. Fazer o app registrar o token: expo-notifications
 *      getExpoPushTokenAsync() e gravar em push_tokens.
 *   3. Build do app:  npx eas build -p android --profile preview
 *   4. Deploy:  npx supabase functions deploy notify-maintenance
 *   5. Agendar:  pg_cron chamando esta funcao 1x/dia, ou um job no Railway
 *      batendo na URL dela com o header de autorizacao.
 *
 * A funcao e idempotente por dia: grava a data do ultimo envio por alerta
 * em push_tokens.last_notified_on e nao reenvia o mesmo alerta no mesmo dia.
 */

import { createClient } from 'jsr:@supabase/supabase-js@2'

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send'

interface MaintenanceAlert {
  id: string
  vehicle_id: string
  title: string
  alert_type: string
  due_date: string | null
  due_odometer_km: number | null
  advance_days: number
  advance_km: number
  status: string
}

interface Vehicle {
  id: string
  code: string
  plate: string | null
}

type Severity = 'overdue' | 'due_soon' | 'ok'

/**
 * Mesma regra de src/data/maintenance.ts e do painel web.
 * Se mudar aqui, mudar nos tres lugares — o app nao pode discordar
 * do site sobre o que esta vencido.
 */
function severityOf(alert: MaintenanceAlert, odometerKm: number | null): Severity {
  if (alert.status !== 'active') return 'ok'

  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)

  const daysLeft = alert.due_date
    ? Math.ceil((new Date(`${alert.due_date}T00:00:00Z`).getTime() - today.getTime()) / 86_400_000)
    : null

  const kmLeft =
    alert.due_odometer_km != null && odometerKm != null ? alert.due_odometer_km - odometerKm : null

  if ((daysLeft != null && daysLeft < 0) || (kmLeft != null && kmLeft <= 0)) return 'overdue'
  if (
    (daysLeft != null && daysLeft <= alert.advance_days) ||
    (kmLeft != null && kmLeft <= alert.advance_km)
  ) {
    return 'due_soon'
  }
  return 'ok'
}

Deno.serve(async (request: Request) => {
  // Só aceita chamada autenticada: a função dispara push para todos os
  // supervisores, então não pode ficar aberta.
  const authHeader = request.headers.get('Authorization')
  const expectedSecret = Deno.env.get('NOTIFY_SECRET')

  if (!expectedSecret || authHeader !== `Bearer ${expectedSecret}`) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    // Service role: a função precisa ler alertas de todos os veículos,
    // sem passar pela RLS de um supervisor específico.
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const [alertsResult, vehiclesResult, logsResult, tokensResult] = await Promise.all([
    supabase
      .from('vehicle_maintenance_alerts')
      .select(
        'id, vehicle_id, title, alert_type, due_date, due_odometer_km, advance_days, advance_km, status',
      )
      .eq('status', 'active'),
    supabase.from('vehicles').select('id, code, plate').eq('is_active', true),
    supabase.from('vehicle_usage_logs').select('vehicle_id, odometer_km'),
    supabase.from('push_tokens').select('token, profile_id, last_notified_on'),
  ])

  const failure = [alertsResult, vehiclesResult, logsResult, tokensResult].find((r) => r.error)
  if (failure?.error) {
    return new Response(JSON.stringify({ error: failure.error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const alerts = (alertsResult.data ?? []) as MaintenanceAlert[]
  const vehicles = (vehiclesResult.data ?? []) as Vehicle[]
  const logs = (logsResult.data ?? []) as { vehicle_id: string; odometer_km: number | null }[]
  const tokens = (tokensResult.data ?? []) as {
    token: string
    profile_id: string
    last_notified_on: string | null
  }[]

  // Odômetro atual = maior leitura, igual ao app: um lançamento fora de
  // ordem não deve fazer o km "voltar".
  const odometerByVehicle = new Map<string, number>()
  for (const log of logs) {
    if (log.odometer_km == null) continue
    const current = odometerByVehicle.get(log.vehicle_id) ?? Number.NEGATIVE_INFINITY
    if (log.odometer_km > current) odometerByVehicle.set(log.vehicle_id, log.odometer_km)
  }

  const overdue: string[] = []
  const dueSoon: string[] = []

  for (const alert of alerts) {
    const vehicle = vehicles.find((candidate) => candidate.id === alert.vehicle_id)
    if (!vehicle) continue

    const severity = severityOf(alert, odometerByVehicle.get(alert.vehicle_id) ?? null)
    const line = `${alert.title} · ${vehicle.plate ?? vehicle.code}`

    if (severity === 'overdue') overdue.push(line)
    else if (severity === 'due_soon') dueSoon.push(line)
  }

  if (overdue.length === 0 && dueSoon.length === 0) {
    return Response.json({ sent: 0, reason: 'nothing_due' })
  }

  const today = new Date().toISOString().slice(0, 10)
  // Idempotência por dia: um job que roda de hora em hora não vira spam.
  const recipients = tokens.filter((entry) => entry.last_notified_on !== today)

  if (recipients.length === 0) {
    return Response.json({ sent: 0, reason: 'already_notified_today' })
  }

  const title =
    overdue.length > 0
      ? overdue.length === 1
        ? 'Manutenção vencida'
        : `${overdue.length} manutenções vencidas`
      : dueSoon.length === 1
        ? 'Manutenção próxima'
        : `${dueSoon.length} manutenções próximas`

  const lines = [...overdue, ...dueSoon].slice(0, 3)
  const extra = overdue.length + dueSoon.length - lines.length
  const body = extra > 0 ? `${lines.join('\n')}\n+${extra} outras` : lines.join('\n')

  const messages = recipients.map((entry) => ({
    to: entry.token,
    title,
    body,
    sound: 'default',
    priority: 'high',
    channelId: 'maintenance',
    data: { screen: 'vehicles' },
  }))

  const pushResponse = await fetch(EXPO_PUSH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(messages),
  })

  const pushResult = (await pushResponse.json()) as { data?: any[]; errors?: any[] }

  // Remove token que o Expo reportou como inválido (app desinstalado,
  // token rotacionado). Sem isso a tabela acumula lixo e cada envio
  // repete o mesmo erro.
  const invalidTokens: string[] = []
  pushResult.data?.forEach((ticket, index) => {
    if (ticket?.status === 'error' && ticket?.details?.error === 'DeviceNotRegistered') {
      invalidTokens.push(recipients[index].token)
    }
  })

  if (invalidTokens.length > 0) {
    await supabase.from('push_tokens').delete().in('token', invalidTokens)
  }

  const deliveredTokens = recipients
    .map((entry) => entry.token)
    .filter((token) => !invalidTokens.includes(token))

  if (deliveredTokens.length > 0) {
    await supabase
      .from('push_tokens')
      .update({ last_notified_on: today })
      .in('token', deliveredTokens)
  }

  return Response.json({
    sent: deliveredTokens.length,
    removed: invalidTokens.length,
    overdue: overdue.length,
    dueSoon: dueSoon.length,
  })
})
