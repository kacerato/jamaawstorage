import { useState } from 'react'
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
import { Body, Label, Notice, PrimaryButton, Title } from '../components/primitives'
import { HAIRLINE, TOUCH, color, font, space } from '../theme/tokens'

export function LoginScreen() {
  const { signIn, signingIn, error } = useAuth()
  const insets = useSafeAreaInsets()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

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
          { paddingTop: insets.top + space.xxl, paddingBottom: insets.bottom + space.xl },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.brand}>
          <Title>Jamaaw</Title>
          <Label>Almoxarifado</Label>
        </View>

        <View style={styles.form}>
          <View style={styles.field}>
            <Label>E-mail</Label>
            <TextInput
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              textContentType="emailAddress"
              returnKeyType="next"
              placeholder="supervisor@empresa.com"
              placeholderTextColor={color.inkMute}
              style={styles.input}
              editable={!signingIn}
            />
          </View>

          <View style={styles.field}>
            <Label>Senha</Label>
            <TextInput
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete="current-password"
              textContentType="password"
              returnKeyType="go"
              onSubmitEditing={submit}
              placeholder="••••••••"
              placeholderTextColor={color.inkMute}
              style={styles.input}
              editable={!signingIn}
            />
          </View>

          {error ? <Notice severity="crit">{error}</Notice> : null}

          <PrimaryButton label="Entrar" onPress={submit} loading={signingIn} disabled={!canSubmit} />
        </View>

        <Body mute style={styles.footnote}>
          Acesso restrito a supervisores. A sessão fica guardada no aparelho.
        </Body>
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
    gap: space.xxl,
  },
  brand: { gap: space.xs },
  form: { gap: space.lg },
  field: { gap: space.sm },
  input: {
    minHeight: TOUCH,
    backgroundColor: color.surface,
    borderWidth: HAIRLINE,
    borderColor: color.line,
    paddingHorizontal: space.md,
    fontFamily: font.text,
    fontSize: 15,
    color: color.ink,
  },
  footnote: { fontSize: 12, textAlign: 'center' },
})
