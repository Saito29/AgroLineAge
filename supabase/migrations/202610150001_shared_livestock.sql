-- Shared AgroLineage data. Parentage is biological; transfers track ownership separately.
create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  contact text,
  created_at timestamptz not null default now()
);

create table public.organizations (
  id text primary key,
  name text not null,
  color text not null default '#8a8f8c',
  location text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.owners (
  id text primary key,
  name text not null,
  organization_id text references public.organizations(id) on delete restrict,
  farm text not null default '', phone text not null default '',
  location text not null default '', notes text not null default '',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table public.animals (
  id text primary key,
  tag text not null, species text not null, breed text not null default '',
  sex text not null default '' check (sex in ('', 'F', 'M')),
  born date, status text not null default 'Alive' check (status in ('Alive', 'Sold', 'Deceased')),
  owner_id text not null references public.owners(id) on delete restrict,
  parent_id text references public.animals(id) on delete set null,
  parent_owner_id text references public.owners(id) on delete set null,
  insured text not null default 'No' check (insured in ('', 'No', 'Yes')),
  insurer text not null default '', ins_other text not null default '', policy text not null default '',
  coverage_start date, coverage_end date, notes text not null default '',
  revision bigint not null default 1,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (parent_id is null or parent_id <> id),
  check (coverage_start is null or coverage_end is null or coverage_end >= coverage_start)
);
create index animals_owner_idx on public.animals(owner_id);
create index animals_parent_idx on public.animals(parent_id);
create unique index animals_tag_owner_idx on public.animals(owner_id, lower(tag));

create table public.activities (
  id text primary key, animal_id text not null references public.animals(id) on delete restrict,
  date date not null, type text not null default 'Other', title text not null default '',
  notes text not null default '', performed_by text not null default '',
  cost numeric check (cost is null or cost >= 0), next_due date,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index activities_animal_date_idx on public.activities(animal_id, date desc);

create table public.ownership_transfers (
  id uuid primary key default gen_random_uuid(),
  animal_id text not null references public.animals(id) on delete restrict,
  previous_owner_id text not null references public.owners(id) on delete restrict,
  new_owner_id text not null references public.owners(id) on delete restrict,
  transferred_at date not null, reference text not null default '', notes text not null default '',
  initiated_by uuid not null references auth.users(id), request_id text not null,
  created_at timestamptz not null default now(),
  unique (initiated_by, request_id), check (previous_owner_id <> new_owner_id)
);
create index transfers_animal_date_idx on public.ownership_transfers(animal_id, transferred_at, created_at);

create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  animal_id text references public.animals(id) on delete restrict,
  activity_id text references public.activities(id) on delete restrict,
  object_path text not null unique, original_name text not null, content_type text not null,
  size_bytes bigint not null check (size_bytes >= 0), uploaded_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  check ((animal_id is not null) <> (activity_id is not null))
);

create table public.audit_events (
  id bigint generated always as identity primary key,
  actor_id uuid not null references auth.users(id), record_type text not null,
  record_id text not null, action text not null, details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index audit_events_created_idx on public.audit_events(created_at desc);

-- Immediate transfer, guarded by a row lock, expected-owner check and idempotency key.
create function public.transfer_animal(
  p_animal_id text, p_expected_owner_id text, p_new_owner_id text,
  p_transferred_at date, p_reference text, p_notes text, p_request_id text
) returns public.animals
language plpgsql security definer set search_path = public, pg_temp
as $$
declare a public.animals; t public.ownership_transfers;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_request_id is null or length(p_request_id) < 8 or length(p_request_id) > 100 then raise exception 'Invalid request ID' using errcode = '22023'; end if;
  select * into t from public.ownership_transfers where initiated_by = auth.uid() and request_id = p_request_id;
  if found then
    if t.animal_id <> p_animal_id or t.new_owner_id <> p_new_owner_id then raise exception 'Request ID already used' using errcode = '22023'; end if;
    select * into a from public.animals where id = p_animal_id;
    return a;
  end if;
  select * into a from public.animals where id = p_animal_id for update;
  if not found then raise exception 'Animal not found' using errcode = 'P0002'; end if;
  if a.owner_id <> p_expected_owner_id then raise exception 'Owner changed; reload before transferring' using errcode = '40001'; end if;
  if p_new_owner_id = p_expected_owner_id then raise exception 'New owner must differ from current owner' using errcode = '22023'; end if;
  if p_transferred_at is null or (a.born is not null and p_transferred_at < a.born) then raise exception 'Invalid transfer date' using errcode = '22023'; end if;
  if p_transferred_at < (select max(transferred_at) from public.ownership_transfers where animal_id = p_animal_id) then raise exception 'Transfer date precedes the latest recorded transfer' using errcode = '22023'; end if;
  if not exists (select 1 from public.owners where id = p_new_owner_id) then raise exception 'New owner not found' using errcode = '23503'; end if;
  insert into public.ownership_transfers(animal_id, previous_owner_id, new_owner_id, transferred_at, reference, notes, initiated_by, request_id)
  values (p_animal_id, p_expected_owner_id, p_new_owner_id, p_transferred_at, coalesce(p_reference,''), coalesce(p_notes,''), auth.uid(), p_request_id)
  on conflict (initiated_by, request_id) do nothing returning * into t;
  if t.id is null then
    select * into t from public.ownership_transfers where initiated_by = auth.uid() and request_id = p_request_id;
    if t.animal_id <> p_animal_id or t.new_owner_id <> p_new_owner_id then raise exception 'Request ID already used' using errcode = '22023'; end if;
    return a;
  end if;
  update public.animals set owner_id = p_new_owner_id, revision = revision + 1, updated_at = now()
    where id = p_animal_id returning * into a;
  insert into public.audit_events(actor_id, record_type, record_id, action, details)
    values (auth.uid(), 'animal', p_animal_id, 'ownership_transferred', jsonb_build_object('transfer_id',t.id,'from',p_expected_owner_id,'to',p_new_owner_id,'date',p_transferred_at));
  return a;
end $$;

alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.owners enable row level security;
alter table public.animals enable row level security;
alter table public.activities enable row level security;
alter table public.ownership_transfers enable row level security;
alter table public.attachments enable row level security;
alter table public.audit_events enable row level security;

do $$ declare t text; begin
  foreach t in array array['organizations','owners','animals','activities','attachments'] loop
    execute format('create policy %I on public.%I for select to authenticated using (true)', t||'_auth_read', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (true)', t||'_auth_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (true) with check (true)', t||'_auth_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using (true)', t||'_auth_delete', t);
  end loop;
end $$;
create policy profiles_self_read on public.profiles for select to authenticated using (id = auth.uid());
create policy profiles_self_insert on public.profiles for insert to authenticated with check (id = auth.uid());
create policy profiles_self_update on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy transfers_auth_read on public.ownership_transfers for select to authenticated using (true);
create policy transfers_no_direct_insert on public.ownership_transfers for insert to authenticated with check (false);
create policy transfers_immutable_update on public.ownership_transfers for update to authenticated using (false);
create policy transfers_immutable_delete on public.ownership_transfers for delete to authenticated using (false);
create policy audit_auth_read on public.audit_events for select to authenticated using (true);
create policy audit_no_insert on public.audit_events for insert to authenticated with check (false);
create policy audit_no_update on public.audit_events for update to authenticated using (false);
create policy audit_no_delete on public.audit_events for delete to authenticated using (false);

grant select, insert, update, delete on public.organizations, public.owners, public.animals, public.activities, public.attachments to authenticated;
grant select on public.ownership_transfers to authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select on public.audit_events to authenticated;
grant execute on function public.transfer_animal(text,text,text,date,text,text,text) to authenticated;
