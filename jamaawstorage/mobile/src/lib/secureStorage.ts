import * as SecureStore from 'expo-secure-store'

/**
 * Adaptador de sessao para o Supabase.
 *
 * O web usa localStorage. Aqui a sessao vai para o keystore do aparelho
 * (Keychain no iOS, EncryptedSharedPreferences no Android).
 *
 * SecureStore tem limite pratico de ~2KB por chave e nao existe no web,
 * entao cada acesso e protegido: falhar em ler a sessao deve derrubar o
 * login, nao o app.
 */
export const secureStorage = {
  async getItem(key: string): Promise<string | null> {
    try {
      return await SecureStore.getItemAsync(key)
    } catch {
      return null
    }
  },

  async setItem(key: string, value: string): Promise<void> {
    try {
      await SecureStore.setItemAsync(key, value)
    } catch {
      // Sessao nao persistida: o usuario faz login de novo na proxima abertura.
    }
  },

  async removeItem(key: string): Promise<void> {
    try {
      await SecureStore.deleteItemAsync(key)
    } catch {
      // Nada a fazer: a chave ja nao esta acessivel.
    }
  },
}
