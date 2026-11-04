import { StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { HAIRLINE, color, font, space } from '../theme/tokens'
import { Body, Title } from './primitives'

/**
 * Cabecalho de tela.
 *
 * `summary` traz numero, nunca parafrase do titulo — o usuario pediu que
 * subtitulo que so repete o titulo fosse removido, e a regra vale aqui.
 *
 * `age` e `stale` dizem de quando sao os dados na tela. Num app usado com
 * sinal ruim isso e informacao, nao enfeite: o supervisor precisa saber se
 * esta olhando o estoque de agora ou o de ontem.
 */
export function ScreenHeader({
  title,
  summary,
  age,
  stale,
}: {
  title: string
  summary?: string
  age?: string | null
  stale?: boolean
}) {
  const insets = useSafeAreaInsets()

  return (
    <View style={[styles.header, { paddingTop: insets.top + space.md }]}>
      <Title>{title}</Title>

      {summary || age ? (
        <View style={styles.meta}>
          {summary ? (
            <Body dim style={styles.summary}>
              {summary}
            </Body>
          ) : null}
          {age ? (
            <Body mute style={[styles.age, stale ? styles.ageStale : null]}>
              {stale ? `salvo ${age}` : `atualizado ${age}`}
            </Body>
          ) : null}
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: space.lg,
    // Respiro generoso abaixo do titulo: ritmo mobile, hierarquia por
    // tamanho e espaco em vez de linha e caixa.
    paddingBottom: space.lg,
    borderBottomWidth: HAIRLINE,
    borderBottomColor: color.line,
    gap: space.xs,
  },
  meta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    gap: space.sm,
  },
  summary: { fontSize: 13, flex: 1, minWidth: 0 },
  age: { fontFamily: font.mono, fontSize: 10 },
  ageStale: { color: color.warn },
})
