-- Tabela de tokens de push do app mobile.
--
-- NAO APLICADA. Fica aqui esperando a decisao de ligar o push remoto.
-- Antes de aplicar, confirme com a sessao de Hierarquia de supervisores:
-- ela esta mexendo nas politicas RLS e no enum app_role, e a politica
-- abaixo assume o modelo atual (um supervisor ve e escreve so o proprio
-- token).
--
-- Para aplicar:
--   npx supabase db push        (ou cole no SQL Editor do painel)
--
-- O numero 001 e local deste projeto mobile. As migrations do web estao
-- em app/supabase/migrations e hoje vao ate 060.

create table if not exists public.push_tokens (
  token text primary key,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  platform text not null check (platform in ('ios', 'android')),
  -- Data do ultimo envio, para a Edge Function nao reenviar o mesmo
  -- aviso varias vezes no mesmo dia.
  last_notified_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.push_tokens is
  'Tokens de push do app mobile, um por aparelho. Alimentada pelo app e lida pela Edge Function notify-maintenance.';

create index if not exists push_tokens_profile_id_idx
  on public.push_tokens (profile_id);

alter table public.push_tokens enable row level security;

-- Cada supervisor administra apenas o token do proprio aparelho.
-- A Edge Function le a tabela inteira com a service role key, que
-- ignora RLS por desenho.

create policy push_tokens_select_own
  on public.push_tokens
  for select
  using (profile_id = auth.uid());

create policy push_tokens_insert_own
  on public.push_tokens
  for insert
  with check (profile_id = auth.uid());

create policy push_tokens_update_own
  on public.push_tokens
  for update
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

create policy push_tokens_delete_own
  on public.push_tokens
  for delete
  using (profile_id = auth.uid());
