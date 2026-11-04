-- admin_account_overview quebrava para TODO mundo, inclusive o administrador:
--
--   ERROR 42702: column reference "created_at" is ambiguous
--   It could refer to either a PL/pgSQL variable or a table column.
--
-- A funcao declara created_at como coluna de saida no RETURNS TABLE, e isso
-- cria uma variavel PL/pgSQL com esse nome, visivel em todo o corpo. Dentro da
-- subconsulta de audit_logs, max(created_at) passava a ser ambiguo entre a
-- variavel e a coluna da tabela, e o Postgres recusa em vez de escolher.
--
-- A tela de contas mostrava "Ocorreu um erro inesperado" com todos os
-- contadores zerados, o que parecia falta de permissao e nao era.
--
-- Duas defesas, porque uma so volta a quebrar no proximo campo adicionado:
--   1. qualificar a coluna (al.created_at), que resolve este caso;
--   2. #variable_conflict use_column, que faz o Postgres preferir a coluna em
--      qualquer outra colisao futura desta funcao.

CREATE OR REPLACE FUNCTION public.admin_account_overview()
RETURNS TABLE(
  id uuid,
  full_name text,
  email text,
  employee_id text,
  role text,
  sector text,
  photo_url text,
  is_active boolean,
  created_at timestamp with time zone,
  last_sign_in_at timestamp with time zone,
  withdrawals_count bigint,
  returns_count bigint,
  audit_count bigint,
  last_action_at timestamp with time zone
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
#variable_conflict use_column
BEGIN
  IF NOT public.is_active_admin() THEN
    RAISE EXCEPTION 'Acesso negado: painel disponivel apenas para o administrador.';
  END IF;

  RETURN QUERY
  SELECT
    p.id, p.full_name, u.email::TEXT, p.employee_id, p.role::TEXT,
    p.sector, p.photo_url, p.is_active, p.created_at, u.last_sign_in_at,
    COALESCE(w.total, 0) AS withdrawals_count,
    COALESCE(r.total, 0) AS returns_count,
    COALESCE(a.total, 0) AS audit_count,
    a.last_at AS last_action_at
  FROM public.profiles p
  LEFT JOIN auth.users u ON u.id = p.id
  LEFT JOIN (
    SELECT wd.authorized_by, count(*) AS total
    FROM public.withdrawals wd
    WHERE wd.authorized_by IS NOT NULL
    GROUP BY wd.authorized_by
  ) w ON w.authorized_by = p.id
  LEFT JOIN (
    SELECT sr.created_by, count(*) AS total
    FROM public.stock_returns sr
    WHERE sr.created_by IS NOT NULL
    GROUP BY sr.created_by
  ) r ON r.created_by = p.id
  LEFT JOIN (
    SELECT al.user_id, count(*) AS total, max(al.created_at) AS last_at
    FROM public.audit_logs al
    WHERE al.user_id IS NOT NULL
    GROUP BY al.user_id
  ) a ON a.user_id = p.id
  ORDER BY (p.role = 'admin') DESC, p.is_active DESC, p.full_name;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_account_overview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_account_overview() TO authenticated;
