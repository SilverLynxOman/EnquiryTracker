-- Phase 5: merge duplicate agents, and standard port names.
-- Agents get the same tools as customers (20261104215109_customer_merge): a list with counts, merge, rename and
-- "not the same". The duplicate finder runs in the app (src/lib/customerDuplicates.ts).
-- Ports stay free text on each enquiry (pol, pod), but a port can now have a standard name with remembered variant
-- spellings: merging rewrites the enquiries, and a trigger writes the standard name whenever a known spelling is
-- typed or imported again.

-------------------------------------------------------------------------------
-- History of agent and port merges (customers keep their own customer_merges)
-------------------------------------------------------------------------------

create table public.master_merges (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('agent', 'port')),
  kept_name text not null,
  -- [{id?, name, enquiries}] of what was merged away.
  merged jsonb not null,
  enquiries_moved integer not null,
  merged_by uuid default auth.uid(),
  merged_at timestamptz not null default now()
);

alter table public.master_merges enable row level security;
create policy "master_merges: staff read" on public.master_merges
  for select to authenticated using ((select public.app_role()) is not null);
revoke all on public.master_merges from anon;

-------------------------------------------------------------------------------
-- Agents: list with counts
-------------------------------------------------------------------------------

create view public.agent_summary
with (security_invoker = true)
as
select
  a.id,
  a.name,
  a.notes,
  a.created_at,
  coalesce(e.enquiries, 0)::integer as enquiries,
  coalesce(e.confirmed, 0)::integer as confirmed,
  e.last_enquiry,
  coalesce(al.aliases, '{}') as aliases
from public.agents a
left join (
  select agent_id, count(*) as enquiries, count(*) filter (where status = 'confirmed') as confirmed,
         max(enquiry_date) as last_enquiry
    from public.enquiries
   where agent_id is not null
   group by agent_id
) e on e.agent_id = a.id
left join (
  select agent_id, array_agg(alias_key order by alias_key) as aliases from public.agent_aliases group by agent_id
) al on al.agent_id = a.id;

revoke all on public.agent_summary from anon;
grant select on public.agent_summary to authenticated;

-------------------------------------------------------------------------------
-- Agents: pairs that look alike but are different companies
-------------------------------------------------------------------------------

create table public.agent_not_duplicates (
  agent_a uuid not null references public.agents (id) on delete cascade,
  agent_b uuid not null references public.agents (id) on delete cascade,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (agent_a, agent_b),
  check (agent_a < agent_b)
);
create index agent_not_duplicates_b_idx on public.agent_not_duplicates (agent_b);

alter table public.agent_not_duplicates enable row level security;
create policy "agent_not_duplicates: staff read" on public.agent_not_duplicates
  for select to authenticated using ((select public.app_role()) is not null);
create policy "agent_not_duplicates: editor insert" on public.agent_not_duplicates
  for insert to authenticated with check ((select public.can_edit()));
create policy "agent_not_duplicates: editor delete" on public.agent_not_duplicates
  for delete to authenticated using ((select public.can_edit()));
revoke all on public.agent_not_duplicates from anon;

-------------------------------------------------------------------------------
-- Agents: rename (the old name is remembered) and merge
-------------------------------------------------------------------------------

create or replace function public.rename_agent(p_id uuid, p_name text)
returns public.agents
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := nullif(upper(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'))), '');
  v_key text := public.name_key(p_name);
  v_old public.agents;
  v_other text;
  v_row public.agents;
begin
  if not public.can_edit() then
    raise exception 'Only editors can rename agents' using errcode = '42501';
  end if;
  if v_key is null then
    raise exception 'Enter the agent name';
  end if;

  select * into v_old from public.agents where id = p_id for update;
  if not found then
    raise exception 'This agent no longer exists. Refresh and try again.';
  end if;

  if v_key is distinct from v_old.name_key then
    select name into v_other from public.agents where name_key = v_key and id <> p_id;
    if found then
      raise exception 'An agent called % already exists. Merge the two instead.', v_other;
    end if;
    select ag.name into v_other
      from public.agent_aliases a
      join public.agents ag on ag.id = a.agent_id
     where a.alias_key = v_key and a.agent_id <> p_id;
    if found then
      raise exception '% is already a former name of %. Merge the two instead.', v_name, v_other;
    end if;
    delete from public.agent_aliases where alias_key = v_key;
    insert into public.agent_aliases (alias_key, agent_id)
    values (v_old.name_key, p_id)
    on conflict (alias_key) do nothing;
  end if;

  update public.agents set name = v_name where id = p_id returning * into v_row;
  return v_row;
end;
$$;

-- Moves the enquiries and former names of p_merge onto p_keep, remembers the merged names as former names of
-- p_keep, deletes the merged agents and records the merge. Optionally renames p_keep.
create or replace function public.merge_agents(p_keep uuid, p_merge uuid[], p_name text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_merge uuid[];
  v_found integer;
  v_keep public.agents;
  v_final_name text;
  v_merged jsonb;
  v_moved uuid[];
  v_importable uuid[];
begin
  if not public.is_admin() then
    raise exception 'Only admins can merge agents' using errcode = '42501';
  end if;

  select coalesce(array_agg(distinct m), '{}') into v_merge
    from unnest(p_merge) m
   where m is not null and m is distinct from p_keep;
  if p_keep is null or cardinality(v_merge) = 0 then
    raise exception 'Choose the agent to keep and at least one agent to merge into it';
  end if;

  perform 1 from public.agents where id = p_keep or id = any (v_merge) order by id for update;
  get diagnostics v_found = row_count;
  if v_found <> cardinality(v_merge) + 1 then
    raise exception 'One of these agents was changed or merged by someone else. Refresh and try again.';
  end if;
  select * into v_keep from public.agents where id = p_keep;

  select jsonb_agg(jsonb_build_object(
           'id', a.id, 'name', a.name,
           'enquiries', (select count(*) from public.enquiries e where e.agent_id = a.id)
         ) order by a.name)
    into v_merged
    from public.agents a
   where a.id = any (v_merge);

  -- Moving enquiries is not an app edit of the agent column: imports map the merged names to p_keep.
  select coalesce(array_agg(id), '{}'),
         coalesce(array_agg(id) filter (where not ('agent_id' = any (app_edited_fields))), '{}')
    into v_moved, v_importable
    from public.enquiries
   where agent_id = any (v_merge);

  update public.enquiries set agent_id = p_keep where id = any (v_moved);
  update public.enquiries
     set app_edited_fields = array_remove(app_edited_fields, 'agent_id')
   where id = any (v_importable);

  v_final_name := coalesce(nullif(upper(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'))), ''), v_keep.name);
  update public.enquiry_audit au
     set changes = (au.changes - 'agent_id')
                   || jsonb_build_object('agent', jsonb_build_object('old', m.name, 'new', v_final_name, 'merged', true))
    from public.agents m
   where au.enquiry_id = any (v_moved)
     and au.action = 'update'
     and au.changed_at = now()
     and au.changes ? 'agent_id'
     and m.id = (au.changes -> 'agent_id' ->> 'old')::uuid;

  update public.agent_aliases set agent_id = p_keep where agent_id = any (v_merge);
  insert into public.agent_aliases (alias_key, agent_id)
  select name_key, p_keep from public.agents where id = any (v_merge)
  on conflict (alias_key) do update set agent_id = excluded.agent_id;

  delete from public.agents where id = any (v_merge);

  if v_final_name is distinct from v_keep.name then
    perform public.rename_agent(p_keep, v_final_name);
  end if;

  insert into public.master_merges (kind, kept_name, merged, enquiries_moved)
  values ('agent', v_final_name, v_merged, cardinality(v_moved));

  return jsonb_build_object('name', v_final_name, 'merged', cardinality(v_merge), 'enquiries', cardinality(v_moved));
end;
$$;

create or replace function public.mark_agents_distinct(p_ids uuid[])
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_count integer;
begin
  if not public.can_edit() then
    raise exception 'Only editors can do this' using errcode = '42501';
  end if;
  insert into public.agent_not_duplicates (agent_a, agent_b)
  select a.id, b.id
    from (select distinct unnest(p_ids) as id) a
    join (select distinct unnest(p_ids) as id) b on a.id < b.id
  on conflict do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-------------------------------------------------------------------------------
-- Ports: standard names and remembered spellings
-------------------------------------------------------------------------------

create table public.ports (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  name_key text generated always as (public.name_key(name)) stored,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
create unique index ports_name_key_idx on public.ports (name_key);

comment on table public.ports is 'Standard port names. Enquiries keep pol / pod as text; known spellings are rewritten to these names.';

create table public.port_aliases (
  alias_key text primary key,
  port_id uuid not null references public.ports (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index port_aliases_port_idx on public.port_aliases (port_id);

-- Port spellings that look alike but are different places (name keys, key_a < key_b).
create table public.port_not_duplicates (
  key_a text not null,
  key_b text not null,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (key_a, key_b),
  check (key_a < key_b)
);

alter table public.ports enable row level security;
alter table public.port_aliases enable row level security;
alter table public.port_not_duplicates enable row level security;
-- Ports and spellings change only through merge_ports (admins).
create policy "ports: staff read" on public.ports
  for select to authenticated using ((select public.app_role()) is not null);
create policy "port_aliases: staff read" on public.port_aliases
  for select to authenticated using ((select public.app_role()) is not null);
create policy "port_not_duplicates: staff read" on public.port_not_duplicates
  for select to authenticated using ((select public.app_role()) is not null);
create policy "port_not_duplicates: editor insert" on public.port_not_duplicates
  for insert to authenticated with check ((select public.can_edit()));
create policy "port_not_duplicates: editor delete" on public.port_not_duplicates
  for delete to authenticated using ((select public.can_edit()));
revoke all on public.ports, public.port_aliases, public.port_not_duplicates from anon;

-- The standard spelling of a port name: through a remembered spelling, or a standard name that differs only in
-- punctuation. Anything else is returned unchanged.
create or replace function public.standard_port_name(p text)
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (select pt.name from public.port_aliases a join public.ports pt on pt.id = a.port_id where a.alias_key = public.name_key(p)),
    (select pt.name from public.ports pt where pt.name_key = public.name_key(p)),
    p
  )
$$;

-- Runs before enquiries_before_write (triggers fire in name order), so a known spelling never counts as a change.
create or replace function public.enquiries_apply_port_names()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.pol is not null then
    new.pol := public.standard_port_name(new.pol);
  end if;
  if new.pod is not null then
    new.pod := public.standard_port_name(new.pod);
  end if;
  return new;
end;
$$;

create trigger enquiries_apply_port_names
  before insert or update of pol, pod on public.enquiries
  for each row execute function public.enquiries_apply_port_names();

-- Every spelling used as POL or POD, by name key, with counts. id is the name key.
create view public.port_summary
with (security_invoker = true)
as
with uses as (
  select e.id, e.status, e.enquiry_date, public.name_key(e.pol) as key, e.pol as name, true as as_pol
    from public.enquiries e where e.pol is not null
  union all
  select e.id, e.status, e.enquiry_date, public.name_key(e.pod), e.pod, false
    from public.enquiries e where e.pod is not null
)
select
  u.key as id,
  mode() within group (order by u.name) as name,
  count(distinct u.id)::integer as enquiries,
  (count(distinct u.id) filter (where u.status = 'confirmed'))::integer as confirmed,
  max(u.enquiry_date) as last_enquiry,
  (count(*) filter (where u.as_pol))::integer as as_pol,
  (count(*) filter (where not u.as_pol))::integer as as_pod,
  (p.id is not null) as standard,
  coalesce(a.aliases, '{}') as aliases
from uses u
left join public.ports p on p.name_key = u.key
left join (
  select port_id, array_agg(alias_key order by alias_key) as aliases from public.port_aliases group by port_id
) a on a.port_id = p.id
where u.key is not null
group by u.key, p.id, a.aliases;

revoke all on public.port_summary from anon;
grant select on public.port_summary to authenticated;

-- Merges port spellings (name keys) into one standard name: remembers each spelling, rewrites POL / POD on the
-- enquiries and records the merge. With one key it renames that port. Rewriting a port is not an app edit, so
-- imports can still update those fields (they now arrive with the standard name).
create or replace function public.merge_ports(p_keys text[], p_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := nullif(upper(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'))), '');
  v_key text := public.name_key(p_name);
  v_keys text[];
  v_port uuid;
  v_merged jsonb;
  v_pol_importable uuid[];
  v_pod_importable uuid[];
  v_moved integer;
  v_merged_away integer;
begin
  if not public.is_admin() then
    raise exception 'Only admins can merge ports' using errcode = '42501';
  end if;
  if v_key is null then
    raise exception 'Enter the port name';
  end if;
  select coalesce(array_agg(distinct k), '{}') into v_keys
    from unnest(p_keys) k
   where nullif(btrim(k), '') is not null;
  if cardinality(v_keys) = 0 then
    raise exception 'Choose at least one port';
  end if;

  -- One port merge at a time.
  perform pg_advisory_xact_lock(hashtext('public.merge_ports'));

  select jsonb_agg(jsonb_build_object('name', s.name, 'enquiries', s.enquiries) order by s.name)
    into v_merged
    from public.port_summary s
   where s.id = any (v_keys);

  insert into public.ports (name) values (v_name)
  on conflict (name_key) do update set name = excluded.name
  returning id into v_port;

  -- Standard ports among the merged spellings fold into this one, with their remembered spellings.
  update public.port_aliases set port_id = v_port
   where port_id in (select id from public.ports where name_key = any (v_keys) and id <> v_port);
  delete from public.ports where name_key = any (v_keys) and id <> v_port;

  insert into public.port_aliases (alias_key, port_id)
  select k, v_port from unnest(v_keys) k where k <> v_key
  on conflict (alias_key) do update set port_id = excluded.port_id;
  delete from public.port_aliases where alias_key = v_key;

  v_merged_away := (select count(*) from unnest(v_keys) k where k <> v_key);
  v_keys := v_keys || v_key;
  select coalesce(array_agg(id) filter (where public.name_key(pol) = any (v_keys) and pol is distinct from v_name
                                          and not ('pol' = any (app_edited_fields))), '{}'),
         coalesce(array_agg(id) filter (where public.name_key(pod) = any (v_keys) and pod is distinct from v_name
                                          and not ('pod' = any (app_edited_fields))), '{}')
    into v_pol_importable, v_pod_importable
    from public.enquiries
   where public.name_key(pol) = any (v_keys) or public.name_key(pod) = any (v_keys);

  update public.enquiries
     set pol = case when public.name_key(pol) = any (v_keys) then v_name else pol end,
         pod = case when public.name_key(pod) = any (v_keys) then v_name else pod end
   where (public.name_key(pol) = any (v_keys) and pol is distinct from v_name)
      or (public.name_key(pod) = any (v_keys) and pod is distinct from v_name);
  get diagnostics v_moved = row_count;

  update public.enquiries set app_edited_fields = array_remove(app_edited_fields, 'pol') where id = any (v_pol_importable);
  update public.enquiries set app_edited_fields = array_remove(app_edited_fields, 'pod') where id = any (v_pod_importable);

  insert into public.master_merges (kind, kept_name, merged, enquiries_moved)
  values ('port', v_name, coalesce(v_merged, '[]'), v_moved);

  return jsonb_build_object('name', v_name, 'merged', v_merged_away, 'enquiries', v_moved);
end;
$$;

create or replace function public.mark_ports_distinct(p_keys text[])
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_count integer;
begin
  if not public.can_edit() then
    raise exception 'Only editors can do this' using errcode = '42501';
  end if;
  insert into public.port_not_duplicates (key_a, key_b)
  select a.k, b.k
    from (select distinct unnest(p_keys) as k) a
    join (select distinct unnest(p_keys) as k) b on a.k < b.k
  on conflict do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-------------------------------------------------------------------------------
-- Function privileges
-------------------------------------------------------------------------------

revoke execute on function
  public.rename_agent(uuid, text),
  public.merge_agents(uuid, uuid[], text),
  public.mark_agents_distinct(uuid[]),
  public.standard_port_name(text),
  public.enquiries_apply_port_names(),
  public.merge_ports(text[], text),
  public.mark_ports_distinct(text[])
from public, anon;
grant execute on function
  public.rename_agent(uuid, text),
  public.merge_agents(uuid, uuid[], text),
  public.mark_agents_distinct(uuid[]),
  public.standard_port_name(text),
  public.merge_ports(text[], text),
  public.mark_ports_distinct(text[])
to authenticated;
