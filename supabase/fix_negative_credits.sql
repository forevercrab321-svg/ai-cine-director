-- ★ STEP 1: Reset any negative credits to 0
UPDATE public.profiles
SET credits = 0
WHERE credits < 0;

-- ★ STEP 2: Add CHECK constraint to prevent DB-level negative credits (Ultimate Defense)
ALTER TABLE public.profiles
DROP CONSTRAINT IF EXISTS credits_non_negative;

ALTER TABLE public.profiles
ADD CONSTRAINT credits_non_negative CHECK (credits >= 0);

-- ★ STEP 3: Create atomic reserve_credits function (Matching your Node.js API)
CREATE OR REPLACE FUNCTION public.reserve_credits(
  amount numeric,
  ref_type text,
  ref_id text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  affected_rows integer;
BEGIN
  -- 原子操作：在一行内同时完成验证和扣费，彻底阻断并发击穿
  UPDATE public.profiles
  SET 
    credits = credits - amount,
    monthly_credits_used = COALESCE(monthly_credits_used, 0) + amount
  WHERE id = auth.uid() 
    AND credits >= amount; -- 核心防线：只在余额充足时才执行修改

  -- 检查上一条 UPDATE 是否成功执行
  GET DIAGNOSTICS affected_rows = ROW_COUNT;

  -- 如果影响的行数为 0，说明要么用户不存在，要么 credits 不够扣，直接拒绝
  IF affected_rows = 0 THEN
    RETURN false;
  END IF;

  -- 记录账本/日志 (这里兼容了你的 ref_type 和 ref_id 参数)
  INSERT INTO public.credits_ledger (user_id, delta, kind, ref_type, ref_id, status)
  VALUES (auth.uid(), -amount, 'reserve', ref_type, ref_id, 'pending');

  RETURN true;
END;
$$;

-- ★ STEP 4: Verify the fix worked
SELECT id, credits FROM public.profiles WHERE credits < 0;