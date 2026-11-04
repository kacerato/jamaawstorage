import Svg, { Path, type PathProps } from 'react-native-svg'
import { StyleSheet, View } from 'react-native'
import { color, font, space } from '../theme/tokens'
import { Text } from 'react-native'

/**
 * Marca Jamaaw.
 *
 * O simbolo e reconstruido em SVG a partir de logojamaaw.png (2048x2048,
 * 1,3 MB). Vetor em vez do PNG por tres motivos:
 *
 * 1. Nitidez em qualquer densidade de tela, sem gerar @2x/@3x.
 * 2. Poucos KB no bundle, contra 1,3 MB do PNG.
 * 3. Cada onda e um elemento proprio, animavel em separado — e o que
 *    permite a animacao de entrada da splash. Com PNG ou GIF a marca
 *    seria uma imagem so, e a unica animacao possivel seria mover o
 *    retangulo inteiro.
 *
 * O desenho: sete ondas empilhadas, as tres de cima em laranja (da marca)
 * e as quatro de baixo em grafite. Cada onda sobe a esquerda e desce a
 * direita, com a crista deslocando conforme desce a pilha.
 */

/** Grafite do logo original. Nao e um token do sistema: pertence a marca. */
const SLATE = '#2B3440'

/**
 * As sete ondas, de cima para baixo.
 *
 * Cada entrada e o `d` de um traco em viewBox 100x72. O desenho e uma
 * curva em S: sobe da esquerda, cruza o meio e desce a direita, com o
 * deslocamento vertical crescendo conforme a onda desce a pilha.
 */
export const WAVES: { d: string; brand: boolean }[] = [
  // Tres laranja
  { d: 'M4 14 C 22 2, 38 2, 52 12 S 78 26, 96 20', brand: true },
  { d: 'M4 23 C 22 11, 38 11, 52 21 S 78 35, 96 29', brand: true },
  { d: 'M4 32 C 22 20, 38 20, 52 30 S 78 44, 96 38', brand: true },
  // Quatro grafite
  { d: 'M4 41 C 22 29, 38 29, 52 39 S 78 53, 96 47', brand: false },
  { d: 'M4 50 C 22 38, 38 38, 52 48 S 78 62, 96 56', brand: false },
  { d: 'M4 59 C 22 47, 38 47, 52 57 S 78 71, 96 65', brand: false },
  { d: 'M4 68 C 22 56, 38 56, 52 66 S 78 80, 96 74', brand: false },
]

export const WAVE_VIEWBOX = '0 0 100 80'

/** Cor de cada onda. Separado para a splash animar com as mesmas cores. */
export function waveColor(brand: boolean): string {
  return brand ? color.blaze : SLATE
}

/**
 * Apenas o simbolo das ondas, sem o nome.
 *
 * `PathComponent` permite trocar Path por um Path animado (Reanimated)
 * sem duplicar o desenho — e como a splash reutiliza esta geometria.
 */
export function BrandSymbol({
  size = 64,
  PathComponent = Path,
  pathProps,
}: {
  size?: number
  PathComponent?: React.ComponentType<PathProps & Record<string, unknown>>
  /** Props por onda, por indice. Usado pela splash para animar cada uma. */
  pathProps?: (index: number) => Record<string, unknown>
}) {
  // Proporcao do viewBox: 100 de largura por 80 de altura.
  const height = size * 0.8

  return (
    <Svg width={size} height={height} viewBox={WAVE_VIEWBOX} fill="none">
      {WAVES.map((wave, index) => (
        <PathComponent
          key={wave.d}
          d={wave.d}
          stroke={waveColor(wave.brand)}
          strokeWidth={5}
          strokeLinecap="round"
          fill="none"
          {...(pathProps?.(index) ?? {})}
        />
      ))}
    </Svg>
  )
}

/**
 * Marca completa: simbolo mais o nome.
 *
 * `stacked` empilha (splash e login); caso contrario fica lado a lado.
 */
export function BrandMark({
  size = 64,
  stacked = false,
  showTagline = false,
}: {
  size?: number
  stacked?: boolean
  showTagline?: boolean
}) {
  return (
    <View style={stacked ? styles.stacked : styles.inline}>
      <BrandSymbol size={size} />

      <View style={stacked ? styles.wordStacked : styles.word}>
        <Text style={[styles.name, { fontSize: size * 0.42 }]}>Jamaaw</Text>
        {showTagline ? <Text style={styles.tagline}>Almoxarifado</Text> : null}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  inline: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  stacked: { alignItems: 'center', gap: space.lg },
  word: { gap: 2 },
  wordStacked: { alignItems: 'center', gap: space.xs },
  name: {
    fontFamily: font.titleBold,
    color: color.blaze,
    letterSpacing: -0.5,
  },
  tagline: {
    fontFamily: font.mono,
    fontSize: 10,
    letterSpacing: 2.4,
    textTransform: 'uppercase',
    color: color.inkMute,
  },
})
