/**
 * Credenciais vem de .env via EXPO_PUBLIC_*, que o Expo injeta no bundle
 * em tempo de build. A anon key e publica por desenho: o que protege os
 * dados e a RLS no banco, nao o segredo da chave.
 */
export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? ''
export const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? ''
export const hasSupabaseConfig = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY)
