import { useMemo, useState } from 'react'
import { FlatList, Pressable, RefreshControl, StyleSheet, TextInput, View } from 'react-native'
import {
  Body,
  Divider,
  EmptyState,
  Label,
  LoadingState,
  Notice,
  Num,
} from '../components/primitives'
import { ScreenHeader } from '../components/ScreenHeader'
import type { StockItemRow } from '../data/database.types'
import { fetchStockSnapshot } from '../data/queries'
import { formatAge, useCachedQuery } from '../data/useCachedQuery'
import { HAIRLINE, RULE, TOUCH, color, font, space } from '../theme/tokens'

type Filter = 'all' | 'low' | 'zero'

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'Todos' },
  { key: 'low', label: 'Abaixo do mínimo' },
  { key: 'zero', label: 'Zerados' },
]

function itemSeverity(item: StockItemRow): 'crit' | 'warn' | 'ok' {
  if (item.current_quantity <= 0) return 'crit'
  if (item.current_quantity <= item.minimum_quantity) return 'warn'
  return 'ok'
}

export function StockScreen() {
  const query = useCachedQuery('stock', fetchStockSnapshot)
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const items = query.data?.items ?? []

  const counts = useMemo(() => {
    let low = 0
    let zero = 0
    for (const item of items) {
      if (item.current_quantity <= 0) zero += 1
      else if (item.current_quantity <= item.minimum_quantity) low += 1
    }
    return { total: items.length, low, zero }
  }, [items])

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase()

    const filtered = items.filter((item) => {
      if (filter === 'low' && item.current_quantity > item.minimum_quantity) return false
      if (filter === 'zero' && item.current_quantity > 0) return false

      if (term.length > 0) {
        const haystack = `${item.name} ${item.code} ${item.category ?? ''}`.toLowerCase()
        if (!haystack.includes(term)) return false
      }
      return true
    })

    // Mais urgente primeiro: zerado, depois abaixo do minimo, depois nome.
    const weight = { crit: 0, warn: 1, ok: 2 } as const
    return filtered.sort((left, right) => {
      const bySeverity = weight[itemSeverity(left)] - weight[itemSeverity(right)]
      if (bySeverity !== 0) return bySeverity
      return left.name.localeCompare(right.name, 'pt-BR')
    })
  }, [items, filter, search])

  if (query.loading && items.length === 0) {
    return (
      <View style={styles.screen}>
        <ScreenHeader title="Estoque" />
        <LoadingState what="Carregando itens do estoque" />
      </View>
    )
  }

  if (query.error && items.length === 0) {
    return (
      <View style={styles.screen}>
        <ScreenHeader title="Estoque" />
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

  return (
    <View style={styles.screen}>
      <ScreenHeader
        title="Estoque"
        age={formatAge(query.fetchedAt)}
        stale={query.stale}
        summary={`${counts.total} itens · ${counts.zero + counts.low} precisam de atenção`}
      />

      <FlatList
        data={visible}
        keyExtractor={(item) => item.id}
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
                Mostrando dados salvos no aparelho. A atualização falhou.
              </Notice>
            ) : null}

            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Buscar item ou código"
              placeholderTextColor={color.inkMute}
              autoCapitalize="none"
              autoCorrect={false}
              clearButtonMode="while-editing"
              style={styles.search}
            />

            <View style={styles.filterRow}>
              {FILTERS.map((option) => {
                const active = filter === option.key
                const badge =
                  option.key === 'low' ? counts.low : option.key === 'zero' ? counts.zero : null

                return (
                  <Pressable
                    key={option.key}
                    onPress={() => setFilter(option.key)}
                    style={({ pressed }) => [
                      styles.filterChip,
                      active ? styles.filterChipActive : null,
                      pressed ? styles.pressed : null,
                    ]}
                  >
                    <Body
                      dim={!active}
                      style={[styles.filterLabel, active ? styles.filterLabelActive : null]}
                    >
                      {option.label}
                      {badge != null && badge > 0 ? ` ${badge}` : ''}
                    </Body>
                  </Pressable>
                )
              })}
            </View>
          </View>
        }
        renderItem={({ item }) => {
          const severity = itemSeverity(item)
          const expanded = expandedId === item.id
          const hasBreakdown =
            item.quantity_new + item.quantity_used + item.quantity_damaged > 0

          return (
            <Pressable
              onPress={() => setExpandedId(expanded ? null : item.id)}
              style={({ pressed }) => [
                styles.row,
                { borderLeftColor: color[severity] },
                pressed ? styles.pressed : null,
              ]}
            >
              <View style={styles.rowMain}>
                <View style={styles.rowText}>
                  <Body numberOfLines={1} style={styles.itemName}>
                    {item.name}
                  </Body>
                  <Label>
                    {item.code}
                    {item.category ? ` · ${item.category}` : ''}
                  </Label>
                </View>

                <View style={styles.rowNumbers}>
                  <Num severity={severity === 'ok' ? undefined : severity} size={22}>
                    {item.current_quantity}
                  </Num>
                  <Label>mín {item.minimum_quantity}</Label>
                </View>
              </View>

              {expanded ? (
                <View style={styles.breakdown}>
                  <Divider />
                  {hasBreakdown ? (
                    <View style={styles.breakdownRow}>
                      <Condition label="Novo" value={item.quantity_new} />
                      <Condition label="Usado" value={item.quantity_used} />
                      <Condition label="Danificado" value={item.quantity_damaged} />
                    </View>
                  ) : (
                    <Body mute style={styles.breakdownNote}>
                      Sem separação por condição registrada.
                    </Body>
                  )}
                  <Body mute style={styles.breakdownNote}>
                    Unidade: {item.unit}
                  </Body>
                </View>
              ) : null}
            </Pressable>
          )
        }}
        ItemSeparatorComponent={() => <Divider />}
        ListEmptyComponent={
          <EmptyState
            title={
              search.trim().length > 0
                ? `Nenhum item encontrado para "${search.trim()}"`
                : 'Nenhum item neste filtro'
            }
            hint={filter !== 'all' ? 'Toque em Todos para ver o estoque inteiro.' : undefined}
          />
        }
        contentContainerStyle={styles.listContent}
      />
    </View>
  )
}

function Condition({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.condition}>
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
  search: {
    minHeight: TOUCH,
    backgroundColor: color.surface,
    borderWidth: HAIRLINE,
    borderColor: color.line,
    paddingHorizontal: space.md,
    fontFamily: font.text,
    fontSize: 15,
    color: color.ink,
  },
  filterRow: { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' },
  filterChip: {
    minHeight: TOUCH,
    justifyContent: 'center',
    paddingHorizontal: space.md,
    borderWidth: HAIRLINE,
    borderColor: color.line,
  },
  filterChipActive: { backgroundColor: color.blaze, borderColor: color.blaze },
  filterLabel: { fontSize: 13 },
  filterLabelActive: { color: color.blazeInk, fontFamily: font.textMedium },

  row: {
    borderLeftWidth: RULE,
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
    minHeight: TOUCH + space.md,
  },
  rowMain: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  rowText: { flex: 1, minWidth: 0, gap: 2 },
  itemName: { fontFamily: font.textMedium, fontSize: 15 },
  rowNumbers: { alignItems: 'flex-end', gap: 2 },

  breakdown: { paddingTop: space.md, gap: space.md },
  breakdownRow: { flexDirection: 'row', gap: space.xl, paddingTop: space.sm },
  condition: { gap: 2 },
  breakdownNote: { fontSize: 12 },

  pressed: { opacity: 0.6 },
})
