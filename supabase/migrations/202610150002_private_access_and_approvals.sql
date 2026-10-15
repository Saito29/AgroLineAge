-- Authentication alone is insufficient: every protected row requires approval.
alter table public.profiles
  add column email text not null default '',
  add column approval_status text not null default 'pending' check (approval_status in ('pending','approved','rejected','suspended')),
  add column app_role text not null default 'user' check (app_role in ('user','admin')),
  add column is_initial_admin boolean not null default false,
  add column status_reason text,
  add column status_changed_at timestamptz not null default now(),
  add column status_changed_by uuid references auth.users(id);

create or replace function public.is_approved()
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$ select exists (select 1 from public.profiles where id = auth.uid() and approval_status = 'approved') $$;
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$ select exists (select 1 from public.profiles where id = auth.uid() and approval_status = 'approved' and app_role = 'admin') $$;
revoke all on function public.is_approved() from public, anon;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_approved(), public.is_admin() to authenticated;

-- Auth signup always starts as an ordinary pending user.
create or replace function public.on_auth_user_created()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  insert into public.profiles(id,email,display_name,approval_status,app_role)
  values (new.id,coalesce(new.email,''),left(coalesce(new.raw_user_meta_data->>'display_name',''),120),'pending','user')
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.on_auth_user_created();

-- A browser may read its own profile, but cannot write status, role or identity fields.
drop policy if exists profiles_self_insert on public.profiles;
drop policy if exists profiles_self_update on public.profiles;
drop policy if exists profiles_self_read on public.profiles;
create policy profiles_private_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());
revoke insert,update,delete on public.profiles from anon,authenticated;
grant select on public.profiles to authenticated;

-- Replace every broad authenticated policy from the shared-data foundation.
do $$ declare t text; p text; begin
  foreach t in array array['organizations','owners','animals','activities','attachments'] loop
    foreach p in array array['auth_read','auth_insert','auth_update','auth_delete'] loop
      execute format('drop policy if exists %I on public.%I',t||'_'||p,t);
    end loop;
    execute format('create policy %I on public.%I for select to authenticated using (public.is_approved())',t||'_approved_read',t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.is_approved())',t||'_approved_insert',t);
    execute format('create policy %I on public.%I for update to authenticated using (public.is_approved()) with check (public.is_approved())',t||'_approved_update',t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.is_approved())',t||'_approved_delete',t);
  end loop;
end $$;
drop policy if exists transfers_auth_read on public.ownership_transfers;
create policy transfers_approved_read on public.ownership_transfers for select to authenticated using (public.is_approved());
drop policy if exists audit_auth_read on public.audit_events;
create policy audit_approved_read on public.audit_events for select to authenticated
  using (public.is_approved() and (record_type <> 'user' or public.is_admin()));

-- One private shared bucket. Object policies check the same approval row as SQL data.
insert into storage.buckets(id,name,public,file_size_limit)
values ('animal-attachments','animal-attachments',false,104857600)
on conflict (id) do update set public = false;
create policy approved_attachment_read on storage.objects for select to authenticated
  using (bucket_id='animal-attachments' and public.is_approved());
create policy approved_attachment_insert on storage.objects for insert to authenticated
  with check (bucket_id='animal-attachments' and public.is_approved());
create policy approved_attachment_update on storage.objects for update to authenticated
  using (bucket_id='animal-attachments' and public.is_approved()) with check (bucket_id='animal-attachments' and public.is_approved());
create policy approved_attachment_delete on storage.objects for delete to authenticated
  using (bucket_id='animal-attachments' and public.is_approved());

create or replace function public.admin_set_user_status(p_user_id uuid,p_status text,p_reason text default null)
returns public.profiles language plpgsql security definer set search_path = public, pg_temp
as $$
declare p public.profiles; old_status text; action_name text;
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Administrator access required' using errcode='42501'; end if;
  if p_status not in ('approved','rejected','suspended') then raise exception 'Invalid status' using errcode='22023'; end if;
  if p_user_id=auth.uid() then raise exception 'Cannot change your own status' using errcode='22023'; end if;
  select * into p from public.profiles where id=p_user_id for update;
  if not found then raise exception 'User profile not found' using errcode='P0002'; end if;
  old_status:=p.approval_status;
  if not ((old_status='pending' and p_status in ('approved','rejected')) or
          (old_status='rejected' and p_status='approved') or
          (old_status='approved' and p_status='suspended') or
          (old_status='suspended' and p_status='approved')) then
    raise exception 'Status transition % -> % is not allowed',old_status,p_status using errcode='22023';
  end if;
  update public.profiles set approval_status=p_status,status_reason=left(p_reason,1000),
    status_changed_at=now(),status_changed_by=auth.uid() where id=p_user_id returning * into p;
  action_name:=case p_status when 'approved' then 'account_approved' when 'rejected' then 'account_rejected' else 'account_suspended' end;
  insert into public.audit_events(actor_id,record_type,record_id,action,details)
    values(auth.uid(),'user',p_user_id::text,action_name,jsonb_build_object('from',old_status,'to',p_status,'reason',left(coalesce(p_reason,''),1000)));
  return p;
end $$;
revoke all on function public.admin_set_user_status(uuid,text,text) from public,anon;
grant execute on function public.admin_set_user_status(uuid,text,text) to authenticated;

-- No client-callable bootstrap: the initial administrator is set only by a trusted operator script.
create or replace function public.transfer_animal(
  p_animal_id text,p_expected_owner_id text,p_new_owner_id text,
  p_transferred_at date,p_reference text,p_notes text,p_request_id text
) returns public.animals language plpgsql security definer set search_path = public, pg_temp
as $$
declare a public.animals; t public.ownership_transfers;
begin
  if auth.uid() is null or not public.is_approved() then raise exception 'Approved account required' using errcode='42501'; end if;
  if p_request_id is null or length(p_request_id)<8 or length(p_request_id)>100 then raise exception 'Invalid request ID' using errcode='22023'; end if;
  select * into t from public.ownership_transfers where initiated_by=auth.uid() and request_id=p_request_id;
  if found then
    if t.animal_id<>p_animal_id or t.new_owner_id<>p_new_owner_id then raise exception 'Request ID already used' using errcode='22023'; end if;
    select * into a from public.animals where id=p_animal_id; return a;
  end if;
  select * into a from public.animals where id=p_animal_id for update;
  if not found then raise exception 'Animal not found' using errcode='P0002'; end if;
  if a.owner_id<>p_expected_owner_id then raise exception 'Owner changed; reload before transferring' using errcode='40001'; end if;
  if p_new_owner_id=p_expected_owner_id then raise exception 'New owner must differ' using errcode='22023'; end if;
  if not exists(select 1 from public.owners where id=p_new_owner_id) then raise exception 'New owner not found' using errcode='23503'; end if;
  if p_transferred_at is null or (a.born is not null and p_transferred_at<a.born) or
    p_transferred_at<(select max(transferred_at) from public.ownership_transfers where animal_id=p_animal_id) then
    raise exception 'Invalid transfer date' using errcode='22023';
  end if;
  insert into public.ownership_transfers(animal_id,previous_owner_id,new_owner_id,transferred_at,reference,notes,initiated_by,request_id)
    values(p_animal_id,p_expected_owner_id,p_new_owner_id,p_transferred_at,coalesce(p_reference,''),coalesce(p_notes,''),auth.uid(),p_request_id);
  update public.animals set owner_id=p_new_owner_id,revision=revision+1,updated_at=now()
    where id=p_animal_id returning * into a;
  insert into public.audit_events(actor_id,record_type,record_id,action,details)
    values(auth.uid(),'animal',p_animal_id,'ownership_transferred',jsonb_build_object('from',p_expected_owner_id,'to',p_new_owner_id,'date',p_transferred_at));
  return a;
end $$;
revoke all on function public.transfer_animal(text,text,text,date,text,text,text) from public,anon;
grant execute on function public.transfer_animal(text,text,text,date,text,text,text) to authenticated;

