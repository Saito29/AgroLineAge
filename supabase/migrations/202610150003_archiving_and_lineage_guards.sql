-- Preserve shared history when records are removed from an app view.
alter table public.organizations add column archived_at timestamptz;
alter table public.owners add column archived_at timestamptz;
alter table public.animals add column archived_at timestamptz;
alter table public.activities add column archived_at timestamptz;
alter table public.attachments add column archived_at timestamptz;

create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = public, pg_temp
as $$ begin new.updated_at=now(); return new; end $$;
create trigger organizations_touch before update on public.organizations for each row execute function public.touch_updated_at();
create trigger owners_touch before update on public.owners for each row execute function public.touch_updated_at();
create trigger activities_touch before update on public.activities for each row execute function public.touch_updated_at();

create or replace function public.bump_animal_revision()
returns trigger language plpgsql set search_path = public, pg_temp
as $$ begin new.revision=old.revision+1; new.updated_at=now(); return new; end $$;
create trigger animals_bump_revision before update on public.animals for each row execute function public.bump_animal_revision();

create or replace function public.prevent_invalid_lineage()
returns trigger language plpgsql set search_path = public, pg_temp
as $$
declare parent_birth date; has_cycle boolean;
begin
  if new.parent_id is null then return new; end if;
  if new.parent_id=new.id then raise exception 'An animal cannot be its own parent' using errcode='23514'; end if;
  select born into parent_birth from public.animals where id=new.parent_id and archived_at is null;
  if not found then raise exception 'Parent animal does not exist or is archived' using errcode='23503'; end if;
  if parent_birth is not null and new.born is not null and new.born<parent_birth then
    raise exception 'Animal cannot be born before its parent' using errcode='23514';
  end if;
  with recursive ancestors(id,parent_id) as (
    select id,parent_id from public.animals where id=new.parent_id
    union all select a.id,a.parent_id from public.animals a join ancestors x on a.id=x.parent_id
  ) select exists(select 1 from ancestors where id=new.id) into has_cycle;
  if has_cycle then raise exception 'Parentage would create a lineage cycle' using errcode='23514'; end if;
  return new;
end $$;
create trigger animals_validate_lineage before insert or update of parent_id,born on public.animals
for each row execute function public.prevent_invalid_lineage();
