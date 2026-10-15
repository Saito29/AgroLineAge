-- Enable live change events for the shared AgroLineage records.
-- Safe to run more than once if the publication or some tables already exist.
do $$
declare
  v_table text;
begin
  if not exists (select 1 from pg_publication where pubname='supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach v_table in array array['organizations','owners','animals','activities','attachments','ownership_transfers'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname='supabase_realtime' and schemaname='public' and tablename=v_table
    ) then
      execute format('alter publication supabase_realtime add table public.%I',v_table);
    end if;
  end loop;
end $$;