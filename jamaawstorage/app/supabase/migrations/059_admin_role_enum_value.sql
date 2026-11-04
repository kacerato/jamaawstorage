-- Adiciona o papel 'admin' ao enum app_role.
--
-- ADD VALUE nao pode ser usado na mesma transacao que o cria, por isso esta
-- migracao fica isolada: a 060 constroi a hierarquia em cima deste valor.
--
-- 'admin' existe apenas para contas de login (public.profiles). A tabela
-- public.people continua usando supervisor/leader/collaborator como antes,
-- e nenhuma consulta de colaboradores muda de resultado.

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'admin';
