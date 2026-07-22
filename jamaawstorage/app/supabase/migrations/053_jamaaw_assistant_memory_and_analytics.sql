BEGIN;

-- Memoria operacional curta e recuperavel por gatilhos. Conversas continuam
-- sendo o historico bruto; esta tabela guarda apenas conhecimento estavel.
CREATE TABLE IF NOT EXISTS public.ai_memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  memory_key TEXT NOT NULL,
  memory_type TEXT NOT NULL DEFAULT 'fact' CHECK (memory_type IN (
    'fact', 'preference', 'procedure', 'alias', 'rule'
  )),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  trigger_terms TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  tags TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  importance SMALLINT NOT NULL DEFAULT 3 CHECK (importance BETWEEN 1 AND 5),
  is_pinned BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  source_conversation_id UUID NULL REFERENCES public.ai_conversations(id) ON DELETE SET NULL,
  last_accessed_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, memory_key)
);

CREATE INDEX IF NOT EXISTS idx_ai_memories_user_priority
  ON public.ai_memories(user_id, is_active, is_pinned DESC, importance DESC, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_memories_triggers
  ON public.ai_memories USING GIN(trigger_terms);
CREATE INDEX IF NOT EXISTS idx_ai_memories_tags
  ON public.ai_memories USING GIN(tags);

ALTER TABLE public.ai_memories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ai_memories_own_select" ON public.ai_memories;
CREATE POLICY "ai_memories_own_select" ON public.ai_memories
FOR SELECT
USING (user_id = auth.uid() AND (SELECT public.is_active_supervisor()));

REVOKE INSERT, UPDATE, DELETE ON public.ai_memories FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.ai_memories TO authenticated;
GRANT ALL ON public.ai_memories TO service_role;

DROP TRIGGER IF EXISTS trg_ai_memories_updated_at ON public.ai_memories;
CREATE TRIGGER trg_ai_memories_updated_at
  BEFORE UPDATE ON public.ai_memories
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Agrega no banco o periodo inteiro. O assistente nunca deve inferir totais a
-- partir de uma pagina limitada de retiradas.
CREATE OR REPLACE FUNCTION public.assistant_withdrawal_item_totals(
  p_query TEXT DEFAULT NULL,
  p_stock_item_id UUID DEFAULT NULL,
  p_start_at TIMESTAMPTZ DEFAULT NULL,
  p_end_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (
  stock_item_id UUID,
  code TEXT,
  name TEXT,
  unit TEXT,
  total_quantity BIGINT,
  withdrawal_count BIGINT,
  first_withdrawal_at TIMESTAMPTZ,
  last_withdrawal_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_active_supervisor() THEN
    RAISE EXCEPTION 'Acesso negado: somente supervisores ativos podem consultar os totais.';
  END IF;

  RETURN QUERY
  SELECT
    item.id,
    item.code,
    item.name,
    item.unit,
    SUM(withdrawal_item.quantity)::BIGINT,
    COUNT(DISTINCT withdrawal.id)::BIGINT,
    MIN(COALESCE(withdrawal.withdrawn_at, withdrawal.created_at)),
    MAX(COALESCE(withdrawal.withdrawn_at, withdrawal.created_at))
  FROM public.withdrawal_items withdrawal_item
  JOIN public.withdrawals withdrawal ON withdrawal.id = withdrawal_item.withdrawal_id
  JOIN public.stock_items item ON item.id = withdrawal_item.stock_item_id
  WHERE withdrawal.status::TEXT IN ('approved', 'completed')
    AND (p_stock_item_id IS NULL OR item.id = p_stock_item_id)
    AND (
      NULLIF(btrim(COALESCE(p_query, '')), '') IS NULL
      OR item.name ILIKE '%' || btrim(p_query) || '%'
      OR item.code ILIKE '%' || btrim(p_query) || '%'
      OR item.category ILIKE '%' || btrim(p_query) || '%'
    )
    AND (p_start_at IS NULL OR COALESCE(withdrawal.withdrawn_at, withdrawal.created_at) >= p_start_at)
    AND (p_end_at IS NULL OR COALESCE(withdrawal.withdrawn_at, withdrawal.created_at) < p_end_at)
  GROUP BY item.id, item.code, item.name, item.unit
  ORDER BY SUM(withdrawal_item.quantity) DESC, item.name ASC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.assistant_withdrawal_item_totals(TEXT, UUID, TIMESTAMPTZ, TIMESTAMPTZ)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assistant_withdrawal_item_totals(TEXT, UUID, TIMESTAMPTZ, TIMESTAMPTZ)
  TO authenticated, service_role;

COMMIT;
