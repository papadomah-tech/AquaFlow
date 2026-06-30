-- Recipe ratios: how much of each raw material is consumed per bag produced
ALTER TABLE public.raw_materials
  ADD COLUMN IF NOT EXISTS usage_per_bag numeric DEFAULT 0;
  -- e.g. Sachet Bags: 1 per bag, Preservative: 0.002 L per bag

-- Roll film Kg tracking
ALTER TABLE public.roll_films
  ADD COLUMN IF NOT EXISTS kg_remaining numeric;

-- Back-fill kg_remaining from weight_kg for existing rolls
UPDATE public.roll_films
  SET kg_remaining = weight_kg
  WHERE kg_remaining IS NULL;

-- Production batches: track Kg of film consumed
ALTER TABLE public.production_batches
  ADD COLUMN IF NOT EXISTS roll_kg_used numeric DEFAULT 0;

SELECT 'production recipe columns added' as status;
