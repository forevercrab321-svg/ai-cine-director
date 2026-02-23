-- One-time migration: set initial credits to 50
-- Run in Supabase SQL Editor

-- 1) Update default for new users
ALTER TABLE public.profiles
  ALTER COLUMN credits SET DEFAULT 50;

-- 2) Ensure trigger assigns 50 on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, name, role, credits)
  values (new.id, new.raw_user_meta_data->>'name', new.raw_user_meta_data->>'role', 50);
  return new;
end;
$$ language plpgsql security definer;

DROP TRIGGER IF EXISTS on_auth_user_created on auth.users;
CREATE TRIGGER on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- 3) Optional: grant 50 credits to existing non-admin users who are at 0
UPDATE public.profiles
SET credits = 50
WHERE credits = 0 AND is_admin = false;
