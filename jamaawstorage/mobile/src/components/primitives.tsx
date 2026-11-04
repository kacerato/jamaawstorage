import type { ReactNode } from 'react'
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native'
import { HAIRLINE, RULE, TOUCH, color, font, space, tint, type Severity } from '../theme/tokens'

/**
 * Primitivas do sistema visual.
 *
 * As regras de app/src/components/ui/TOKENS.md valem aqui:
 * canto vivo (nenhum borderRadius), uma superficie so (Surface nunca dentro
 * de Surface — separar com Divider), laranja so preenchido em acao primaria,
 * severidade por faixa lateral de 2px, 44px de alvo de toque.
 */

// ---------------------------------------------------------------- tipografia

export function Title({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[styles.title, style]}>{children}</Text>
}

export function Heading({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[styles.heading, style]}>{children}</Text>
}

export function Body({
  children,
  dim,
  mute,
  style,
  ...textProps
}: TextProps & {
  children: ReactNode
  dim?: boolean
  mute?: boolean
}) {
  return (
    <Text
      {...textProps}
      style={[styles.body, dim && styles.bodyDim, mute && styles.bodyMute, style]}
    >
      {children}
    </Text>
  )
}

/** Rotulo em mono caixa alta, como o `label-mono` do web. */
export function Label({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[styles.label, style]}>{children}</Text>
}

/**
 * Numero de destaque em mono tabular.
 * Estado tinge o numero, nao a caixa (regra 6 do TOKENS.md).
 */
export function Num({
  children,
  severity,
  size = 28,
  style,
}: {
  children: ReactNode
  severity?: Severity
  size?: number
  style?: StyleProp<TextStyle>
}) {
  return (
    <Text
      style={[
        styles.num,
        { fontSize: size, lineHeight: size * 1.1 },
        severity ? { color: color[severity] } : null,
        style,
      ]}
    >
      {children}
    </Text>
  )
}

// ------------------------------------------------------------------ estrutura

/** A unica superficie elevada. Nunca aninhar uma dentro de outra. */
export function Surface({
  children,
  style,
}: {
  children: ReactNode
  style?: StyleProp<ViewStyle>
}) {
  return <View style={[styles.surface, style]}>{children}</View>
}

/** Divisao interna de um bloco. Substitui o segundo fundo. */
export function Divider({ style }: { style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.divider, style]} />
}

/**
 * Faixa de severidade a esquerda, 2px, sobre o fundo void.
 * Alerta e linha de alerta usam isto, nao fundo tingido.
 */
export function SeverityRow({
  severity,
  children,
  onPress,
  style,
}: {
  severity: Severity
  children: ReactNode
  onPress?: () => void
  style?: StyleProp<ViewStyle>
}) {
  const content = (
    <View style={[styles.severityRow, { borderLeftColor: color[severity] }, style]}>
      {children}
    </View>
  )

  if (!onPress) return content

  return (
    <Pressable onPress={onPress} style={({ pressed }) => (pressed ? styles.pressed : null)}>
      {content}
    </Pressable>
  )
}

/** Pastilha de estado. Fundo tingido com alfa + texto do token cheio. */
export function Pill({ severity, children }: { severity: Severity; children: ReactNode }) {
  return (
    <View style={[styles.pill, { backgroundColor: tint[severity] }]}>
      <Text style={[styles.pillText, { color: color[severity] }]}>{children}</Text>
    </View>
  )
}

/** Acao primaria: laranja preenchido, texto no blazeInk. */
export function PrimaryButton({
  label,
  onPress,
  loading,
  disabled,
}: {
  label: string
  onPress: () => void
  loading?: boolean
  disabled?: boolean
}) {
  const inert = disabled || loading

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={inert}
      style={({ pressed }) => [
        styles.primaryButton,
        pressed && !inert ? styles.pressed : null,
        inert ? styles.primaryButtonDisabled : null,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={color.blazeInk} size="small" />
      ) : (
        <Text style={styles.primaryButtonText}>{label}</Text>
      )}
    </Pressable>
  )
}

/** Acao secundaria: contorno, sem laranja. */
export function GhostButton({
  label,
  onPress,
  disabled,
}: {
  label: string
  onPress: () => void
  disabled?: boolean
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.ghostButton,
        pressed && !disabled ? styles.pressed : null,
        disabled ? styles.ghostButtonDisabled : null,
      ]}
    >
      <Text style={styles.ghostButtonText}>{label}</Text>
    </Pressable>
  )
}

/** Barra de progresso. Token cheio, sem alfa, como no web. */
export function Meter({ ratio, severity }: { ratio: number; severity: Severity }) {
  const clamped = Math.max(0, Math.min(1, ratio))

  return (
    <View style={styles.meterTrack}>
      <View
        style={[styles.meterFill, { width: `${clamped * 100}%`, backgroundColor: color[severity] }]}
      />
    </View>
  )
}

/**
 * Estado vazio desenhado, nao um spinner no meio do nada.
 * `hint` diz o que fazer, nao so que esta vazio.
 */
export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <View style={styles.emptyState}>
      <Body dim style={styles.emptyTitle}>
        {title}
      </Body>
      {hint ? (
        <Body mute style={styles.emptyHint}>
          {hint}
        </Body>
      ) : null}
    </View>
  )
}

/** Carregamento com contexto: diz o que esta buscando. */
export function LoadingState({ what }: { what: string }) {
  return (
    <View style={styles.emptyState}>
      <ActivityIndicator color={color.inkMute} />
      <Body mute style={styles.emptyHint}>
        {what}
      </Body>
    </View>
  )
}

/** Aviso de dados defasados ou de erro, com faixa de severidade. */
export function Notice({
  severity,
  children,
}: {
  severity: Severity
  children: ReactNode
}) {
  return (
    <View style={[styles.notice, { borderLeftColor: color[severity] }]}>
      <Text style={[styles.noticeText, { color: color[severity] }]}>{children}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  title: {
    fontFamily: font.titleBold,
    fontSize: 26,
    lineHeight: 32,
    color: color.ink,
    letterSpacing: -0.5,
  },
  heading: {
    fontFamily: font.title,
    fontSize: 16,
    lineHeight: 22,
    color: color.ink,
  },
  body: {
    fontFamily: font.text,
    fontSize: 14,
    lineHeight: 20,
    color: color.ink,
  },
  bodyDim: { color: color.inkDim },
  bodyMute: { color: color.inkMute },
  label: {
    fontFamily: font.mono,
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: color.inkMute,
  },
  num: {
    fontFamily: font.monoBold,
    color: color.ink,
    fontVariant: ['tabular-nums'],
  },

  surface: {
    backgroundColor: color.surface,
    borderWidth: HAIRLINE,
    borderColor: color.line,
  },
  divider: {
    height: HAIRLINE,
    backgroundColor: color.line,
  },

  severityRow: {
    backgroundColor: color.void,
    borderLeftWidth: RULE,
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
    minHeight: TOUCH,
    justifyContent: 'center',
  },

  pill: {
    paddingHorizontal: space.sm,
    paddingVertical: 3,
    alignSelf: 'flex-start',
  },
  pillText: {
    fontFamily: font.mono,
    fontSize: 10,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },

  primaryButton: {
    backgroundColor: color.blaze,
    minHeight: TOUCH,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xl,
  },
  primaryButtonDisabled: { opacity: 0.45 },
  primaryButtonText: {
    fontFamily: font.textMedium,
    fontSize: 15,
    color: color.blazeInk,
    letterSpacing: 0.2,
  },

  ghostButton: {
    minHeight: TOUCH,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xl,
    borderWidth: HAIRLINE,
    borderColor: color.line,
  },
  ghostButtonDisabled: { opacity: 0.45 },
  ghostButtonText: {
    fontFamily: font.textMedium,
    fontSize: 14,
    color: color.inkDim,
  },

  meterTrack: {
    height: 4,
    backgroundColor: color.line,
    overflow: 'hidden',
  },
  meterFill: { height: '100%' },

  emptyState: {
    paddingVertical: space.xxl,
    paddingHorizontal: space.xl,
    alignItems: 'center',
    gap: space.sm,
  },
  emptyTitle: { textAlign: 'center' },
  emptyHint: { textAlign: 'center', fontSize: 13 },

  notice: {
    backgroundColor: color.void,
    borderLeftWidth: RULE,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
  },
  noticeText: {
    fontFamily: font.text,
    fontSize: 12,
    lineHeight: 17,
  },

  pressed: { opacity: 0.6 },
})
