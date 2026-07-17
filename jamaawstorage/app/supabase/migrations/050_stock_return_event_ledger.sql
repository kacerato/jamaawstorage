BEGIN;

-- Livro-razão imutável dos fatos da devolução. A tela de movimentações deixa de
-- deduzir o histórico a partir do estado atual de uma devolução.
CREATE TABLE IF NOT EXISTS public.stock_return_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  return_request_id UUID NOT NULL REFERENCES public.stock_return_requests(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('received', 'held_for_triage', 'returned_to_stock')),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  stock_delta INTEGER NOT NULL CHECK (stock_delta >= 0),
  item_condition TEXT NULL CHECK (item_condition IS NULL OR item_condition IN ('new', 'used', 'damaged')),
  actor_id UUID NULL REFERENCES public.profiles(id),
  details TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stock_return_events_request
  ON public.stock_return_events(return_request_id, created_at);

CREATE INDEX IF NOT EXISTS idx_stock_return_events_created_at
  ON public.stock_return_events(created_at DESC);

ALTER TABLE public.stock_return_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "stock_return_events_select_supervisor" ON public.stock_return_events;
CREATE POLICY "stock_return_events_select_supervisor" ON public.stock_return_events
FOR SELECT
USING ((SELECT public.is_active_supervisor()));

-- Registros anteriores recebem os fatos que ainda podem ser afirmados com
-- certeza a partir do estado persistido. Eventos futuros sao gravados no ato.
INSERT INTO public.stock_return_events (
  return_request_id, event_type, quantity, stock_delta, item_condition, actor_id, details, created_at
)
SELECT
  request.id,
  'received',
  request.quantity,
  0,
  request.item_condition,
  request.created_by,
  'Devolucao recebida para conferência.',
  request.created_at
FROM public.stock_return_requests request
WHERE NOT EXISTS (
  SELECT 1
  FROM public.stock_return_events event
  WHERE event.return_request_id = request.id
    AND event.event_type = 'received'
);

INSERT INTO public.stock_return_events (
  return_request_id, event_type, quantity, stock_delta, item_condition, actor_id, details, created_at
)
SELECT
  request.id,
  'held_for_triage',
  request.held_quantity,
  0,
  request.item_condition,
  request.approved_by,
  'Quantidade mantida em triagem.',
  request.updated_at
FROM public.stock_return_requests request
WHERE request.held_quantity > 0
  AND NOT EXISTS (
    SELECT 1
    FROM public.stock_return_events event
    WHERE event.return_request_id = request.id
      AND event.event_type = 'held_for_triage'
  );

INSERT INTO public.stock_return_events (
  return_request_id, event_type, quantity, stock_delta, item_condition, actor_id, details, created_at
)
SELECT
  request.id,
  'returned_to_stock',
  request.approved_quantity,
  request.approved_quantity,
  COALESCE(request.approved_condition, request.item_condition),
  request.approved_by,
  'Quantidade devolvida ao estoque.',
  COALESCE(request.approved_at, request.updated_at)
FROM public.stock_return_requests request
WHERE request.approved_quantity > 0
  AND NOT EXISTS (
    SELECT 1
    FROM public.stock_return_events event
    WHERE event.return_request_id = request.id
      AND event.event_type = 'returned_to_stock'
  );

CREATE OR REPLACE FUNCTION public.record_stock_return_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.stock_return_events (
      return_request_id, event_type, quantity, stock_delta, item_condition, actor_id, details, created_at
    ) VALUES (
      NEW.id,
      'received',
      NEW.quantity,
      0,
      NEW.item_condition,
      NEW.created_by,
      'Devolucao recebida para conferência.',
      NEW.created_at
    );
    RETURN NEW;
  END IF;

  IF NEW.held_quantity > OLD.held_quantity THEN
    INSERT INTO public.stock_return_events (
      return_request_id, event_type, quantity, stock_delta, item_condition, actor_id, details
    ) VALUES (
      NEW.id,
      'held_for_triage',
      NEW.held_quantity - OLD.held_quantity,
      0,
      NEW.item_condition,
      NEW.approved_by,
      COALESCE(NULLIF(NEW.triage_notes, ''), 'Quantidade mantida em triagem.')
    );
  END IF;

  IF NEW.approved_quantity > OLD.approved_quantity THEN
    INSERT INTO public.stock_return_events (
      return_request_id, event_type, quantity, stock_delta, item_condition, actor_id, details, created_at
    ) VALUES (
      NEW.id,
      'returned_to_stock',
      NEW.approved_quantity - OLD.approved_quantity,
      NEW.approved_quantity - OLD.approved_quantity,
      COALESCE(NEW.approved_condition, NEW.item_condition),
      NEW.approved_by,
      COALESCE(NULLIF(NEW.triage_notes, ''), 'Quantidade devolvida ao estoque.'),
      COALESCE(NEW.approved_at, now())
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stock_return_events ON public.stock_return_requests;
CREATE TRIGGER trg_stock_return_events
  AFTER INSERT OR UPDATE OF approved_quantity, held_quantity
  ON public.stock_return_requests
  FOR EACH ROW EXECUTE FUNCTION public.record_stock_return_event();

REVOKE ALL ON FUNCTION public.record_stock_return_event() FROM PUBLIC, anon, authenticated;

COMMIT;
