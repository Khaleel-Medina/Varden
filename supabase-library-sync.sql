-- Varden — cross-device sync for a signed-in visitor's library.
-- Run in the Supabase SQL editor after supabase-accounts.sql. Safe to re-run.
--
-- One row per account carries the same shapes the browser keeps in IndexedDB:
-- characters, chats, personas, memories, plus tombstones for deletions. The
-- browser stays the place those are read from; this table only moves a copy
-- between devices. Row policies keep each row readable and writable by its owner
-- and nobody else, so a card or a chat never becomes public by syncing it.

create table if not exists public.user_library (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  saved_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_library enable row level security;

drop policy if exists "owners read their library" on public.user_library;
create policy "owners read their library"
  on public.user_library for select
  using (auth.uid() = user_id);

drop policy if exists "owners write their library" on public.user_library;
create policy "owners write their library"
  on public.user_library for insert
  with check (auth.uid() = user_id);

drop policy if exists "owners update their library" on public.user_library;
create policy "owners update their library"
  on public.user_library for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "owners delete their library" on public.user_library;
create policy "owners delete their library"
  on public.user_library for delete
  using (auth.uid() = user_id);

-- saved_at is written by the browser (it is the merge clock), updated_at is the
-- server's own record of when the row last changed.
create or replace function public.touch_user_library()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists user_library_touch on public.user_library;
create trigger user_library_touch
  before update on public.user_library
  for each row execute function public.touch_user_library();
