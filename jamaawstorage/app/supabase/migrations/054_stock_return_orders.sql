BEGIN;

-- ---------------------------------------------------------------------------
-- A devolucao passa a ter um cabecalho. Antes cada item devolvido era uma linha
-- solta em stock_return_requests: nao existia "a devolucao do Joao", existiam N
-- registros independentes. Sem essa entidade nao ha o que imprimir em um termo,
-- nem o que triar de uma vez, nem o que confirmar em uma unica transacao.
-- ---------------------------------------------------------------------------

CREATE SEQUENCE IF NOT EXISTS public.stock_return_code_seq START 1;

CREATE OR REPLACE FUNCTION public.generate_stock_return_code()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  today_code TEXT;
  next_seq BIGINT;
BEGIN
  IF NEW.code IS NOT NULL THEN
    RETURN NEW;
  END IF;

  today_code := 'DEV-' || to_char(now(), 'YYYYMMDD');
  next_seq := nextval('public.stock_return_code_seq');
  NEW.code := today_code || '-' || lpad(next_seq::TEXT, 6, '0');
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS public.stock_returns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NULL UNIQUE,

  -- De onde o material veio. Mesmo par de colunas usado em stock_return_requests
  -- para que a origem continue sendo lida da mesma forma no resto do sistema.
  source_type TEXT NOT NULL CHECK (source_type IN ('collaborator', 'work_site')),
  source_person_id UUID NULL REFERENCES public.people(id) ON DELETE RESTRICT,
  source_work_site_id UUID NULL REFERENCES public.work_sites(id) ON DELETE RESTRICT,

  -- draft          : rascunho, ainda sem efeito sobre inventario.
  -- awaiting_triage: material recebido, baixado do inventario, termo gerado.
  -- triaged        : classificado em new/used/damaged, ainda fora do estoque.
  -- completed      : creditado no estoque. Ponto final.
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'awaiting_triage', 'triaged', 'completed', 'cancelled')),

  -- Motivo da devolucao. 'termination' e o caso central: colaborador desligado
  -- devolvendo tudo o que tem.
  reason TEXT NOT NULL DEFAULT 'general'
    CHECK (reason IN ('general', 'termination', 'work_site_closure', 'exchange')),

  notes TEXT NULL,
  triage_notes TEXT NULL,

  -- Snapshot de quem devolveu, congelado na geracao do termo. O nome impresso no
  -- PDF precisa continuar valido mesmo que o cadastro mude depois.
  source_label_snapshot TEXT NULL,

  created_by UUID NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  received_by UUID NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  received_at TIMESTAMPTZ NULL,
  triaged_by UUID NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  triaged_at TIMESTAMPTZ NULL,
  completed_by UUID NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  completed_at TIMESTAMPTZ NULL,
  cancelled_by UUID NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  cancelled_at TIMESTAMPTZ NULL,
  cancellation_reason TEXT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT stock_returns_source_check CHECK (
    (source_type = 'collaborator' AND source_person_id IS NOT NULL AND source_work_site_id IS NULL)
    OR (source_type = 'work_site' AND source_work_site_id IS NOT NULL AND source_person_id IS NULL)
  ),

  -- Rascunho ainda nao tem codigo; a partir do recebimento o codigo e obrigatorio
  -- porque ele identifica o termo impresso.
  CONSTRAINT stock_returns_code_required_after_draft CHECK (
    status IN ('draft', 'cancelled') OR code IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_stock_returns_status
  ON public.stock_returns(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_stock_returns_source_person
  ON public.stock_returns(source_person_id)
  WHERE source_person_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_stock_returns_source_work_site
  ON public.stock_returns(source_work_site_id)
  WHERE source_work_site_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_stock_returns_generate_code ON public.stock_returns;
CREATE TRIGGER trg_stock_returns_generate_code
  BEFORE INSERT ON public.stock_returns
  FOR EACH ROW EXECUTE FUNCTION public.generate_stock_return_code();

DROP TRIGGER IF EXISTS trg_stock_returns_updated_at ON public.stock_returns;
CREATE TRIGGER trg_stock_returns_updated_at
  BEFORE UPDATE ON public.stock_returns
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------------
-- Itens da devolucao.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.stock_return_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_return_id UUID NOT NULL REFERENCES public.stock_returns(id) ON DELETE CASCADE,
  stock_item_id UUID NOT NULL REFERENCES public.stock_items(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),

  -- Estado declarado na chegada, antes da conferencia. Fato historico: a triagem
  -- nao sobrescreve este campo, ela grava o resultado em outra tabela.
  reported_condition TEXT NOT NULL DEFAULT 'used'
    CHECK (reported_condition IN ('new', 'used', 'damaged')),

  -- Retirada que originou o item, quando a devolucao nasce de uma retirada.
  origin_withdrawal_item_id UUID NULL
    REFERENCES public.withdrawal_items(id) ON DELETE RESTRICT,

  item_photo_url TEXT NULL,
  notes TEXT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT stock_return_items_unique_item UNIQUE (stock_return_id, stock_item_id)
);

CREATE INDEX IF NOT EXISTS idx_stock_return_items_return
  ON public.stock_return_items(stock_return_id);

CREATE INDEX IF NOT EXISTS idx_stock_return_items_stock_item
  ON public.stock_return_items(stock_item_id);

CREATE INDEX IF NOT EXISTS idx_stock_return_items_origin_withdrawal_item
  ON public.stock_return_items(origin_withdrawal_item_id)
  WHERE origin_withdrawal_item_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_stock_return_items_updated_at ON public.stock_return_items;
CREATE TRIGGER trg_stock_return_items_updated_at
  BEFORE UPDATE ON public.stock_return_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------------
-- Resultado da triagem: como a quantidade de um item se reparte entre os estados.
-- Uma linha por estado, para que 10 unidades possam virar 6 novas + 3 usadas +
-- 1 danificada. O modelo anterior guardava uma unica condicao por linha e por
-- isso nao conseguia representar chegada mista.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.stock_return_item_conditions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_return_item_id UUID NOT NULL
    REFERENCES public.stock_return_items(id) ON DELETE CASCADE,
  condition TEXT NOT NULL CHECK (condition IN ('new', 'used', 'damaged')),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT stock_return_item_conditions_unique UNIQUE (stock_return_item_id, condition)
);

CREATE INDEX IF NOT EXISTS idx_stock_return_item_conditions_item
  ON public.stock_return_item_conditions(stock_return_item_id);

-- ---------------------------------------------------------------------------
-- RLS: mesmo contrato das demais tabelas de estoque.
-- Escrita passa somente pelos RPCs da migration 056, entao aqui so ha SELECT.
-- ---------------------------------------------------------------------------

ALTER TABLE public.stock_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_return_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_return_item_conditions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "stock_returns_select_supervisor" ON public.stock_returns;
CREATE POLICY "stock_returns_select_supervisor" ON public.stock_returns
FOR SELECT USING ((SELECT public.is_active_supervisor()));

DROP POLICY IF EXISTS "stock_return_items_select_supervisor" ON public.stock_return_items;
CREATE POLICY "stock_return_items_select_supervisor" ON public.stock_return_items
FOR SELECT USING ((SELECT public.is_active_supervisor()));

DROP POLICY IF EXISTS "stock_return_item_conditions_select_supervisor" ON public.stock_return_item_conditions;
CREATE POLICY "stock_return_item_conditions_select_supervisor" ON public.stock_return_item_conditions
FOR SELECT USING ((SELECT public.is_active_supervisor()));

REVOKE ALL ON FUNCTION public.generate_stock_return_code() FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.stock_returns IS
  'Cabecalho da devolucao. Ciclo: draft -> awaiting_triage -> triaged -> completed. O estoque so e creditado na transicao para completed.';
COMMENT ON TABLE public.stock_return_item_conditions IS
  'Resultado da triagem por item. Uma linha por estado, permitindo que um mesmo item se reparta entre new, used e damaged.';

COMMIT;
