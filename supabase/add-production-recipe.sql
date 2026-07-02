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


-- ── Set recipe ratios for existing materials (run once) ───────────────────────
-- Packaging Bags: 1 bag produced = 1 packaging bag used
UPDATE public.raw_materials
  SET usage_per_bag = 1
  WHERE name ILIKE '%packaging%' OR name ILIKE '%sachet bag%';

-- Water: 1 bag produced = 30 sachets x 0.5L = 15 litres
UPDATE public.raw_materials
  SET usage_per_bag = 15
  WHERE name ILIKE '%water%';

-- Verify
SELECT name, unit, current_stock, usage_per_bag FROM public.raw_materials ORDER BY name;

-- ── One-time sync: set "Roll Film" stock to match sum of all registered rolls ──
-- Run this once after deploying the code fix, to correct the historical disconnect
UPDATE public.raw_materials
SET current_stock = COALESCE(
  (SELECT SUM(COALESCE(kg_remaining, weight_kg)) FROM public.roll_films), 0
)
WHERE name ILIKE 'Roll Film';

SELECT name, current_stock FROM public.raw_materials WHERE name ILIKE 'Roll Film';


-- ── Fix existing data: enforce one active roll at a time ─────────────────────
-- Step 1: Set all in_use rolls to 'available' first
UPDATE public.roll_films SET status = 'available' WHERE status = 'in_use';

-- Step 2: Activate the single oldest non-finished roll as the active one
UPDATE public.roll_films
SET status = 'in_use'
WHERE id = (
  SELECT id FROM public.roll_films
  WHERE status = 'available'
  ORDER BY purchase_date ASC, id ASC
  LIMIT 1
);

-- Verify
SELECT id, label, status, kg_remaining, bags_produced FROM public.roll_films ORDER BY purchase_date;
