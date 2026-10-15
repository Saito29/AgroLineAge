-- Add the transfer history table to Realtime for projects that already ran migration 004.
do $$
begin
  if not exists (select 1 from pg_publication where pubname='supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='ownership_transfers'
  ) then
    alter publication supabase_realtime add table public.ownership_transfers;
  end if;
end $$;