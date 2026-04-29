/**
 * Utilitários para autenticação
 * Todas as funções são puras e à prova de falhas
 */

/**
 * Mensagens de erro de autenticação em português
 */
export const AUTH_ERROR_MESSAGES = {
  TIMEOUT: 'A operação excedeu o tempo limite. Tente novamente.',
  SESSION_EXPIRED: 'Sessão expirada. Por favor, faça login novamente.',
  SESSION_INVALID: 'Sessão inválida. Por favor, faça login novamente.',
  INVALID_SESSION_DATA: 'Dados da sessão inválidos.',
  CACHE_CLEAR_ERROR: 'Erro ao limpar cache de autenticação.',
  JSON_PARSE_ERROR: 'Erro ao processar dados.',
  UNKNOWN_ERROR: 'Ocorreu um erro inesperado. Tente novamente.',
} as const;

export type AuthErrorMessageKey = keyof typeof AUTH_ERROR_MESSAGES;

/**
 * Wrapper que adiciona timeout em qualquer Promise
 * @param promise - Promise a ser executada
 * @param ms - Tempo limite em milissegundos
 * @param errorMsg - Mensagem de erro caso ocorra timeout
 * @returns Promise com timeout aplicado
 */
export function createAuthTimeout<T>(
  promise: Promise<T>,
  ms: number,
  errorMsg: string = AUTH_ERROR_MESSAGES.TIMEOUT
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(errorMsg));
    }, ms);

    promise
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

/**
 * Limpa cache de autenticação antigo do localStorage
 * Remove chaves relacionadas à autenticação que podem estar obsoletas
 */
export function clearStaleAuthCache(): void {
  try {
    const authKeysToRemove: string[] = [];

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (
        key.startsWith('sb-') || // Supabase auth keys
        key.includes('auth') ||
        key.includes('session') ||
        key.includes('token')
      )) {
        authKeysToRemove.push(key);
      }
    }

    authKeysToRemove.forEach((key) => {
      try {
        localStorage.removeItem(key);
      } catch {
        // Ignora erros de remoção individual
      }
    });
  } catch {
    // À prova de falhas: ignora erros do localStorage
  }
}

/**
 * Interface para sessão de autenticação
 */
export interface AuthSession {
  expires_at?: number;
  expires_in?: number;
  access_token?: string;
  refresh_token?: string;
  user?: unknown;
}

/**
 * Verifica se uma sessão é válida (não expirou)
 * @param session - Objeto da sessão a ser verificada
 * @returns boolean indicando se a sessão é válida
 */
export function isSessionValid(session: unknown): session is AuthSession {
  if (!session || typeof session !== 'object') {
    return false;
  }

  const s = session as AuthSession;

  // Verifica se possui tokens
  if (!s.access_token || typeof s.access_token !== 'string') {
    return false;
  }

  // Verifica expiração
  const now = Math.floor(Date.now() / 1000);

  if (s.expires_at && typeof s.expires_at === 'number') {
    return s.expires_at > now;
  }

  if (s.expires_in && typeof s.expires_in === 'number') {
    // Se expires_in é em segundos e maior que 0, consideramos válida
    return s.expires_in > 0;
  }

  // Se não tiver informação de expiração, considera válida se tiver access_token
  return true;
}

/**
 * Faz parsing seguro de JSON com fallback
 * @param str - String JSON a ser parseada
 * @param fallback - Valor de retorno caso o parsing falhe
 * @returns Objeto parseado ou valor de fallback
 */
export function safeJsonParse<T>(str: string | null | undefined, fallback: T): T {
  if (!str || typeof str !== 'string') {
    return fallback;
  }

  try {
    const parsed = JSON.parse(str);
    return parsed as T;
  } catch {
    return fallback;
  }
}

/**
 * Tenta fazer parsing de JSON de forma síncrona
 * Útil quando não se tem certeza se o valor já é um objeto
 * @param data - Valor que pode ser string JSON ou objeto
 * @returns Objeto parseado ou o próprio valor se já for objeto
 */
export function tryParseJson<T>(data: string | T): T {
  if (typeof data === 'string') {
    return safeJsonParse<T>(data, data as unknown as T);
  }
  return data;
}

/**
 * Verifica se o token está próximo de expirar (útil para refresh preemptivo)
 * @param session - Sessão a ser verificada
 * @param thresholdMinutes - Minutos antes da expiração para considerar como "próximo" (padrão: 5)
 * @returns boolean indicando se está próximo de expirar
 */
export function isTokenExpiringSoon(
  session: AuthSession | null,
  thresholdMinutes: number = 5
): boolean {
  if (!session || !isSessionValid(session)) {
    return true;
  }

  if (!session.expires_at || typeof session.expires_at !== 'number') {
    return false;
  }

  const now = Math.floor(Date.now() / 1000);
  const thresholdSeconds = thresholdMinutes * 60;

  return session.expires_at - now <= thresholdSeconds;
}

/**
 * Extrai o token de autorização de headers ou session
 * @param headers - Headers da requisição ou session
 * @returns Token de autorização ou null
 */
export function extractAuthToken(
  headers: Record<string, string> | AuthSession | null
): string | null {
  if (!headers) return null;

  if ('access_token' in headers && typeof headers.access_token === 'string') {
    return headers.access_token;
  }

  if ('Authorization' in headers) {
    const auth = headers.Authorization;
    if (auth.startsWith('Bearer ')) {
      return auth.slice(7);
    }
    return auth;
  }

  return null;
}
