-- Trusted one-time setup only. Run in Supabase SQL Editor as the project database owner.
-- First verify the intended, email-confirmed Auth user ID from Authentication > Users.
-- Replace the UUID below with that exact auth.users.id. Do not use an email lookup here.
do $$
declare
  v_admin_id uuid := '00000000-0000-0000-0000-000000000000';
begin
  if v_admin_id = '00000000-0000-0000-0000-000000000000'::uuid then
    raise exception 'Set the verified Auth user UUID before running this script';
  end if;
  if not exists (select 1 from auth.users where id=v_admin_id and email_confirmed_at is not null) then
    raise exception 'The specified ID is not an email-confirmed Supabase Auth user';
  end if;
  if exists (select 1 from public.profiles where is_initial_admin) then
    raise exception 'Initial administrator is already configured; use the documented recovery process';
  end if;
  insert into public.profiles(id,email,display_name,approval_status,app_role,is_initial_admin,status_changed_at,status_changed_by)
    select id,coalesce(email,''),left(coalesce(raw_user_meta_data->>'display_name',''),120),
      'approved','admin',true,now(),id
    from auth.users where id=v_admin_id
  on conflict (id) do update set approval_status='approved',app_role='admin',is_initial_admin=true,
    status_reason=null,status_changed_at=now(),status_changed_by=v_admin_id;
  insert into public.audit_events(actor_id,record_type,record_id,action,details)
    values(v_admin_id,'user',v_admin_id::text,'initial_admin_bootstrapped',jsonb_build_object('method','trusted database setup'));
end $$;
