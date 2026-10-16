-- Domácnost+ P0 Garáž v0.1_543
-- Spustit POUZE po potvrzení identifikace projektu Domácnost+.
-- NESPÚŠTĚT na projektech RaK; operace je pouze aditivní, nepřepisuje záznamy.
BEGIN;
DO $$
BEGIN
  IF to_regclass('public.vehicles') IS NULL THEN
    RAISE EXCEPTION 'Tabulka public.vehicles chybí - ověřte Supabase projekt';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'vehicles'
      AND column_name = 'insurance_contract_id' AND data_type <> 'uuid'
  ) THEN
    RAISE EXCEPTION 'insurance_contract_id má jiný datový typ; migrace zastavena';
  END IF;
END $$;
ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS insurance_contract_id uuid;
COMMIT;
NOTIFY pgrst, 'reload schema';
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema='public' AND table_name='vehicles'
  AND column_name='insurance_contract_id';
