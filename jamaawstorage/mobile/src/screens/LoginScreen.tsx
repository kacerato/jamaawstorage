import { useRef, useState } from 'react'
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useAuth } from '../auth/AuthContext'
import { BrandMark } from '../components/BrandMark'
import { Label, Notice, PrimaryButton } from '../components/primitives'
import { HAIRLINE, TOUCH, color, font, space } from '../theme/tokens'

/**
 * Login.
 *
 * Estrutura em tres blocos com respiro entre eles: marca, formulario,
 * acao. Sem frase explicando o que a tela faz — o campo diz E-MAIL, o
 * botao diz Entrar, e isso basta.
 *
 * O campo tem 52px de altura, acima dos 44 minimos: digitar e-mail e
 * senha com uma mao, no patio, pede alvo maior que o minimo.
 */
export function LoginScreen() {
  const { signIn, signingIn, error } = useAuth()
  const insets = useSafeAreaInsets()
  // ComponentRef deriva o tipo do proprio TextInput: nesta versao da RN o
  // ref nao e mais a classe TextInput, e o nome interno nao e publico.
  const passwordRef = useRef<React.ComponentRef<typeof TextInput>>(null)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [focused, setFocused] = useState<'email' | 'password' | null>(null)

  const canSubmit = email.trim().length > 0 && password.length > 0 && !signingIn

  const submit = () => {
    if (!canSubmit) return
    void signIn(email, password)
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + space.xxl, paddingBottom: insets.bottom + space.xxl },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.brand}>
          <BrandMark size={96} stacked showTagline />
        </View>

        <View style={styles.form}>
          <View style={styles.field}>
            <Label>E-mail</Label>
            <TextInput
              value={email}
              onChangeText={setEmail}
              onFocus={() => setFocused('email')}
              onBlur={() => setFocused(null)}
              onSubmitEditing={() => passwordRef.current?.focus()}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              keyboardType="email-address"
              textContentType="emailAddress"
              returnKeyType="next"
              placeholderTextColor={color.inkMute}
              selectionColor={color.ink}
              style={[styles.input, focused === 'email' ? styles.inputFocused : null]}
              editable={!signingIn}
            />
          </View>

          <View style={styles.field}>
            <Label>Senha</Label>
            <TextInput
              ref={passwordRef}
              value={password}
              onChangeText={setPassword}
              onFocus={() => setFocused('password')}
              onBlur={() => setFocused(null)}
              onSubmitEditing={submit}
              secureTextEntry
              autoCapitalize="none"
              autoComplete="current-password"
              textContentType="password"
              returnKeyType="go"
              placeholderTextColor={color.inkMute}
              selectionColor={color.ink}
              style={[styles.input, focused === 'password' ? styles.inputFocused : null]}
              editable={!signingIn}
            />
          </View>

          {error ? <Notice severity="crit">{error}</Notice> : null}
        </View>

        <PrimaryButton label="Entrar" onPress={submit} loading={signingIn} disabled={!canSubmit} />
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: color.void },
  content: {
    flexGrow: 1,
    paddingHorizontal: space.xl,
    justifyContent: 'center',
    // Respiro entre marca, formulario e acao. xxl sozinho ja basta: o
    // gap soma ao espaco interno de cada bloco, e medido em 375px o
    // vao marca-formulario passava de 140px com xxl+md.
    gap: space.xxl,
  },
  brand: { alignItems: 'center' },
  form: { gap: space.xl },
  field: { gap: space.sm },
  input: {
    // 52px: acima do minimo de 44, porque digitar com uma mao pede folga.
    minHeight: 52,
    backgroundColor: color.surface,
    borderWidth: HAIRLINE,
    borderColor: color.line,
    paddingHorizontal: space.lg,
    fontFamily: font.text,
    fontSize: 16,
    color: color.ink,
  },
  // Foco marca com a linha clara, nunca com laranja (regra 3 dos tokens).
  inputFocused: { borderColor: color.inkMute },
})
