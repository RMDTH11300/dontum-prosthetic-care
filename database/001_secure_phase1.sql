-- DT Prosthetic Care phase 1: secure foundational schema.
-- Apply to a NEW, dedicated Supabase project after hospital IT/security approval.
-- Never run against the hospital's existing production database without review.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists public.staff_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('staff','admin')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.prosthetic_requests (
  id uuid primary key default gen_random_uuid(),
  patient_user_id uuid not null references auth.users(id),
  full_name text not null check (length(trim(full_name)) between 2 and 200),
  phone text not null check (length(trim(phone)) between 8 and 30),
  service text not null check (service in ('new','replace','repair')),
  level text not null check (level in ('BK','TK','AK','HIP','SYME')),
  side text not null check (side in ('left','right','both')),
  amputation_date date,
  province text,
  assessment jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending','review','needs-info','scheduled','completed','cancelled')),
  appointment_at timestamptz,
  staff_note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint appointment_required_when_scheduled check (status <> 'scheduled' or appointment_at is not null)
);

create table if not exists public.prosthetic_followups (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.prosthetic_requests(id) on delete cascade,
  patient_user_id uuid not null references auth.users(id),
  skin text not null check (skin in ('none','red','wound')),
  pain smallint not null check (pain between 0 and 10),
  socket_fit text not null check (socket_fit in ('good','tight','loose','unsure')),
  walking text not null check (walking in ('assisted','device','independent','unknown')),
  fall_occurred boolean not null default false,
  details text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists requests_owner_created_idx on public.prosthetic_requests (patient_user_id, created_at desc);
create index if not exists requests_status_created_idx on public.prosthetic_requests (status, created_at desc);
create index if not exists requests_appointment_idx on public.prosthetic_requests (appointment_at) where appointment_at is not null;
create index if not exists followups_request_created_idx on public.prosthetic_followups (request_id, created_at desc);

-- Staff membership is provisioned only by authorized database administrators.
-- The helper is in an unexposed schema, has an explicit search path and cannot mutate data.
create or replace function private.is_active_staff()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.staff_members s
    where s.user_id = (select auth.uid()) and s.active
  );
$$;
revoke all on function private.is_active_staff() from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.is_active_staff() to authenticated;

alter table public.staff_members enable row level security;
alter table public.prosthetic_requests enable row level security;
alter table public.prosthetic_followups enable row level security;

create policy staff_read_self on public.staff_members
for select to authenticated using (user_id = (select auth.uid()));

create policy request_patient_read on public.prosthetic_requests
for select to authenticated using (patient_user_id = (select auth.uid()));
create policy request_staff_read on public.prosthetic_requests
for select to authenticated using (private.is_active_staff());
create policy request_patient_insert on public.prosthetic_requests
for insert to authenticated with check (
  patient_user_id = (select auth.uid())
  and status = 'pending' and appointment_at is null and staff_note = ''
);
create policy request_staff_update on public.prosthetic_requests
for update to authenticated using (private.is_active_staff())
with check (private.is_active_staff());

create policy followup_patient_read on public.prosthetic_followups
for select to authenticated using (patient_user_id = (select auth.uid()));
create policy followup_staff_read on public.prosthetic_followups
for select to authenticated using (private.is_active_staff());
create policy followup_patient_insert on public.prosthetic_followups
for insert to authenticated with check (
  patient_user_id = (select auth.uid()) and exists (
    select 1 from public.prosthetic_requests r
    where r.id = request_id and r.patient_user_id = (select auth.uid())
      and r.status = 'completed'
  )
);

-- Only expose the minimum table capabilities. RLS still applies.
revoke all on public.staff_members, public.prosthetic_requests, public.prosthetic_followups from anon, authenticated;
grant select on public.staff_members to authenticated;
grant select, insert on public.prosthetic_requests to authenticated;
grant update (status, appointment_at, staff_note, updated_at) on public.prosthetic_requests to authenticated;
grant select, insert on public.prosthetic_followups to authenticated;

-- Private photo bucket. Do not create public URLs for patient photographs.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('residual-limb-private','residual-limb-private',false,5242880,array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public=false, file_size_limit=5242880,
  allowed_mime_types=array['image/jpeg','image/png','image/webp'];

-- Object keys: <authenticated-user-uuid>/<request-uuid>/<view>.jpg
create policy residual_photo_owner_upload on storage.objects
for insert to authenticated with check (
  bucket_id='residual-limb-private'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);
create policy residual_photo_owner_read on storage.objects
for select to authenticated using (
  bucket_id='residual-limb-private'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);
create policy residual_photo_staff_read on storage.objects
for select to authenticated using (
  bucket_id='residual-limb-private'
  and private.is_active_staff()
);

-- AFTER reviewing access controls and testing with demo accounts, a database administrator
-- may approve staff access using the actual auth.users UUID. Never expose this command in a browser.
-- insert into public.staff_members(user_id,role) values ('REPLACE-WITH-AUTH-USER-UUID','staff');
