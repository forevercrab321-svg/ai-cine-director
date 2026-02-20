-- ★ STEP 1: Reset any negative credits to 0
UPDATE public.profiles
SET credits = 0
WHERE credits < 0;

-- ★ STEP 2: Add CHECK constraint to prevent DB-level negative credits
ALTER TABLE public.profiles
DROP CONSTRAINT IF EXISTS credits_non_negative;

ALTER TABLE public.profiles
ADD CONSTRAINT credits_non_negative CHECK (credits >= 0);

-- ★ STEP 3: Ensure deduct_credits function also has GREATEST(0,...) guard
-- This prevents race conditions from causing negative values
CREATE OR REPLACE FUNCTION public.deduct_credits(
  amount_to_deduct integer,
  model_used text DEFAULT 'unknown',
  base_cost integer DEFAULT 0,
  multiplier numeric DEFAULT 1.0
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  current_credits integer;
BEGIN
  -- Get user credit balance (row lock prevents race condition)
  SELECT credits INTO current_credits
  FROM public.profiles
  WHERE id = auth.uid()
  FOR UPDATE;

  -- Reject if insufficient credits
  IF current_credits IS NULL OR current_credits < amount_to_deduct THEN
    RETURN false;
  END IF;

  -- Deduct (GREATEST guard: never go below 0 even under race)
  UPDATE public.profiles
  SET
    credits = GREATEST(0, credits - amount_to_deduct),
    monthly_credits_used = COALESCE(monthly_credits_used, 0) + amount_to_deduct
  WHERE id = auth.uid();

  -- Log transaction
  INSERT INTO public.generation_logs (user_id, model, base_cost, multiplier, final_cost)
  VALUES (auth.uid(), model_used, base_cost, multiplier, amount_to_deduct);

  RETURN true;
END;
$$;

-- ★ STEP 4: Verify the fix worked
SELECT id, credits FROM public.profiles WHERE credits < 0;
-- Should return 0 rows
