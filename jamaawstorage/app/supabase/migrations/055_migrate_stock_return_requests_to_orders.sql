BEGIN;

-- ---------------------------------------------------------------------------
-- Traz o historico de stock_return_requests para o modelo com cabecalho.
--
-- Agrupamento: devolucoes registradas na mesma "leva" viraram varias linhas
-- soltas. Como a tela antiga inseria todas de uma vez com o mesmo created_by e
-- a mesma origem, o agrupamento por (origem, autor, created_at truncado ao
-- minuto) reconstroi a leva original com boa fidelidade. Devolucoes isoladas
-- viram cabecalhos de um item so, que e o resultado correto de qualquer forma.
--
-- Estado: quantidade ja aprovada e fato consumado no estoque, entao o cabecalho
-- nasce 'completed'. Quantidade ainda pendente ou em triagem representa material
-- que ja saiu do inventario do colaborador mas nao entrou no estoque; ela vira
-- 'awaiting_triage', que e exatamente o significado desse limbo no modelo novo.
-- ---------------------------------------------------------------------------

CREATE TEMP TABLE migration_return_groups ON COMMIT DROP AS
SELECT
  gen_random_uuid() AS new_return_id,
  request.source_type,
  request.source_person_id,
  request.source_work_site_id,
  request.created_by,
  date_trunc('minute', request.created_at) AS grouped_at,
  min(request.created_at) AS created_at,
  max(request.approved_at) AS approved_at,
  -- UUID nao e ordenavel por max(); o supervisor relevante e o da aprovacao
  -- mais recente da leva, entao a escolha vem de um ORDER BY explicito.
  (array_agg(request.approved_by ORDER BY request.approved_at DESC NULLS LAST)
    FILTER (WHERE request.approved_by IS NOT NULL))[1] AS approved_by,
  -- Se todo o conjunto ja foi resolvido, a devolucao esta encerrada.
  bool_and(request.status IN ('approved', 'cancelled')) AS fully_resolved,
  bool_or(request.status = 'cancelled') AS has_cancelled,
  bool_and(request.status = 'cancelled') AS all_cancelled,
  string_agg(DISTINCT nullif(trim(request.notes), ''), ' | ') AS notes,
  string_agg(DISTINCT nullif(trim(request.triage_notes), ''), ' | ') AS triage_notes
FROM public.stock_return_requests request
GROUP BY
  request.source_type,
  request.source_person_id,
  request.source_work_site_id,
  request.created_by,
  date_trunc('minute', request.created_at);

INSERT INTO public.stock_returns (
  id, code, source_type, source_person_id, source_work_site_id,
  status, reason, notes, triage_notes, source_label_snapshot,
  created_by, received_by, received_at,
  triaged_by, triaged_at, completed_by, completed_at,
  cancelled_by, cancelled_at, cancellation_reason,
  created_at, updated_at
)
SELECT
  grp.new_return_id,
  'DEV-' || to_char(grp.created_at, 'YYYYMMDD') || '-M' || lpad(
    (row_number() OVER (ORDER BY grp.created_at, grp.new_return_id))::TEXT, 5, '0'
  ),
  grp.source_type,
  grp.source_person_id,
  grp.source_work_site_id,
  CASE
    WHEN grp.all_cancelled THEN 'cancelled'
    WHEN grp.fully_resolved THEN 'completed'
    ELSE 'awaiting_triage'
  END,
  'general',
  grp.notes,
  grp.triage_notes,
  COALESCE(person.full_name, site.name),
  grp.created_by,
  grp.approved_by,
  COALESCE(grp.approved_at, grp.created_at),
  CASE WHEN grp.fully_resolved THEN grp.approved_by END,
  CASE WHEN grp.fully_resolved THEN COALESCE(grp.approved_at, grp.created_at) END,
  CASE WHEN grp.fully_resolved AND NOT grp.all_cancelled THEN grp.approved_by END,
  CASE WHEN grp.fully_resolved AND NOT grp.all_cancelled THEN COALESCE(grp.approved_at, grp.created_at) END,
  CASE WHEN grp.all_cancelled THEN grp.approved_by END,
  CASE WHEN grp.all_cancelled THEN COALESCE(grp.approved_at, grp.created_at) END,
  CASE WHEN grp.all_cancelled THEN 'Cancelada no modelo anterior.' END,
  grp.created_at,
  now()
FROM migration_return_groups grp
LEFT JOIN public.people person ON person.id = grp.source_person_id
LEFT JOIN public.work_sites site ON site.id = grp.source_work_site_id;

-- Itens. A unicidade (stock_return_id, stock_item_id) do modelo novo exige
-- consolidar linhas repetidas do mesmo item dentro de uma mesma leva.
INSERT INTO public.stock_return_items (
  id, stock_return_id, stock_item_id, quantity,
  reported_condition, origin_withdrawal_item_id,
  item_photo_url, notes, created_at, updated_at
)
SELECT
  gen_random_uuid(),
  grp.new_return_id,
  request.stock_item_id,
  sum(request.quantity)::INTEGER,
  -- Chegada mista dentro da mesma leva: 'used' e o meio-termo seguro, e o
  -- resultado real da triagem esta preservado em stock_return_item_conditions.
  CASE
    WHEN count(DISTINCT request.item_condition) > 1 THEN 'used'
    ELSE min(request.item_condition)
  END,
  -- Mesma restricao de UUID: pega a primeira retirada de origem informada.
  (array_agg(request.origin_withdrawal_item_id ORDER BY request.created_at)
    FILTER (WHERE request.origin_withdrawal_item_id IS NOT NULL))[1],
  min(request.item_photo_url),
  string_agg(DISTINCT nullif(trim(request.notes), ''), ' | '),
  min(request.created_at),
  now()
FROM public.stock_return_requests request
JOIN migration_return_groups grp
  ON grp.source_type = request.source_type
 AND grp.source_person_id IS NOT DISTINCT FROM request.source_person_id
 AND grp.source_work_site_id IS NOT DISTINCT FROM request.source_work_site_id
 AND grp.created_by IS NOT DISTINCT FROM request.created_by
 AND grp.grouped_at = date_trunc('minute', request.created_at)
GROUP BY grp.new_return_id, request.stock_item_id;

-- Distribuicao de condicoes: reflete o que efetivamente voltou ao estoque.
-- approved_quantity ja creditou stock_items no modelo antigo, entao ela e o
-- unico numero que pode ser afirmado como resultado de triagem.
INSERT INTO public.stock_return_item_conditions (
  stock_return_item_id, condition, quantity, created_at
)
SELECT
  new_item.id,
  COALESCE(aggregated.approved_condition, 'used'),
  aggregated.approved_quantity,
  now()
FROM (
  SELECT
    grp.new_return_id,
    request.stock_item_id,
    COALESCE(request.approved_condition, 'used') AS approved_condition,
    sum(request.approved_quantity)::INTEGER AS approved_quantity
  FROM public.stock_return_requests request
  JOIN migration_return_groups grp
    ON grp.source_type = request.source_type
   AND grp.source_person_id IS NOT DISTINCT FROM request.source_person_id
   AND grp.source_work_site_id IS NOT DISTINCT FROM request.source_work_site_id
   AND grp.created_by IS NOT DISTINCT FROM request.created_by
   AND grp.grouped_at = date_trunc('minute', request.created_at)
  WHERE request.approved_quantity > 0
  GROUP BY grp.new_return_id, request.stock_item_id, COALESCE(request.approved_condition, 'used')
) AS aggregated
JOIN public.stock_return_items new_item
  ON new_item.stock_return_id = aggregated.new_return_id
 AND new_item.stock_item_id = aggregated.stock_item_id
WHERE aggregated.approved_quantity > 0;

-- A tabela antiga sai de circulacao mas nao e destruida: ela e a unica prova de
-- como o historico foi convertido, caso a migracao precise ser auditada.
ALTER TABLE public.stock_return_requests
  RENAME TO stock_return_requests_legacy;

COMMENT ON TABLE public.stock_return_requests_legacy IS
  'Modelo anterior de devolucao, substituido pelo par stock_returns/stock_return_items na migration 055. Somente leitura, mantido para auditoria da conversao.';

COMMIT;
