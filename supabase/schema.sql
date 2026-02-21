-- Create profiles table (★ 已添加底层防负数约束)
create table public.profiles (
  id uuid references auth.users not null primary key,
  name text,
  role text,
  credits integer default 0 check (credits >= 0), -- ★ No free credits! Users must purchase via Stripe. CHECK prevents negative balance.
  is_pro boolean default false,
  is_admin boolean default false,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable Row Level Security (RLS)
alter table public.profiles enable row level security;

-- Create policies for profiles
create policy "Public profiles are viewable by everyone."
  on profiles for select
  using ( true );

create policy "Users can insert their own profile."
  on profiles for insert
  with check ( auth.uid() = id );

create policy "Users can update own profile."
  on profiles for update
  using ( auth.uid() = id );

-- Create storyboards table
create table public.storyboards (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) not null,
  title text not null,
  visual_style text,
  character_anchor text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable RLS for storyboards
alter table public.storyboards enable row level security;

-- Create policies for storyboards
create policy "Users can view their own storyboards."
  on storyboards for select
  using ( auth.uid() = user_id );

create policy "Users can insert their own storyboards."
  on storyboards for insert
  with check ( auth.uid() = user_id );

create policy "Users can update their own storyboards."
  on storyboards for update
  using ( auth.uid() = user_id );

create policy "Users can delete their own storyboards."
  on storyboards for delete
  using ( auth.uid() = user_id );

-- Create scenes table
create table public.scenes (
  id uuid default gen_random_uuid() primary key,
  storyboard_id uuid references public.storyboards(id) on delete cascade not null,
  scene_number integer not null,
  visual_description text,
  audio_description text,
  shot_type text,
  image_prompt text,
  video_motion_prompt text,
  image_url text, -- New field
  video_url text, -- New field
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable RLS for scenes
alter table public.scenes enable row level security;

-- Create policies for scenes
create policy "Users can view scenes from their storyboards."
  on scenes for select
  using ( exists ( select 1 from public.storyboards s where s.id = scenes.storyboard_id and s.user_id = auth.uid() ) );

create policy "Users can insert scenes to their storyboards."
  on scenes for insert
  with check ( exists ( select 1 from public.storyboards s where s.id = storyboard_id and s.user_id = auth.uid() ) );

create policy "Users can update scenes from their storyboards."
  on scenes for update
  using ( exists ( select 1 from public.storyboards s where s.id = scenes.storyboard_id and s.user_id = auth.uid() ) );

create policy "Users can delete scenes from their storyboards."
  on scenes for delete
  using ( exists ( select 1 from public.storyboards s where s.id = scenes.storyboard_id and s.user_id = auth.uid() ) );

-- Create a trigger to create a profile on signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, name, role)
  values (new.id, new.raw_user_meta_data->>'name', new.raw_user_meta_data->>'role');
  return new;
end;
$$ language plpgsql security definer;

-- Trigger check (drop before create just in case)
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();