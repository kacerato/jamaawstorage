# PLAN: Recriar Autenticação - JamaaW Storage

## Projeto: WEB (React + Supabase)

## Diagnóstico

### Problemas Identificados

1. **5 migrações SQL conflitantes** (001-005) com políticas RLS que se sobrepõem, DROP/CREATE de policies com nomes diferentes em cada migration — banco está em estado imprevisível
2. **create_supervisor_account() na migration 004** usa colunas `instance_id`, `confirmation_token`, `confirmed_at`, `last_sign_in_at`, `auth_token` na tabela `auth.users` — essas colunas podem não existir em versões mais recentes do Supabase Auth schema, causando erro de INSERT
3. **create_supervisor_account() na migration 005** usa schema simplificado mas também insere em `auth.users` diretamente — risco de incompatibilidade com versão do Supabase
4. **RLS circular na migration 004**: `profiles_select_own_or_supervisor` usa `is_active_supervisor()` que faz SELECT em profiles — mas o SELECT em profiles requer que a policy já permita, criando dependência circular
5. **AuthContext.tsx**: estado complexo com múltiplos refs, timeout manual, race condition entre `initializeAuth` e `onAuthStateChange`
6. **authService.ts**: cache de sessão em localStorage que pode ficar stale; signUp cria user via Supabase Auth API mas não cria profile (ponta solta)
7. **Primeiro supervisor**: migration 004 tem seed comentado, mas se o banco está vazio, ninguém consegue criar o primeiro supervisor

### Solução: Migration Única de Limpeza + Código Simplificado

## Tarefas

### 1. Criar migration `006_auth_rebuild.sql`
- Script idempotente que LIMPA todas as policies conflitantes
- Recria RLS policies de forma simples e consistente
- Recria `is_active_supervisor()` e `create_supervisor_account()` compatíveis
- Inclui seed para primeiro supervisor (descomentado, pronto para usar)
- Profile auto-creation via trigger (elimina ponta solta do signUp)

### 2. Reescrever `authService.ts`
- Sem cache localStorage (Supabase já gerencia sessão)
- signUp com criação automática de profile via trigger
- Funções simples: signIn, signOut, getSession, createSupervisor
- Tratamento de erro limpo

### 3. Reescrever `AuthContext.tsx`
- Estado mínimo: user, profile, loading, error
- Sem refs complexas, sem timeout manual
- onAuthStateChange como única fonte de verdade
- Inicialização simples

### 4. Atualizar `database.ts`
- Adicionar `withdrawn_at` nos tipos de withdrawals
- Garantir consistência com schema real

### 5. Validar build
- `npm run build` sem erros

## Agentes Envolvidos
- `database-architect`: migration SQL
- `backend-specialist`: authService.ts
- `frontend-specialist`: AuthContext.tsx, ProtectedRoute
- `security-auditor`: revisão final
