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

-- 3. Upgrade Deduct Credits Function
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
  current_credits integer;
  current_usage integer;
  user_plan text;
  plan_limit integer;
  purchased_flag boolean;
begin
  -- Get user details
  select credits, monthly_credits_used, plan_type, has_purchased_credits
  into current_credits, current_usage, user_plan, purchased_flag
  from public.profiles
  where id = auth.uid();

  -- Set plan limits
  if user_plan = 'director' then
    plan_limit := 3500;
  else
    plan_limit := 1000; -- default creator
  end if;

  -- Fair Use Check:
  -- If usage > limit AND they haven't purchased extra credits, we might want to block?
  -- But usually "credits" IS the hard limit. If they have credits, let them spend.
  -- The "Fair Use" is mostly a soft limit for subscription credits.
  -- STRICT MODE: If (current_usage + amount_to_deduct) > plan_limit AND purchased_flag = false AND current_credits < amount_to_deduct THEN return false;
  -- For now, we trust the "credits" balance is the ultimate source of truth.

  if current_credits >= amount_to_deduct then
    -- 1. Deduct credits
    update public.profiles
    set 
      credits = credits - amount_to_deduct,
      monthly_credits_used = coalesce(monthly_credits_used, 0) + amount_to_deduct
    where id = auth.uid();

    -- 2. Log transaction
    insert into public.generation_logs (user_id, model, base_cost, multiplier, final_cost)
    values (auth.uid(), model_used, base_cost, multiplier, amount_to_deduct);

    return true;
  else
    return false;
  end if;
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
