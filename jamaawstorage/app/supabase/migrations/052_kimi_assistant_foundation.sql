BEGIN;

CREATE TABLE IF NOT EXISTS public.ai_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'Nova conversa',
  is_archived BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ai_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.ai_conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ai_action_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.ai_conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  tool_name TEXT NOT NULL,
  arguments JSONB NOT NULL,
  summary TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'confirmed', 'executing', 'succeeded', 'failed', 'cancelled', 'expired'
  )),
  provider_message JSONB NULL,
  result JSONB NULL,
  error TEXT NULL,
  confirmed_at TIMESTAMPTZ NULL,
  executed_at TIMESTAMPTZ NULL,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '30 minutes'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_conversations_user_updated
  ON public.ai_conversations(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_messages_conversation_created
  ON public.ai_messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_action_requests_pending
  ON public.ai_action_requests(user_id, status, created_at DESC);

ALTER TABLE public.ai_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_action_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ai_conversations_own" ON public.ai_conversations;
CREATE POLICY "ai_conversations_own" ON public.ai_conversations
FOR SELECT
USING (user_id = auth.uid() AND (SELECT public.is_active_supervisor()));

DROP POLICY IF EXISTS "ai_messages_own" ON public.ai_messages;
CREATE POLICY "ai_messages_own" ON public.ai_messages
FOR SELECT
USING (user_id = auth.uid() AND (SELECT public.is_active_supervisor()));

DROP POLICY IF EXISTS "ai_action_requests_own" ON public.ai_action_requests;
CREATE POLICY "ai_action_requests_own" ON public.ai_action_requests
FOR SELECT
USING (user_id = auth.uid() AND (SELECT public.is_active_supervisor()));

DROP TRIGGER IF EXISTS trg_ai_conversations_updated_at ON public.ai_conversations;
CREATE TRIGGER trg_ai_conversations_updated_at
  BEFORE UPDATE ON public.ai_conversations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_ai_action_requests_updated_at ON public.ai_action_requests;
CREATE TRIGGER trg_ai_action_requests_updated_at
  BEFORE UPDATE ON public.ai_action_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.assistant_adjust_stock_item(
  p_stock_item_id UUID,
  p_quantity_new_delta INTEGER,
  p_quantity_used_delta INTEGER,
  p_quantity_damaged_delta INTEGER,
  p_reason TEXT,
  p_action_id UUID
)
RETURNS public.stock_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_item public.stock_items%ROWTYPE;
  result_item public.stock_items%ROWTYPE;
  total_delta INTEGER;
BEGIN
  IF NOT public.is_active_supervisor() THEN
    RAISE EXCEPTION 'Acesso negado: somente supervisores ativos podem ajustar estoque.';
  END IF;

  IF p_action_id IS NULL THEN
    RAISE EXCEPTION 'A acao confirmada do assistente e obrigatoria.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.ai_action_requests action
    WHERE action.id = p_action_id
      AND action.user_id = auth.uid()
      AND action.status IN ('confirmed', 'executing')
  ) THEN
    RAISE EXCEPTION 'A acao do assistente nao foi confirmada pelo usuario.';
  END IF;

  IF NULLIF(btrim(COALESCE(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Informe o motivo do ajuste.';
  END IF;

  total_delta := COALESCE(p_quantity_new_delta, 0)
    + COALESCE(p_quantity_used_delta, 0)
    + COALESCE(p_quantity_damaged_delta, 0);

  IF total_delta = 0
     AND COALESCE(p_quantity_new_delta, 0) = 0
     AND COALESCE(p_quantity_used_delta, 0) = 0
     AND COALESCE(p_quantity_damaged_delta, 0) = 0 THEN
    RAISE EXCEPTION 'Informe ao menos uma alteracao de quantidade.';
  END IF;

  SELECT * INTO target_item
  FROM public.stock_items
  WHERE id = p_stock_item_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item de estoque nao encontrado.';
  END IF;

  IF target_item.quantity_new + COALESCE(p_quantity_new_delta, 0) < 0
     OR target_item.quantity_used + COALESCE(p_quantity_used_delta, 0) < 0
     OR target_item.quantity_damaged + COALESCE(p_quantity_damaged_delta, 0) < 0 THEN
    RAISE EXCEPTION 'O ajuste deixaria uma classificacao do estoque negativa.';
  END IF;

  PERFORM set_config('app.stock_movement_source', 'assistant', true);
  PERFORM set_config('app.stock_movement_kind', CASE WHEN total_delta > 0 THEN 'entry' ELSE 'adjustment' END, true);
  PERFORM set_config('app.stock_movement_operation_id', p_action_id::TEXT, true);
  PERFORM set_config('app.stock_movement_related_type', 'assistant_action', true);
  PERFORM set_config('app.stock_movement_related_id', p_action_id::TEXT, true);
  PERFORM set_config('app.stock_movement_description', btrim(p_reason), true);

  UPDATE public.stock_items
     SET quantity_new = quantity_new + COALESCE(p_quantity_new_delta, 0),
         quantity_used = quantity_used + COALESCE(p_quantity_used_delta, 0),
         quantity_damaged = quantity_damaged + COALESCE(p_quantity_damaged_delta, 0),
         current_quantity = current_quantity + total_delta,
         updated_at = now()
   WHERE id = target_item.id
   RETURNING * INTO result_item;

  RETURN result_item;
END;
$$;

CREATE OR REPLACE FUNCTION public.assistant_create_stock_item(
  p_name TEXT,
  p_unit TEXT,
  p_category TEXT,
  p_minimum_quantity INTEGER,
  p_quantity_new INTEGER,
  p_quantity_used INTEGER,
  p_quantity_damaged INTEGER,
  p_description TEXT,
  p_ca_nr TEXT,
  p_action_id UUID
)
RETURNS public.stock_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result_item public.stock_items%ROWTYPE;
BEGIN
  IF NOT public.is_active_supervisor() THEN
    RAISE EXCEPTION 'Acesso negado: somente supervisores ativos podem criar itens.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.ai_action_requests action
    WHERE action.id = p_action_id
      AND action.user_id = auth.uid()
      AND action.status IN ('confirmed', 'executing')
  ) THEN
    RAISE EXCEPTION 'A acao do assistente nao foi confirmada pelo usuario.';
  END IF;

  IF NULLIF(btrim(COALESCE(p_name, '')), '') IS NULL THEN
    RAISE EXCEPTION 'O nome do item e obrigatorio.';
  END IF;
  IF NULLIF(btrim(COALESCE(p_unit, '')), '') IS NULL THEN
    RAISE EXCEPTION 'A unidade do item e obrigatoria.';
  END IF;
  IF COALESCE(p_minimum_quantity, 0) < 0
     OR COALESCE(p_quantity_new, 0) < 0
     OR COALESCE(p_quantity_used, 0) < 0
     OR COALESCE(p_quantity_damaged, 0) < 0 THEN
    RAISE EXCEPTION 'Quantidades nao podem ser negativas.';
  END IF;

  PERFORM set_config('app.stock_movement_source', 'assistant', true);
  PERFORM set_config('app.stock_movement_kind', 'initial_entry', true);
  PERFORM set_config('app.stock_movement_operation_id', p_action_id::TEXT, true);
  PERFORM set_config('app.stock_movement_related_type', 'assistant_action', true);
  PERFORM set_config('app.stock_movement_related_id', p_action_id::TEXT, true);
  PERFORM set_config('app.stock_movement_description', 'Item criado pelo assistente apos confirmacao.', true);

  INSERT INTO public.stock_items (
    name, unit, category, minimum_quantity, quantity_new, quantity_used,
    quantity_damaged, current_quantity, description, ca_nr, created_by
  ) VALUES (
    btrim(p_name), btrim(p_unit), NULLIF(btrim(COALESCE(p_category, '')), ''),
    COALESCE(p_minimum_quantity, 0), COALESCE(p_quantity_new, 0),
    COALESCE(p_quantity_used, 0), COALESCE(p_quantity_damaged, 0),
    COALESCE(p_quantity_new, 0) + COALESCE(p_quantity_used, 0) + COALESCE(p_quantity_damaged, 0),
    NULLIF(btrim(COALESCE(p_description, '')), ''),
    NULLIF(btrim(COALESCE(p_ca_nr, '')), ''), auth.uid()
  ) RETURNING * INTO result_item;

  RETURN result_item;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.assistant_adjust_stock_item(UUID, INTEGER, INTEGER, INTEGER, TEXT, UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.assistant_create_stock_item(TEXT, TEXT, TEXT, INTEGER, INTEGER, INTEGER, INTEGER, TEXT, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assistant_adjust_stock_item(UUID, INTEGER, INTEGER, INTEGER, TEXT, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.assistant_create_stock_item(TEXT, TEXT, TEXT, INTEGER, INTEGER, INTEGER, INTEGER, TEXT, TEXT, UUID) TO authenticated, service_role;

COMMIT;
