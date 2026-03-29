-- Media upload setup for flashcards-app.
-- Creates a public Storage bucket, app-level 400 MB quota tracking,
-- and authenticated RPC helpers for reserve/finalize/cancel flows.

begin;

create extension if not exists pgcrypto;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'flashcard-media',
  'flashcard-media',
  true,
  5242880,
  array[
    'image/png',
    'image/jpeg',
    'image/webp',
    'audio/mpeg',
    'audio/wav',
    'audio/ogg'
  ]::text[]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.flashcard_media_quota (
  bucket_id text primary key,
  hard_limit_bytes bigint not null default 419430400,
  used_bytes bigint not null default 0,
  reserved_bytes bigint not null default 0,
  updated_at timestamptz not null default timezone('utc', now()),
  check (hard_limit_bytes > 0),
  check (used_bytes >= 0),
  check (reserved_bytes >= 0)
);

create table if not exists public.flashcard_media_upload_reservations (
  reservation_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  bucket_id text not null,
  object_path text not null,
  bytes bigint not null check (bytes > 0),
  status text not null default 'pending' check (status in ('pending', 'uploaded', 'cancelled')),
  expires_at timestamptz not null default timezone('utc', now()) + interval '15 minutes',
  created_at timestamptz not null default timezone('utc', now()),
  finalized_at timestamptz,
  unique (bucket_id, object_path)
);

create table if not exists public.flashcard_media_assets (
  object_path text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  bucket_id text not null,
  public_url text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0),
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists flashcard_media_assets_user_created_idx
  on public.flashcard_media_assets (user_id, created_at desc);

create index if not exists flashcard_media_reservations_user_created_idx
  on public.flashcard_media_upload_reservations (user_id, created_at desc);

create index if not exists flashcard_media_reservations_bucket_expiry_idx
  on public.flashcard_media_upload_reservations (bucket_id, expires_at)
  where status = 'pending';

alter table public.flashcard_media_quota enable row level security;
alter table public.flashcard_media_upload_reservations enable row level security;
alter table public.flashcard_media_assets enable row level security;

drop policy if exists "flashcard_media_quota_read_authenticated" on public.flashcard_media_quota;
create policy "flashcard_media_quota_read_authenticated"
on public.flashcard_media_quota
for select
to authenticated
using (bucket_id = 'flashcard-media');

drop policy if exists "flashcard_media_reservations_select_own" on public.flashcard_media_upload_reservations;
create policy "flashcard_media_reservations_select_own"
on public.flashcard_media_upload_reservations
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "flashcard_media_assets_select_own" on public.flashcard_media_assets;
create policy "flashcard_media_assets_select_own"
on public.flashcard_media_assets
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "flashcard_media_storage_select_own" on storage.objects;
create policy "flashcard_media_storage_select_own"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'flashcard-media'
  and owner_id = (select auth.uid()::text)
);

drop policy if exists "flashcard_media_storage_insert_authenticated" on storage.objects;
create policy "flashcard_media_storage_insert_authenticated"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'flashcard-media'
  and (storage.foldername(name))[1] = 'media'
);

drop policy if exists "flashcard_media_storage_delete_own" on storage.objects;
create policy "flashcard_media_storage_delete_own"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'flashcard-media'
  and owner_id = (select auth.uid()::text)
);

create or replace function public.ensure_flashcard_media_quota_row(p_bucket_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.flashcard_media_quota (bucket_id)
  values (p_bucket_id)
  on conflict (bucket_id) do nothing;
end;
$$;

create or replace function public.prune_expired_flashcard_media_reservations(
  p_bucket_id text default 'flashcard-media'
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_released_bytes bigint := 0;
begin
  with expired as (
    delete from public.flashcard_media_upload_reservations as reservation
    where reservation.bucket_id = p_bucket_id
      and reservation.status = 'pending'
      and reservation.expires_at <= timezone('utc', now())
    returning reservation.bytes
  )
  select coalesce(sum(expired.bytes), 0)
  into v_released_bytes
  from expired;

  if v_released_bytes > 0 then
    update public.flashcard_media_quota as quota
    set
      reserved_bytes = greatest(quota.reserved_bytes - v_released_bytes, 0),
      updated_at = timezone('utc', now())
    where quota.bucket_id = p_bucket_id;
  end if;

  return v_released_bytes;
end;
$$;

create or replace function public.get_flashcard_media_quota_status(
  p_bucket_id text default 'flashcard-media'
)
returns table (
  bucket_id text,
  used_bytes bigint,
  reserved_bytes bigint,
  hard_limit_bytes bigint,
  available_bytes bigint,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.ensure_flashcard_media_quota_row(p_bucket_id);
  perform public.prune_expired_flashcard_media_reservations(p_bucket_id);

  return query
  select
    q.bucket_id,
    q.used_bytes,
    q.reserved_bytes,
    q.hard_limit_bytes,
    greatest(q.hard_limit_bytes - q.used_bytes - q.reserved_bytes, 0) as available_bytes,
    q.updated_at
  from public.flashcard_media_quota q
  where q.bucket_id = p_bucket_id;
end;
$$;

create or replace function public.reserve_flashcard_media_upload(
  p_bucket_id text default 'flashcard-media',
  p_object_path text default null,
  p_bytes bigint default null
)
returns table (
  allowed boolean,
  reservation_id uuid,
  used_bytes bigint,
  reserved_bytes bigint,
  projected_bytes bigint,
  hard_limit_bytes bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_quota public.flashcard_media_quota%rowtype;
  v_reservation_id uuid;
  v_projected_bytes bigint;
begin
  if v_user_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if coalesce(trim(p_object_path), '') = '' or p_object_path not like 'media/%' then
    raise exception 'Object path must start with media/.' using errcode = '22023';
  end if;

  if p_bytes is null or p_bytes <= 0 then
    raise exception 'Upload size must be greater than zero.' using errcode = '22023';
  end if;

  perform public.ensure_flashcard_media_quota_row(p_bucket_id);
  perform public.prune_expired_flashcard_media_reservations(p_bucket_id);

  select *
  into v_quota
  from public.flashcard_media_quota as quota
  where quota.bucket_id = p_bucket_id
  for update;

  v_projected_bytes := v_quota.used_bytes + v_quota.reserved_bytes + p_bytes;

  if v_projected_bytes > v_quota.hard_limit_bytes then
    return query
    select
      false,
      null::uuid,
      v_quota.used_bytes,
      v_quota.reserved_bytes,
      v_projected_bytes,
      v_quota.hard_limit_bytes;
    return;
  end if;

  insert into public.flashcard_media_upload_reservations as reservation (
    user_id,
    bucket_id,
    object_path,
    bytes
  )
  values (
    v_user_id,
    p_bucket_id,
    p_object_path,
    p_bytes
  )
  returning reservation.reservation_id
  into v_reservation_id;

  update public.flashcard_media_quota as quota
  set
    reserved_bytes = quota.reserved_bytes + p_bytes,
    updated_at = timezone('utc', now())
  where quota.bucket_id = p_bucket_id
  returning *
  into v_quota;

  return query
  select
    true,
    v_reservation_id,
    v_quota.used_bytes,
    v_quota.reserved_bytes,
    v_quota.used_bytes + v_quota.reserved_bytes,
    v_quota.hard_limit_bytes;
end;
$$;

create or replace function public.finalize_flashcard_media_upload(
  p_reservation_id uuid,
  p_public_url text,
  p_mime_type text,
  p_size_bytes bigint default null
)
returns table (
  bucket_id text,
  object_path text,
  public_url text,
  size_bytes bigint,
  used_bytes bigint,
  reserved_bytes bigint,
  hard_limit_bytes bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_reservation public.flashcard_media_upload_reservations%rowtype;
  v_quota public.flashcard_media_quota%rowtype;
  v_final_size bigint;
  v_projected_bytes bigint;
begin
  if v_user_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  select *
  into v_reservation
  from public.flashcard_media_upload_reservations as reservation
  where reservation.reservation_id = p_reservation_id
    and reservation.user_id = v_user_id
  for update;

  if not found then
    raise exception 'Upload reservation not found.' using errcode = 'P0002';
  end if;

  if v_reservation.status <> 'pending' then
    raise exception 'Upload reservation is no longer pending.' using errcode = 'P0001';
  end if;

  if v_reservation.expires_at <= timezone('utc', now()) then
    update public.flashcard_media_upload_reservations as reservation
    set status = 'cancelled'
    where reservation.reservation_id = v_reservation.reservation_id;

    update public.flashcard_media_quota as quota
    set
      reserved_bytes = greatest(quota.reserved_bytes - v_reservation.bytes, 0),
      updated_at = timezone('utc', now())
    where quota.bucket_id = v_reservation.bucket_id;

    raise exception 'Upload reservation expired.' using errcode = 'P0001';
  end if;

  if coalesce(trim(p_public_url), '') = '' then
    raise exception 'Public URL is required.' using errcode = '22023';
  end if;

  if coalesce(trim(p_mime_type), '') = '' then
    raise exception 'MIME type is required.' using errcode = '22023';
  end if;

  v_final_size := coalesce(p_size_bytes, v_reservation.bytes);
  if v_final_size <= 0 then
    raise exception 'Final upload size must be greater than zero.' using errcode = '22023';
  end if;

  select *
  into v_quota
  from public.flashcard_media_quota as quota
  where quota.bucket_id = v_reservation.bucket_id
  for update;

  v_projected_bytes := v_quota.used_bytes + greatest(v_quota.reserved_bytes - v_reservation.bytes, 0) + v_final_size;
  if v_projected_bytes > v_quota.hard_limit_bytes then
    raise exception 'Storage limit exceeded while finalizing upload.' using errcode = 'P0001';
  end if;

  insert into public.flashcard_media_assets (
    object_path,
    user_id,
    bucket_id,
    public_url,
    mime_type,
    size_bytes
  )
  values (
    v_reservation.object_path,
    v_user_id,
    v_reservation.bucket_id,
    p_public_url,
    p_mime_type,
    v_final_size
  )
  on conflict on constraint flashcard_media_assets_pkey do update
  set
    user_id = excluded.user_id,
    public_url = excluded.public_url,
    mime_type = excluded.mime_type,
    size_bytes = excluded.size_bytes;

  update public.flashcard_media_upload_reservations as reservation
  set
    status = 'uploaded',
    finalized_at = timezone('utc', now())
  where reservation.reservation_id = v_reservation.reservation_id;

  update public.flashcard_media_quota as quota
  set
    used_bytes = quota.used_bytes + v_final_size,
    reserved_bytes = greatest(quota.reserved_bytes - v_reservation.bytes, 0),
    updated_at = timezone('utc', now())
  where quota.bucket_id = v_reservation.bucket_id
  returning *
  into v_quota;

  return query
  select
    v_reservation.bucket_id,
    v_reservation.object_path,
    p_public_url,
    v_final_size,
    v_quota.used_bytes,
    v_quota.reserved_bytes,
    v_quota.hard_limit_bytes;
end;
$$;

create or replace function public.abort_flashcard_media_upload(
  p_reservation_id uuid
)
returns table (
  bucket_id text,
  used_bytes bigint,
  reserved_bytes bigint,
  hard_limit_bytes bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_reservation public.flashcard_media_upload_reservations%rowtype;
  v_quota public.flashcard_media_quota%rowtype;
begin
  if v_user_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  select *
  into v_reservation
  from public.flashcard_media_upload_reservations as reservation
  where reservation.reservation_id = p_reservation_id
    and reservation.user_id = v_user_id
  for update;

  if not found then
    return;
  end if;

  if v_reservation.status = 'pending' then
    update public.flashcard_media_upload_reservations as reservation
    set status = 'cancelled'
    where reservation.reservation_id = v_reservation.reservation_id;

    update public.flashcard_media_quota as quota
    set
      reserved_bytes = greatest(quota.reserved_bytes - v_reservation.bytes, 0),
      updated_at = timezone('utc', now())
    where quota.bucket_id = v_reservation.bucket_id
    returning *
    into v_quota;

    return query
    select
      v_reservation.bucket_id,
      v_quota.used_bytes,
      v_quota.reserved_bytes,
      v_quota.hard_limit_bytes;
    return;
  end if;

  select *
  into v_quota
  from public.flashcard_media_quota as quota
  where quota.bucket_id = v_reservation.bucket_id;

  return query
  select
    v_reservation.bucket_id,
    coalesce(v_quota.used_bytes, 0),
    coalesce(v_quota.reserved_bytes, 0),
    coalesce(v_quota.hard_limit_bytes, 419430400);
end;
$$;

create or replace function public.release_flashcard_media_asset(
  p_object_path text
)
returns table (
  bucket_id text,
  used_bytes bigint,
  reserved_bytes bigint,
  hard_limit_bytes bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_asset public.flashcard_media_assets%rowtype;
  v_quota public.flashcard_media_quota%rowtype;
begin
  if v_user_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  select *
  into v_asset
  from public.flashcard_media_assets as asset
  where asset.object_path = p_object_path
    and asset.user_id = v_user_id
  for update;

  if not found then
    raise exception 'Media asset not found.' using errcode = 'P0002';
  end if;

  delete from public.flashcard_media_assets as asset
  where asset.object_path = v_asset.object_path;

  update public.flashcard_media_quota as quota
  set
    used_bytes = greatest(quota.used_bytes - v_asset.size_bytes, 0),
    updated_at = timezone('utc', now())
  where quota.bucket_id = v_asset.bucket_id
  returning *
  into v_quota;

  return query
  select
    v_asset.bucket_id,
    v_quota.used_bytes,
    v_quota.reserved_bytes,
    v_quota.hard_limit_bytes;
end;
$$;

create or replace function public.reconcile_flashcard_media_quota(
  p_bucket_id text default 'flashcard-media'
)
returns table (
  bucket_id text,
  used_bytes bigint,
  reserved_bytes bigint,
  hard_limit_bytes bigint,
  object_count bigint
)
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  v_used_bytes bigint := 0;
  v_object_count bigint := 0;
  v_quota public.flashcard_media_quota%rowtype;
begin
  perform public.ensure_flashcard_media_quota_row(p_bucket_id);

  delete from public.flashcard_media_upload_reservations as reservation
  where reservation.bucket_id = p_bucket_id
    and reservation.status = 'pending';

  select
    coalesce(sum(coalesce((o.metadata ->> 'size')::bigint, 0)), 0),
    count(*)
  into
    v_used_bytes,
    v_object_count
  from storage.objects o
  where o.bucket_id = p_bucket_id;

  delete from public.flashcard_media_assets a
  where a.bucket_id = p_bucket_id
    and not exists (
      select 1
      from storage.objects o
      where o.bucket_id = a.bucket_id
        and o.name = a.object_path
    );

  update public.flashcard_media_assets a
  set size_bytes = coalesce(
    (
      select (o.metadata ->> 'size')::bigint
      from storage.objects o
      where o.bucket_id = a.bucket_id
        and o.name = a.object_path
    ),
    a.size_bytes
  )
  where a.bucket_id = p_bucket_id;

  update public.flashcard_media_quota as quota
  set
    used_bytes = v_used_bytes,
    reserved_bytes = 0,
    updated_at = timezone('utc', now())
  where quota.bucket_id = p_bucket_id
  returning *
  into v_quota;

  return query
  select
    p_bucket_id,
    v_quota.used_bytes,
    v_quota.reserved_bytes,
    v_quota.hard_limit_bytes,
    v_object_count;
end;
$$;

revoke all on function public.ensure_flashcard_media_quota_row(text) from public, anon, authenticated;
revoke all on function public.prune_expired_flashcard_media_reservations(text) from public, anon, authenticated;

grant execute on function public.get_flashcard_media_quota_status(text) to authenticated;
grant execute on function public.reserve_flashcard_media_upload(text, text, bigint) to authenticated;
grant execute on function public.finalize_flashcard_media_upload(uuid, text, text, bigint) to authenticated;
grant execute on function public.abort_flashcard_media_upload(uuid) to authenticated;
grant execute on function public.release_flashcard_media_asset(text) to authenticated;
grant execute on function public.reconcile_flashcard_media_quota(text) to authenticated;

commit;
