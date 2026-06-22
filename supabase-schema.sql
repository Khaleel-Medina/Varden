-- Varden Supabase Schema
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor → New Query → Paste & Run)

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- Users table (extends Supabase auth.users)
create table if not exists profiles (
  id uuid references auth.users(id) on delete cascade primary key,
  email text,
  display_name text,
  avatar_url text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Characters table
create table if not exists characters (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  slug text not null,
  description text,
  personality text,
  scenario text,
  first_mes text,
  mes_example text,
  tags text[] default '{}',
  art_url text,
  art_a text default '#6d5dfc',
  art_b text default '#111827',
  art_c text default '#3ad6c6',
  rating double precision default 0,
  likes bigint default 0,
  bookmarks bigint default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(user_id, slug)
);

-- Uploads (images)
create table if not exists uploads (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  path text not null,
  content_type text,
  size bigint,
  created_at timestamptz default now()
);

-- Create indexes
create index if not exists idx_characters_user_id on characters(user_id);
create index if not exists idx_characters_slug on characters(slug);
create index if not exists idx_characters_name on characters(name) where name is not null;
create index if not exists idx_uploads_user_id on uploads(user_id);

-- RLS policies
alter table profiles enable row level security;
alter table characters enable row level security;
alter table uploads enable row level security;

-- Profiles: users can read all, update own
create policy "profiles visible to all" on profiles for select using (true);
create policy "users update own profile" on profiles for update using (auth.uid() = id);
create policy "users insert own profile" on profiles for insert with check (auth.uid() = id);

-- Characters: owner full access, anyone can read
create policy "characters readable by all" on characters for select using (true);
create policy "owners full access to characters" on characters for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Uploads: owner full access
create policy "uploads readable by all" on uploads for select using (true);
create policy "users manage own uploads" on uploads for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Triggers for updated_at
create or replace function update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger update_profiles_updated_at before update on profiles
  for each row execute function update_updated_at_column();

create trigger update_characters_updated_at before update on characters
  for each row execute function update_updated_at_column();
