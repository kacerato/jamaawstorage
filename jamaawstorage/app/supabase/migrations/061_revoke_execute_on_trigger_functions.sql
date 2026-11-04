-- Funcoes de trigger nao devem ser chamaveis como RPC.
--
-- O Postgres concede EXECUTE a PUBLIC por padrao, entao as duas funcoes de
-- trigger da migracao 060 ficaram expostas em /rest/v1/rpc/. Chamadas
-- diretas falhariam (nao ha TG_OP fora de um trigger), mas uma funcao de
-- trigger SECURITY DEFINER na API publica nao tem motivo para existir.
--
-- Revogar EXECUTE nao afeta os triggers: eles sao disparados pelo Postgres
-- como dono da tabela, nao pelo papel que faz o UPDATE.
REVOKE ALL ON FUNCTION public.freeze_profile_privilege_columns() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_last_admin() FROM PUBLIC, anon, authenticated;
