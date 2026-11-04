import { useMemo, useState } from 'react'
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native'
import {
  Body,
  Divider,
  EmptyState,
  Label,
  LoadingState,
  Notice,
  Num,
  Pill,
} from '../components/primitives'
import { ScreenHeader } from '../components/ScreenHeader'
import {
  CLASS_LABEL,
  WINDOW_DAYS,
  computeConsumption,
  formatHorizon,
  formatRate,
  repositionUrgency,
  sortByUrgency,
  suggestedPurchase,
  type ItemConsumption,
} from '../data/consumption'
import { fetchStockSnapshot } from '../data/queries'
import { formatAge, useCachedQuery } from '../data/useCachedQuery'
import { RULE, TOUCH, color, font, space } from '../theme/tokens'

type Tab = 'reposition' | 'moving'

export function ConsumptionScreen() {
  const query = useCachedQuery('stock', fetchStockSnapshot)
  const [tab, setTab] = useState<Tab>('reposition')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const rows = useMemo(() => {
    if (!query.data) return []
    return computeConsumption(query.data.items, query.data.events)
  }, [query.data])

  /** Topo da tela = o que comprar agora. Decisao, nao relatorio. */
  const reposition = useMemo(
    () => sortByUrgency(rows.filter((row) => suggestedPurchase(row) != null)),
    [rows],
  )

  /** O que esta saindo, por volume. Responde "para onde vai o material". */
  const moving = useMemo(
    () => rows.filter((row) => row.net > 0).sort((left, right) => right.net - left.net),
    [rows],
  )

  const visible = tab === 'reposition' ? reposition : moving

  const critCount = reposition.filter((row) => repositionUrgency(row) === 'crit').length

  if (query.loading && rows.length === 0) {
    return (
      <View style={styles.screen}>
        <ScreenHeader title="Consumo" />
        <LoadingState what="Calculando consumo dos últimos 90 dias" />
      </View>
    )
  }

  if (query.error && rows.length === 0) {
    return (
      <View style={styles.screen}>
        <ScreenHeader title="Consumo" />
        <View style={styles.padded}>
          <Notice severity="crit">{query.error}</Notice>
        </View>
        <EmptyState
          title="Nenhum dado disponível"
          hint="Puxe para atualizar."
        />
      </View>
    )
  }

  return (
    <View style={styles.screen}>
      <ScreenHeader
        title="Consumo"
        age={formatAge(query.fetchedAt)}
        stale={query.stale}
        summary={
          critCount > 0
            ? `${critCount} ${critCount === 1 ? 'item crítico' : 'itens críticos'} · ${reposition.length} para repor`
            : `${reposition.length} itens para repor`
        }
      />

      <FlatList
        data={visible}
        keyExtractor={(row) => row.item.id}
        refreshControl={
          <RefreshControl
            refreshing={query.refreshing}
            onRefresh={query.refresh}
            tintColor={color.inkMute}
            colors={[color.blaze]}
            progressBackgroundColor={color.surface}
          />
        }
        ListHeaderComponent={
          <View style={styles.controls}>
            {query.stale ? (
              <Notice severity="warn">
                Dados salvos no aparelho. Atualização falhou.
              </Notice>
            ) : null}

            <View style={styles.tabRow}>
              <TabButton
                label="Repor"
                active={tab === 'reposition'}
                onPress={() => setTab('reposition')}
              />
              <TabButton
                label="Saindo"
                active={tab === 'moving'}
                onPress={() => setTab('moving')}
              />
            </View>

            {/* Rótulo da janela, não explicação da metodologia: o detalhe
                de cada item já diz por que ele entra ou não na previsão. */}
            <Label>Últimos {WINDOW_DAYS} dias</Label>
          </View>
        }
        renderItem={({ item: row }) => (
          <ConsumptionRow
            row={row}
            mode={tab}
            expanded={expandedId === row.item.id}
            onToggle={() => setExpandedId(expandedId === row.item.id ? null : row.item.id)}
          />
        )}
        ItemSeparatorComponent={() => <Divider />}
        ListEmptyComponent={
          <EmptyState
            title={
              tab === 'reposition'
                ? 'Nada para repor agora'
                : 'Nenhuma saída registrada na janela'
            }
            hint={
              tab === 'reposition'
                ? 'Todos os itens estão acima do mínimo com folga.'
                : `Sem movimentação de saída nos últimos ${WINDOW_DAYS} dias.`
            }
          />
        }
        contentContainerStyle={styles.listContent}
      />
    </View>
  )
}

function TabButton({
  label,
  active,
  onPress,
}: {
  label: string
  active: boolean
  onPress: () => void
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.tab,
        active ? styles.tabActive : null,
        pressed ? styles.pressed : null,
      ]}
    >
      <Body dim={!active} style={[styles.tabLabel, active ? styles.tabLabelActive : null]}>
        {label}
      </Body>
    </Pressable>
  )
}

function ConsumptionRow({
  row,
  mode,
  expanded,
  onToggle,
}: {
  row: ItemConsumption
  mode: Tab
  expanded: boolean
  onToggle: () => void
}) {
  const urgency = repositionUrgency(row)
  const purchase = suggestedPurchase(row)
  const rate = formatRate(row.dailyRate)
  const horizon = formatHorizon(row.daysToMinimum)

  return (
    <Pressable
      onPress={onToggle}
      style={({ pressed }) => [
        styles.row,
        { borderLeftColor: color[urgency] },
        pressed ? styles.pressed : null,
      ]}
    >
      <View style={styles.rowMain}>
        <View style={styles.rowText}>
          <Body numberOfLines={1} style={styles.itemName}>
            {row.item.name}
          </Body>

          {mode === 'reposition' ? (
            <Body dim style={styles.rowDetail}>
              {row.depleted
                ? 'Estoque zerado'
                : row.belowMinimum
                  ? `${row.item.current_quantity} em estoque, mínimo ${row.item.minimum_quantity}`
                  : (horizon ?? `${row.item.current_quantity} em estoque`)}
            </Body>
          ) : (
            <Body dim style={styles.rowDetail}>
              {rate ?? `${row.distinctDays} ${row.distinctDays === 1 ? 'dia' : 'dias'} com saída`}
            </Body>
          )}
        </View>

        <View style={styles.rowNumbers}>
          {mode === 'reposition' && purchase != null ? (
            <>
              <Num severity={urgency === 'ok' ? undefined : urgency} size={22}>
                {purchase}
              </Num>
              <Label>comprar</Label>
            </>
          ) : (
            <>
              <Num size={22}>{row.net}</Num>
              <Label>saiu</Label>
            </>
          )}
        </View>
      </View>

      {expanded ? (
        <View style={styles.detail}>
          <Divider />

          <View style={styles.detailHeader}>
            <Pill severity={row.classification === 'consumable' ? 'ok' : 'warn'}>
              {CLASS_LABEL[row.classification]}
            </Pill>
            <Label>{row.item.code}</Label>
          </View>

          <View style={styles.detailGrid}>
            <Fact label="Em estoque" value={String(row.item.current_quantity)} />
            <Fact label="Mínimo" value={String(row.item.minimum_quantity)} />
            <Fact label={`Saiu ${WINDOW_DAYS}d`} value={String(row.outflow)} />
            <Fact label="Voltou" value={String(row.returned)} />
          </View>

          {row.classification === 'consumable' ? (
            <Body mute style={styles.detailNote}>
              {rate ? `Ritmo de ${rate}. ` : ''}
              {horizon ? `Cruza o mínimo em ${horizon}. ` : ''}
              Previsão é faixa, não data exata: itens de baixo volume oscilam
              bastante de um período para o outro.
            </Body>
          ) : row.classification === 'durable' ? (
            <Body mute style={styles.detailNote}>
              {Math.round(row.returnRatio * 100)}% do que saiu voltou. Este item circula
              e volta, então previsão de ruptura não se aplica — o que importa é
              quanto está na mão de quem.
            </Body>
          ) : row.classification === 'insufficient' ? (
            <Body mute style={styles.detailNote}>
              Saiu em apenas {row.distinctDays}{' '}
              {row.distinctDays === 1 ? 'dia' : 'dias'} na janela. Histórico curto
              demais para estimar ritmo com honestidade.
            </Body>
          ) : (
            <Body mute style={styles.detailNote}>
              Sem nenhuma saída nos últimos {WINDOW_DAYS} dias.
            </Body>
          )}
        </View>
      ) : null}
    </Pressable>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.fact}>
      <Label>{label}</Label>
      <Num size={16}>{value}</Num>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.void },
  padded: { paddingHorizontal: space.lg, paddingTop: space.md },
  listContent: { paddingBottom: space.xxl },

  controls: { gap: space.md, padding: space.lg },
  tabRow: { flexDirection: 'row', gap: space.sm },
  tab: {
    flex: 1,
    minHeight: TOUCH,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: color.line,
  },
  tabActive: { backgroundColor: color.blaze, borderColor: color.blaze },
  tabLabel: { fontSize: 14 },
  tabLabelActive: { color: color.blazeInk, fontFamily: font.textMedium },
  windowNote: { fontSize: 12, lineHeight: 17 },

  row: {
    borderLeftWidth: RULE,
    // Linha alta e com folga: alvo de toque grande e leitura tranquila
    // com o celular numa mao so.
    paddingVertical: space.lg,
    paddingHorizontal: space.lg,
    minHeight: TOUCH + space.xl,
  },
  rowMain: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  rowText: { flex: 1, minWidth: 0, gap: 2 },
  itemName: { fontFamily: font.textMedium, fontSize: 15 },
  rowDetail: { fontSize: 12 },
  rowNumbers: { alignItems: 'flex-end', gap: 2 },

  detail: { paddingTop: space.md, gap: space.md },
  detailHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: space.sm,
  },
  detailGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.lg },
  fact: { gap: 2, minWidth: 64 },
  detailNote: { fontSize: 12, lineHeight: 17 },

  pressed: { opacity: 0.6 },
})
