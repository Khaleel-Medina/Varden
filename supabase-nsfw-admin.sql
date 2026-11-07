-- Varden — NSFW tagging and the admin role.
--
-- Run after supabase-accounts.sql. Every statement is safe to re-run.
--
-- NSFW is a boolean on the row so the feed can filter server-side: a visitor who
-- has the filter on never downloads the art it is hiding.
--
-- Admin is a table rather than a flag on a profile. Membership can only be granted
-- by running promote_admin() from the SQL editor as the database owner — the public
-- anon key cannot call it, so nobody can promote themselves from a browser.

alter table shared_cards add column if not exists nsfw boolean not null default false;
create index if not exists idx_shared_cards_nsfw on shared_cards(nsfw);

create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.admins enable row level security;

-- security definer so row policies elsewhere can ask "is this an admin?" without
-- granting anyone the right to read the admin list itself.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admins a where a.user_id = auth.uid());
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

-- A signed-in user may only learn whether they are an admin, not who else is.
drop policy if exists "admins can read their own row" on public.admins;
create policy "admins can read their own row" on public.admins
  for select to authenticated
  using (user_id = auth.uid());

-- Owners delete their own cards; admins may delete anyone's. Nobody else.
drop policy if exists "owners delete their shared cards" on shared_cards;
drop policy if exists "owners and admins delete shared cards" on shared_cards;
create policy "owners and admins delete shared cards" on shared_cards
  for delete to authenticated
  using (auth.uid() = user_id or public.is_admin());

-- The row is only half of a delete: the PNG has to go too, from whichever bucket
-- it lives in.
drop policy if exists "owners delete their card files" on storage.objects;
create policy "owners delete their card files" on storage.objects
  for delete to authenticated
  using (bucket_id = 'cards' and (auth.uid()::text = (storage.foldername(name))[1] or public.is_admin()));

drop policy if exists "owners delete private card files" on storage.objects;
create policy "owners delete private card files" on storage.objects
  for delete to authenticated
  using (bucket_id = 'cards-private' and (auth.uid()::text = (storage.foldername(name))[1] or public.is_admin()));

-- Grant admin rights by account email. Run from the SQL editor only:
--   select public.promote_admin('you@example.com');
create or replace function public.promote_admin(admin_email text)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  target uuid;
begin
  select id into target from auth.users where lower(email) = lower(admin_email);
  if target is null then
    raise exception 'No account exists for % — sign up first, then promote.', admin_email;
  end if;
  insert into public.admins (user_id) values (target) on conflict (user_id) do nothing;
  return target;
end;
$$;

revoke all on function public.promote_admin(text) from public;

-- To undo: delete from public.admins where user_id = '<uuid>';


-- Admins can relabel any card, not only delete it. The label is what hides a card
-- from everyone else's feed, so moderation has to work without the owner.
drop policy if exists "admins update any shared card" on shared_cards;
create policy "admins update any shared card" on shared_cards
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());
