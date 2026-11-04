/**
 * Tokens portados de app/src/index.css (bloco @theme).
 * Regras em app/src/components/ui/TOKENS.md valem aqui:
 * canto vivo, uma superficie so, laranja so preenchido,
 * severidade por faixa lateral, alvo de toque de 44.
 */

export const color = {
  void: '#0D0101',
  surface: '#151515',
  line: '#262422',
  ink: '#FFFAFA',
  inkDim: '#A09B98',
  inkMute: '#6B6663',
  blaze: '#FF5D00',
  blazeInk: '#0D0101',
  ok: '#4ADE80',
  warn: '#FBBF24',
  crit: '#F87171',
} as const

/** Fundo tingido precisa de alfa: bg cheio + texto do mesmo token e invisivel. */
export const tint = {
  ok: 'rgba(74, 222, 128, 0.15)',
  warn: 'rgba(251, 191, 36, 0.15)',
  crit: 'rgba(248, 113, 113, 0.15)',
} as const

export type Severity = 'ok' | 'warn' | 'crit'

export const font = {
  title: 'Archivo_600SemiBold',
  titleBold: 'Archivo_700Bold',
  text: 'Inter_400Regular',
  textMedium: 'Inter_500Medium',
  mono: 'JetBrainsMono_500Medium',
  monoBold: 'JetBrainsMono_700Bold',
} as const

/** Escala de espaco em multiplos de 4. */
export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const

/** Alvo minimo de toque. Nao reduzir. */
export const TOUCH = 44

/** Faixa de severidade: 2px, igual ao web. */
export const RULE = 2

/** Largura da linha divisoria. Hairline no device, 1 no fallback. */
export const HAIRLINE = 1
