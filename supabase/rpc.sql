-- 1. Update Profiles Table
-- alter table public.profiles add column if not exists monthly_credits_used integer default 0;
-- alter table public.profiles add column if not exists plan_type text default 'creator'; -- 'creator' or 'director'
-- alter table public.profiles add column if not exists has_purchased_credits boolean default false;

-- 2. Create Generation Logs Table
create table if not exists public.generation_logs (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) not null,
  model text not null,
  base_cost integer not null,
  multiplier numeric(3,1) default 1.0,
  final_cost integer not null,
  created_at timestamptz default now()
);

-- 3. Upgrade Deduct Credits Function (★ 终极防并发穿仓版)
create or replace function public.deduct_credits(
  amount_to_deduct integer,
  model_used text default 'unknown',
  base_cost integer default 0,
  multiplier numeric default 1.0
)
returns boolean
language plpgsql
security definer
as $$
declare
  affected_rows integer;
begin
  -- ★ 核心防御：绝对不能“先查后改”。必须直接使用原子的 UPDATE，在同一条语句中完成检查和扣减！
  update public.profiles
  set 
    credits = credits - amount_to_deduct,
    monthly_credits_used = coalesce(monthly_credits_used, 0) + amount_to_deduct
  where id = auth.uid() 
    and credits >= amount_to_deduct; -- 这一行是锁死并发的灵魂：只有余额充足时才允许修改

  -- 获取上一条 update 语句实际修改的行数
  get diagnostics affected_rows = row_count;

  -- 如果影响的行数为 0，说明要么用户不存在，要么余额已经被别的并发请求扣没了（不足以支付本次金额），直接拒绝
  if affected_rows = 0 then
    return false;
  end if;

  -- 扣减成功后，记录交易日志
  insert into public.generation_logs (user_id, model, base_cost, multiplier, final_cost)
  values (auth.uid(), model_used, base_cost, multiplier, amount_to_deduct);

  return true;
end;
$$;

-- 4. Function to Reset Monthly Usage (Run by cron/trigger)
create or replace function public.reset_monthly_usage()
returns void
language plpgsql
security definer
as $$
begin
  update public.profiles set monthly_credits_used = 0;
end;
$$;