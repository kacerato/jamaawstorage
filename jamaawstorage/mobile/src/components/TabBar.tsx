import { Pressable, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { HAIRLINE, RULE, TOUCH, color, font, space } from '../theme/tokens'
import { Body } from './primitives'

/**
 * Tres abas. Limite do app, nao ponto de partida:
 * consumo, estoque e carros. Nenhuma quarta aba.
 *
 * A aba ativa e marcada por faixa superior laranja preenchida mais texto
 * em ink — nao por texto laranja, que a regra 3 dos tokens proibe.
 */

export type TabKey = 'consumption' | 'stock' | 'vehicles'

const TABS: { key: TabKey; label: string }[] = [
  { key: 'consumption', label: 'Consumo' },
  { key: 'stock', label: 'Estoque' },
  { key: 'vehicles', label: 'Carros' },
]

export function TabBar({
  active,
  onChange,
  badges,
}: {
  active: TabKey
  onChange: (key: TabKey) => void
  /** Contagem critica por aba. Mostra ponto, nao numero: e sinal, nao dado. */
  badges?: Partial<Record<TabKey, boolean>>
}) {
  const insets = useSafeAreaInsets()

  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, space.sm) }]}>
      {TABS.map((tab) => {
        const isActive = tab.key === active

        return (
          <Pressable
            key={tab.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
            onPress={() => onChange(tab.key)}
            style={({ pressed }) => [styles.tab, pressed ? styles.pressed : null]}
          >
            <View style={[styles.indicator, isActive ? styles.indicatorActive : null]} />

            <View style={styles.labelWrap}>
              <Body dim={!isActive} style={isActive ? styles.labelActive : styles.label}>
                {tab.label}
              </Body>
              {badges?.[tab.key] ? <View style={styles.badge} /> : null}
            </View>
          </Pressable>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: color.void,
    borderTopWidth: HAIRLINE,
    borderTopColor: color.line,
  },
  tab: {
    flex: 1,
    minHeight: TOUCH,
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  indicator: {
    height: RULE,
    width: '100%',
    backgroundColor: 'transparent',
  },
  indicatorActive: { backgroundColor: color.blaze },
  labelWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
    paddingVertical: space.md,
  },
  label: { fontSize: 13 },
  labelActive: { fontSize: 13, fontFamily: font.textMedium, color: color.ink },
  badge: {
    width: 6,
    height: 6,
    // Ponto de status: uma das duas excecoes de raio no sistema.
    borderRadius: 3,
    backgroundColor: color.crit,
  },
  pressed: { opacity: 0.6 },
})
