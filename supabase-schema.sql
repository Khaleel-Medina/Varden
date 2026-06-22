-- Varden Supabase Schema
-- Safe to run multiple times.

-- profiles table
create table if not exists profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  display_name text,
  avatar_url text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(user_id)
);

-- characters table
create table if not exists characters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  slug text not null,
  source text,
  creator text,
  visibility text default 'private',
  tagline text,
  greeting text,
  personality text,
  tags text[] default '{}',
  art_a text,
  art_b text,
  art_c text,
  art_url text,
  likes bigint default 0,
  bookmarks bigint default 0,
  rating text default '0.0',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- uploads table
create table if not exists uploads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  character_id uuid references characters(id) on delete cascade,
  path text not null,
  url text not null,
  mime_type text,
  size bigint,
  created_at timestamptz default now()
);

-- indexes
create index if not exists idx_characters_user_id on characters(user_id);
create index if not exists idx_characters_visibility on characters(visibility);
create index if not exists idx_uploads_character_id on uploads(character_id);

-- Enable RLS
alter table profiles enable row level security;
alter table characters enable row level security;
alter table uploads enable row level security;

-- Drop existing policies to avoid conflicts
drop policy if exists "profiles are viewable by everyone" on profiles;
drop policy if exists "users can update own profile" on profiles;
drop policy if exists "characters are viewable by everyone" on characters;
drop policy if exists "owners can insert their characters" on characters;
drop policy if exists "owners can update their characters" on characters;
drop policy if exists "owners can delete their characters" on characters;
drop policy if exists "uploads are viewable by everyone" on uploads;
drop policy if exists "owners can insert uploads" on uploads;
drop policy if exists "owners can update their uploads" on uploads;
drop policy if exists "owners can delete their uploads" on uploads;

-- profiles policies
create policy "profiles are viewable by everyone" on profiles for select using (true);
create policy "users can update own profile" on profiles for update using (auth.uid() = user_id);

-- characters policies
create policy "characters are viewable by everyone" on characters for select using (true);
create policy "owners can insert their characters" on characters for insert with check (auth.uid() = user_id);
create policy "owners can update their characters" on characters for update using (auth.uid() = user_id);
create policy "owners can delete their characters" on characters for delete using (auth.uid() = user_id);

-- uploads policies
create policy "uploads are viewable by everyone" on uploads for select using (true);
create policy "owners can insert uploads" on uploads for insert with check (auth.uid() = user_id);
create policy "owners can update their uploads" on uploads for update using (auth.uid() = user_id);
create policy "owners can delete their uploads" on uploads for delete using (auth.uid() = user_id);
