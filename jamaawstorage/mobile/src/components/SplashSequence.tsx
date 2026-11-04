import { useEffect, useRef } from 'react'
import { Animated, Easing, StyleSheet, Text, View } from 'react-native'
import Svg, { Path } from 'react-native-svg'
import { WAVES, WAVE_VIEWBOX, waveColor } from './BrandMark'
import { color, font, space } from '../theme/tokens'

const AnimatedPath = Animated.createAnimatedComponent(Path)

/**
 * Abertura animada: a marca se constroi onda por onda.
 *
 * O simbolo do Jamaaw e uma pilha de sete ondas. Em vez de um GIF — que
 * seria uma imagem so, pesada e borrada em tela de alta densidade — cada
 * onda e um Path do SVG, animado em separado:
 *
 *   - as sete entram em cascata de BAIXO para cima, com 55ms entre elas,
 *     cada uma subindo alguns pixels enquanto aparece;
 *   - as tres laranja fecham a sequencia, entao o olho termina no topo,
 *     na cor da marca;
 *   - o nome entra depois que a pilha esta completa.
 *
 * Usa a Animated API da React Native, nao Reanimated: sao sete valores
 * interpolados em paralelo, carga trivial, e evita a configuracao de
 * babel plugin que o Reanimated exige.
 *
 * Duracao total ~1,2s. Curta de proposito: splash e o que separa o
 * supervisor do dado que ele veio ver.
 */

const STAGGER_MS = 55
const WAVE_DURATION_MS = 420
const RISE_DISTANCE = 10

export function SplashSequence({
  symbolSize = 132,
  onFinished,
}: {
  symbolSize?: number
  /** Chamado quando a animacao termina. */
  onFinished?: () => void
}) {
  // Um valor 0..1 por onda; a ordem de disparo e invertida mais abaixo.
  const waveProgress = useRef(WAVES.map(() => new Animated.Value(0))).current
  const wordProgress = useRef(new Animated.Value(0)).current
  const finishedRef = useRef(false)

  useEffect(() => {
    // Cascata de baixo para cima: a ultima onda da pilha comeca primeiro.
    const waveAnimations = waveProgress
      .map((value, index) =>
        Animated.timing(value, {
          toValue: 1,
          duration: WAVE_DURATION_MS,
          delay: (WAVES.length - 1 - index) * STAGGER_MS,
          easing: Easing.out(Easing.cubic),
          // Opacity e transform do Path rodam no driver nativo.
          useNativeDriver: true,
        }),
      )
      .reverse()

    const sequence = Animated.parallel([
      ...waveAnimations,
      Animated.timing(wordProgress, {
        toValue: 1,
        duration: 380,
        delay: WAVES.length * STAGGER_MS + 120,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ])

    sequence.start(({ finished }) => {
      if (finished && !finishedRef.current) {
        finishedRef.current = true
        onFinished?.()
      }
    })

    return () => sequence.stop()
  }, [waveProgress, wordProgress, onFinished])

  const height = symbolSize * 0.8

  return (
    <View style={styles.container}>
      <View style={styles.mark}>
        <Svg width={symbolSize} height={height} viewBox={WAVE_VIEWBOX} fill="none">
          {WAVES.map((wave, index) => (
            <AnimatedPath
              key={wave.d}
              d={wave.d}
              stroke={waveColor(wave.brand)}
              strokeWidth={5}
              strokeLinecap="round"
              fill="none"
              opacity={waveProgress[index]}
              translateY={waveProgress[index].interpolate({
                inputRange: [0, 1],
                outputRange: [RISE_DISTANCE, 0],
              })}
            />
          ))}
        </Svg>

        <Animated.View
          style={[
            styles.word,
            {
              opacity: wordProgress,
              transform: [
                {
                  translateY: wordProgress.interpolate({
                    inputRange: [0, 1],
                    outputRange: [8, 0],
                  }),
                },
              ],
            },
          ]}
        >
          <Text style={styles.name}>Jamaaw</Text>
          <Text style={styles.tagline}>Almoxarifado</Text>
        </Animated.View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: color.void,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mark: { alignItems: 'center', gap: space.xl },
  word: { alignItems: 'center', gap: space.xs },
  name: {
    fontFamily: font.titleBold,
    fontSize: 34,
    color: color.blaze,
    letterSpacing: -0.5,
  },
  tagline: {
    fontFamily: font.mono,
    fontSize: 10,
    letterSpacing: 3,
    textTransform: 'uppercase',
    color: color.inkMute,
  },
})
