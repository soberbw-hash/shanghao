-- ShangHao account system v1.
-- Auth owns the permanent UUID. Public profiles expose only room-safe identity data.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  display_name text not null,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_username_canonical check (username = lower(username)),
  constraint profiles_username_format check (username ~ '^[a-z0-9][a-z0-9_-]{2,19}$'),
  constraint profiles_display_name_length check (char_length(display_name) between 1 and 32),
  constraint profiles_username_unique unique (username)
);

create table if not exists private.username_login_map (
  username text primary key,
  user_id uuid not null unique references auth.users(id) on delete cascade,
  email text not null unique,
  created_at timestamptz not null default now(),
  constraint username_login_map_canonical check (username = lower(username))
);

revoke all on private.username_login_map from public, anon, authenticated;

create or replace function private.touch_profile_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
before update on public.profiles
for each row execute function private.touch_profile_updated_at();

create or replace function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  canonical_username text;
  requested_display_name text;
begin
  canonical_username := lower(trim(coalesce(new.raw_user_meta_data ->> 'username', '')));
  requested_display_name := trim(coalesce(new.raw_user_meta_data ->> 'display_name', canonical_username));

  if canonical_username !~ '^[a-z0-9][a-z0-9_-]{2,19}$' then
    raise exception using errcode = 'P0001', message = 'shanghao_username_invalid';
  end if;

  if canonical_username = any(array[
    'admin', 'administrator', 'system', 'support', 'official', 'shanghao'
  ]) then
    raise exception using errcode = 'P0001', message = 'shanghao_username_reserved';
  end if;

  if new.email is null or trim(new.email) = '' then
    raise exception using errcode = 'P0001', message = 'shanghao_email_required';
  end if;

  if char_length(requested_display_name) < 1 or char_length(requested_display_name) > 32 then
    requested_display_name := canonical_username;
  end if;

  insert into public.profiles (id, username, display_name)
  values (new.id, canonical_username, requested_display_name);

  insert into private.username_login_map (username, user_id, email)
  values (canonical_username, new.id, lower(new.email));

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_shanghao_profile on auth.users;
create trigger on_auth_user_created_shanghao_profile
after insert on auth.users
for each row execute function private.handle_new_auth_user();

create or replace function public.resolve_account_email(input_identifier text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  canonical_identifier text := lower(trim(coalesce(input_identifier, '')));
  resolved_email text;
begin
  if canonical_identifier like '%@%' then
    return canonical_identifier;
  end if;

  select mapping.email
  into resolved_email
  from private.username_login_map as mapping
  where mapping.username = canonical_identifier;

  return resolved_email;
end;
$$;

revoke all on function public.resolve_account_email(text) from public, anon, authenticated;
grant execute on function public.resolve_account_email(text) to service_role;

alter table public.profiles enable row level security;

drop policy if exists "profiles are readable" on public.profiles;
create policy "profiles are readable"
on public.profiles
for select
to anon, authenticated
using (true);

drop policy if exists "users update their own profile" on public.profiles;
create policy "users update their own profile"
on public.profiles
for update
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

revoke all on public.profiles from anon, authenticated;
grant select (id, username, display_name, avatar_url, created_at, updated_at)
on public.profiles to anon, authenticated;
grant update (display_name, avatar_url)
on public.profiles to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  524288,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "users upload their own avatar" on storage.objects;
create policy "users upload their own avatar"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

drop policy if exists "users update their own avatar" on storage.objects;
create policy "users update their own avatar"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
)
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

drop policy if exists "users delete their own avatar" on storage.objects;
create policy "users delete their own avatar"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);
