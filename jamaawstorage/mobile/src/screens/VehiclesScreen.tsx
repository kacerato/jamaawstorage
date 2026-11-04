import { useEffect, useMemo, useState } from 'react'
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native'
import {
  Body,
  Divider,
  EmptyState,
  GhostButton,
  Heading,
  Label,
  LoadingState,
  Meter,
  Notice,
  Num,
  Pill,
  Surface,
} from '../components/primitives'
import { ScreenHeader } from '../components/ScreenHeader'
import type { VehicleRow, VehicleUsageLogRow } from '../data/database.types'
import {
  ALERT_TYPE_LABEL,
  currentOdometer,
  formatDateTime,
  fuelPercent,
  lastReading,
  lastRefuel,
  maintenanceState,
  sortAlerts,
  targetSummary,
  type MaintenanceSeverity,
} from '../data/maintenance'
import { fetchFleetSnapshot } from '../data/queries'
import { formatAge, useCachedQuery } from '../data/useCachedQuery'
import {
  getPermissionState,
  requestPermission,
  syncMaintenanceReminder,
  type PermissionState,
} from '../lib/notifications'
import { RULE, color, font, space, type Severity } from '../theme/tokens'

/** Severidade de alerta para token de cor. */
function severityToken(severity: MaintenanceSeverity): Severity {
  if (severity === 'overdue') return 'crit'
  if (severity === 'due_soon') return 'warn'
  return 'ok'
}

export function VehiclesScreen() {
  const query = useCachedQuery('fleet', fetchFleetSnapshot)
  const [permission, setPermission] = useState<PermissionState>('undetermined')
  const [reminderNote, setReminderNote] = useState<string | null>(null)

  const vehicles = query.data?.vehicles ?? []
  const logs = query.data?.logs ?? []
  const alerts = query.data?.alerts ?? []
  const people = query.data?.people ?? []

  const odometerByVehicle = useMemo(() => {
    const result: Record<string, number | null> = {}
    for (const vehicle of vehicles) {
      result[vehicle.id] = currentOdometer(logs.filter((log) => log.vehicle_id === vehicle.id))
    }
    return result
  }, [vehicles, logs])

  const alertCounts = useMemo(() => {
    let overdue = 0
    let dueSoon = 0
    for (const alert of alerts) {
      const state = maintenanceState(alert, odometerByVehicle[alert.vehicle_id] ?? null)
      if (state.severity === 'overdue') overdue += 1
      else if (state.severity === 'due_soon') dueSoon += 1
    }
    return { overdue, dueSoon }
  }, [alerts, odometerByVehicle])

  useEffect(() => {
    void getPermissionState().then(setPermission)
  }, [])

  // Reagenda o lembrete sempre que os alertas mudam.
  useEffect(() => {
    if (!query.data) return

    void syncMaintenanceReminder({ vehicles, alerts, odometerByVehicle }).then((result) => {
      if (result.scheduled) {
        setReminderNote('Lembrete diário ativo às 7h para as manutenções pendentes.')
      } else if (result.reason === 'no_permission') {
        setReminderNote(null)
      } else {
        setReminderNote(null)
      }
    })
  }, [query.data, vehicles, alerts, odometerByVehicle])

  const enableNotifications = async () => {
    const next = await requestPermission()
    setPermission(next)

    if (next === 'granted') {
      const result = await syncMaintenanceReminder({ vehicles, alerts, odometerByVehicle })
      setReminderNote(
        result.scheduled
          ? 'Lembrete diário ativo às 7h para as manutenções pendentes.'
          : 'Avisos ativados. Nenhuma manutenção pendente para lembrar agora.',
      )
    }
  }

  if (query.loading && vehicles.length === 0) {
    return (
      <View style={styles.screen}>
        <ScreenHeader title="Carros" />
        <LoadingState what="Carregando frota e alertas" />
      </View>
    )
  }

  if (query.error && vehicles.length === 0) {
    return (
      <View style={styles.screen}>
        <ScreenHeader title="Carros" />
        <View style={styles.padded}>
          <Notice severity="crit">{query.error}</Notice>
        </View>
        <EmptyState
          title="Nenhum dado disponível"
          hint="Puxe a tela para baixo para tentar de novo quando houver sinal."
        />
      </View>
    )
  }

  const summary =
    alertCounts.overdue > 0
      ? `${alertCounts.overdue} ${alertCounts.overdue === 1 ? 'manutenção vencida' : 'manutenções vencidas'}`
      : alertCounts.dueSoon > 0
        ? `${alertCounts.dueSoon} ${alertCounts.dueSoon === 1 ? 'manutenção próxima' : 'manutenções próximas'}`
        : `${vehicles.length} ${vehicles.length === 1 ? 'veículo' : 'veículos'} · manutenções em dia`

  return (
    <View style={styles.screen}>
      <ScreenHeader
        title="Carros"
        age={formatAge(query.fetchedAt)}
        stale={query.stale}
        summary={summary}
      />

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={query.refreshing}
            onRefresh={query.refresh}
            tintColor={color.inkMute}
            colors={[color.blaze]}
            progressBackgroundColor={color.surface}
          />
        }
      >
        {query.stale ? (
          <Notice severity="warn">
            Mostrando dados salvos no aparelho. A atualização falhou.
          </Notice>
        ) : null}

        {permission !== 'granted' && permission !== 'unsupported' ? (
          <Surface style={styles.permissionCard}>
            <Body dim style={styles.permissionText}>
              Ativar aviso no celular quando uma manutenção vencer.
            </Body>
            <GhostButton label="Ativar avisos" onPress={() => void enableNotifications()} />
          </Surface>
        ) : null}

        {reminderNote ? (
          <Body mute style={styles.reminderNote}>
            {reminderNote}
          </Body>
        ) : null}

        {vehicles.length === 0 ? (
          <EmptyState
            title="Nenhum veículo cadastrado"
            hint="Cadastre a frota no painel web; este app é somente consulta."
          />
        ) : (
          vehicles.map((vehicle) => (
            <VehicleCard
              key={vehicle.id}
              vehicle={vehicle}
              logs={logs.filter((log) => log.vehicle_id === vehicle.id)}
              alerts={sortAlerts(
                alerts.filter((alert) => alert.vehicle_id === vehicle.id),
                odometerByVehicle[vehicle.id] ?? null,
              )}
              odometer={odometerByVehicle[vehicle.id] ?? null}
              responsibleName={
                people.find((person) => person.id === vehicle.responsible_person_id)?.full_name ??
                null
              }
            />
          ))
        )}
      </ScrollView>
    </View>
  )
}

function VehicleCard({
  vehicle,
  logs,
  alerts,
  odometer,
  responsibleName,
}: {
  vehicle: VehicleRow
  logs: VehicleUsageLogRow[]
  alerts: ReturnType<typeof sortAlerts>
  odometer: number | null
  responsibleName: string | null
}) {
  const refuel = lastRefuel(logs)
  const reading = lastReading(logs)
  const fuel = fuelPercent(refuel ?? reading)

  const fuelSeverity: Severity = fuel == null ? 'ok' : fuel <= 25 ? 'crit' : fuel <= 50 ? 'warn' : 'ok'

  return (
    <Surface style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.cardTitle}>
          <Heading>{vehicle.plate ?? vehicle.code}</Heading>
          <Label>
            {vehicle.model}
            {vehicle.year ? ` · ${vehicle.year}` : ''}
          </Label>
        </View>
        {responsibleName ? (
          <View style={styles.cardResponsible}>
            <Label>Responsável</Label>
            <Body dim style={styles.responsibleName}>
              {responsibleName}
            </Body>
          </View>
        ) : null}
      </View>

      <Divider />

      <View style={styles.metrics}>
        <View style={styles.metric}>
          <Label>Quilometragem</Label>
          {odometer != null ? (
            <Num size={24}>{odometer.toLocaleString('pt-BR')}</Num>
          ) : (
            <Body mute style={styles.metricEmpty}>
              sem leitura
            </Body>
          )}
          {odometer != null ? <Label>km</Label> : null}
        </View>

        <View style={styles.metric}>
          <Label>Combustível</Label>
          {fuel != null ? (
            <>
              <Num size={24} severity={fuelSeverity === 'ok' ? undefined : fuelSeverity}>
                {fuel}%
              </Num>
              <View style={styles.meterWrap}>
                <Meter ratio={fuel / 100} severity={fuelSeverity} />
              </View>
            </>
          ) : (
            <Body mute style={styles.metricEmpty}>
              sem leitura
            </Body>
          )}
        </View>
      </View>

      {reading ? (
        <>
          <Divider />
          <View style={styles.lastReading}>
            <Label>Último registro</Label>
            <Body dim style={styles.lastReadingText}>
              {formatDateTime(reading.occurred_at)}
              {refuel?.station_name ? ` · ${refuel.station_name}` : ''}
            </Body>
          </View>
        </>
      ) : null}

      <Divider />

      <View style={styles.alertSection}>
        <Label>Manutenção</Label>

        {alerts.length === 0 ? (
          <Body mute style={styles.alertEmpty}>
            Nenhum alerta cadastrado para este veículo. Cadastre troca de óleo,
            revisão, pneus ou documento no painel web para acompanhar aqui.
          </Body>
        ) : (
          <View style={styles.alertList}>
            {alerts.map((alert) => {
              const state = maintenanceState(alert, odometer)
              const token = severityToken(state.severity)

              return (
                <View
                  key={alert.id}
                  style={[styles.alertRow, { borderLeftColor: color[token] }]}
                >
                  <View style={styles.alertMain}>
                    <Body style={styles.alertTitle} numberOfLines={1}>
                      {alert.title}
                    </Body>
                    <Pill severity={token}>{state.label}</Pill>
                  </View>

                  <Body mute style={styles.alertTarget}>
                    {ALERT_TYPE_LABEL[alert.alert_type]} · {targetSummary(alert)}
                  </Body>

                  {state.severity !== 'done' && state.severity !== 'off' ? (
                    <Body dim style={styles.alertDistance}>
                      {describeDistance(state.daysLeft, state.kmLeft)}
                    </Body>
                  ) : null}
                </View>
              )
            })}
          </View>
        )}
      </View>
    </Surface>
  )
}

/** "vencida há 3 dias", "faltam 12 dias", "faltam 400 km". */
function describeDistance(daysLeft: number | null, kmLeft: number | null): string {
  const parts: string[] = []

  if (daysLeft != null) {
    if (daysLeft < 0) parts.push(`vencida há ${Math.abs(daysLeft)} ${Math.abs(daysLeft) === 1 ? 'dia' : 'dias'}`)
    else if (daysLeft === 0) parts.push('vence hoje')
    else parts.push(`faltam ${daysLeft} ${daysLeft === 1 ? 'dia' : 'dias'}`)
  }

  if (kmLeft != null) {
    if (kmLeft <= 0) parts.push(`${Math.abs(kmLeft).toLocaleString('pt-BR')} km além do alvo`)
    else parts.push(`faltam ${kmLeft.toLocaleString('pt-BR')} km`)
  }

  return parts.length > 0 ? parts.join(' · ') : 'sem alvo definido'
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.void },
  padded: { paddingHorizontal: space.lg, paddingTop: space.md },
  content: { padding: space.lg, gap: space.lg, paddingBottom: space.xxl },

  permissionCard: { padding: space.lg, gap: space.md },
  permissionText: { fontSize: 13 },
  reminderNote: { fontSize: 12, paddingHorizontal: space.xs },

  card: { paddingVertical: space.lg, gap: space.lg },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: space.lg,
    gap: space.md,
  },
  cardTitle: { gap: 2, flex: 1, minWidth: 0 },
  cardResponsible: { alignItems: 'flex-end', gap: 2 },
  responsibleName: { fontSize: 13 },

  metrics: { flexDirection: 'row', paddingHorizontal: space.lg, gap: space.xxl },
  metric: { gap: 2, minWidth: 100 },
  metricEmpty: { fontSize: 13, paddingVertical: space.xs },
  meterWrap: { marginTop: space.xs, width: 92 },

  lastReading: { paddingHorizontal: space.lg, gap: 2 },
  lastReadingText: { fontSize: 12 },

  alertSection: { paddingHorizontal: space.lg, gap: space.sm },
  alertEmpty: { fontSize: 12, lineHeight: 17 },
  alertList: { gap: space.sm },
  alertRow: {
    backgroundColor: color.void,
    borderLeftWidth: RULE,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    gap: 2,
  },
  alertMain: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
  },
  alertTitle: { fontFamily: font.textMedium, fontSize: 14, flex: 1, minWidth: 0 },
  alertTarget: { fontSize: 11 },
  alertDistance: { fontSize: 12 },
})
