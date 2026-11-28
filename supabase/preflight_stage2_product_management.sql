-- READ-ONLY Stage 2 Supabase preflight.
-- Run this one statement in Supabase SQL Editor. It returns one row per check,
-- with an overall_status repeated on each row for easy sharing.
-- Every executable query below is SELECT-only; no schema or row is changed.

with
expected_columns(table_name, column_name, data_type, udt_name, char_length, numeric_precision, numeric_scale, stage2_addition) as (
  values
    ('products','id','bigint','int8',null::integer,null::integer,null::integer,false),
    ('products','supplier','character varying','varchar',40,null::integer,null::integer,false),
    ('products','supplier_product_id','text','text',null::integer,null::integer,null::integer,false),
    ('products','slug','text','text',null::integer,null::integer,null::integer,false),
    ('products','name','text','text',null::integer,null::integer,null::integer,false),
    ('products','description','text','text',null::integer,null::integer,null::integer,false),
    ('products','detail_description','text','text',null::integer,null::integer,null::integer,false),
    ('products','price','numeric','numeric',null::integer,10,2,false),
    ('products','currency','character','bpchar',3,null::integer,null::integer,false),
    ('products','image_url','text','text',null::integer,null::integer,null::integer,false),
    ('products','gallery_urls','ARRAY','_text',null::integer,null::integer,null::integer,false),
    ('products','collection_ids','ARRAY','_text',null::integer,null::integer,null::integer,true),
    ('products','stock_quantity','integer','int4',null::integer,null::integer,null::integer,false),
    ('products','is_active','boolean','bool',null::integer,null::integer,null::integer,false),
    ('products','updated_at','timestamp with time zone','timestamptz',null::integer,null::integer,null::integer,false),
    ('product_recommendations','id','uuid','uuid',null::integer,null::integer,null::integer,false),
    ('product_recommendations','cj_product_id','text','text',null::integer,null::integer,null::integer,false),
    ('product_recommendations','title','text','text',null::integer,null::integer,null::integer,false),
    ('product_recommendations','description','text','text',null::integer,null::integer,null::integer,false),
    ('product_recommendations','image_url','text','text',null::integer,null::integer,null::integer,false),
    ('product_recommendations','gallery','jsonb','jsonb',null::integer,null::integer,null::integer,false),
    ('product_recommendations','supplier_data','jsonb','jsonb',null::integer,null::integer,null::integer,false),
    ('product_recommendations','inventory','integer','int4',null::integer,null::integer,null::integer,false),
    ('product_recommendations','status','text','text',null::integer,null::integer,null::integer,false),
    ('product_recommendations','reviewer_id','uuid','uuid',null::integer,null::integer,null::integer,false),
    ('product_recommendations','review_notes','text','text',null::integer,null::integer,null::integer,false),
    ('product_recommendations','reviewed_at','timestamp with time zone','timestamptz',null::integer,null::integer,null::integer,false),
    ('product_recommendations','updated_at','timestamp with time zone','timestamptz',null::integer,null::integer,null::integer,false),
    ('product_recommendations','published_product_id','bigint','int8',null::integer,null::integer,null::integer,true),
    ('product_recommendations','published_at','timestamp with time zone','timestamptz',null::integer,null::integer,null::integer,true)
),
expected_tables(table_name) as (values ('products'), ('product_recommendations')),
table_state as (
  select e.table_name, c.oid as table_oid, c.relrowsecurity as rls_enabled
  from expected_tables e
  left join pg_catalog.pg_namespace n on n.nspname = 'public'
  left join pg_catalog.pg_class c on c.relnamespace = n.oid and c.relname = e.table_name and c.relkind in ('r','p')
),
column_checks as (
  select
    'Columns and types'::text as category,
    e.table_name || '.' || e.column_name as check_name,
    case
      when t.table_oid is null then 'BLOCKED'
      when a.column_name is null and e.stage2_addition then 'PASS'
      when a.column_name is null then 'BLOCKED'
      when a.data_type is distinct from e.data_type
        or a.udt_name is distinct from e.udt_name
        or a.character_maximum_length is distinct from e.char_length
        or (e.data_type in ('numeric','decimal') and (
          a.numeric_precision is distinct from e.numeric_precision
          or a.numeric_scale is distinct from e.numeric_scale
        )) then 'BLOCKED'
      else 'PASS'
    end as status,
    case
      when t.table_oid is null then 'Required table is missing.'
      when a.column_name is null and e.stage2_addition then 'Not present yet; Stage 2 is expected to add this column.'
      when a.column_name is null then 'Required existing column is missing.'
      else 'Expected ' || e.data_type || ' (' || e.udt_name || ')' ||
        case when e.char_length is not null then ', length ' || e.char_length else '' end ||
        case when e.numeric_precision is not null then ', precision ' || e.numeric_precision || ', scale ' || e.numeric_scale else '' end ||
        '; found ' || a.data_type || ' (' || a.udt_name || ')' ||
        case when a.character_maximum_length is not null then ', length ' || a.character_maximum_length else '' end ||
        case when a.numeric_precision is not null then ', precision ' || a.numeric_precision || ', scale ' || a.numeric_scale else '' end || '.'
    end as details
  from expected_columns e
  join table_state t on t.table_name = e.table_name
  left join information_schema.columns a
    on a.table_schema = 'public' and a.table_name = e.table_name and a.column_name = e.column_name
),
table_checks as (
  select 'Tables'::text as category, table_name as check_name,
    case when table_oid is null then 'BLOCKED' else 'PASS' end as status,
    case when table_oid is null then 'Missing public.' || table_name || '.' else 'Found public.' || table_name || '.' end as details
  from table_state
),
expected_keys(table_name, column_name, key_kind) as (
  values
    ('products','id','PRIMARY KEY'),
    ('products','slug','UNIQUE'),
    ('products','supplier_product_id','UNIQUE'),
    ('product_recommendations','id','PRIMARY KEY'),
    ('product_recommendations','cj_product_id','UNIQUE')
),
key_checks as (
  select 'Required keys'::text as category, k.table_name || '.' || k.column_name || ' ' || k.key_kind as check_name,
    case when t.table_oid is null then 'BLOCKED'
      when exists (
        select 1 from pg_catalog.pg_index i
        join pg_catalog.pg_attribute a on a.attrelid = i.indrelid and a.attname = k.column_name and not a.attisdropped
        where i.indrelid = t.table_oid and i.indisvalid
          and ((k.key_kind = 'PRIMARY KEY' and i.indisprimary)
            or (k.key_kind = 'UNIQUE' and i.indisunique and not i.indisprimary and i.indpred is null))
          and i.indnkeyatts = 1 and pg_catalog.pg_get_indexdef(i.indexrelid, 1, true) = k.column_name
      ) then 'PASS' else 'BLOCKED' end as status,
    case when t.table_oid is null then 'Table is missing.'
      when exists (
        select 1 from pg_catalog.pg_index i
        join pg_catalog.pg_attribute a on a.attrelid = i.indrelid and a.attname = k.column_name and not a.attisdropped
        where i.indrelid = t.table_oid and i.indisvalid
          and ((k.key_kind = 'PRIMARY KEY' and i.indisprimary)
            or (k.key_kind = 'UNIQUE' and i.indisunique and not i.indisprimary and i.indpred is null))
          and i.indnkeyatts = 1 and pg_catalog.pg_get_indexdef(i.indexrelid, 1, true) = k.column_name
      ) then 'Matching valid key index exists.' else 'Required valid key/unique index is missing; duplicate-safe publishing may fail.' end as details
  from expected_keys k join table_state t on t.table_name = k.table_name
),
published_column as (
  select t.table_oid,
    exists (select 1 from pg_catalog.pg_attribute a where a.attrelid = t.table_oid and a.attname = 'published_product_id' and not a.attisdropped) as column_exists,
    exists (select 1 from information_schema.columns c where c.table_schema='public' and c.table_name='product_recommendations'
      and c.column_name='published_product_id' and c.data_type='bigint' and c.udt_name='int8') as expected_type
  from table_state t where t.table_name = 'product_recommendations'
),
duplicate_probe as (
  select table_oid, column_exists, expected_type
  from published_column
),
duplicate_counts as (
  -- Reading the row as JSON avoids referring to a column that Stage 2 may add.
  -- This is a normal SELECT and remains valid before published_product_id exists.
  select count(*)::bigint as duplicate_groups
  from (
    select pg_catalog.to_jsonb(r)->>'published_product_id' as published_product_id
    from public.product_recommendations r
    where pg_catalog.to_jsonb(r)->>'published_product_id' is not null
    group by pg_catalog.to_jsonb(r)->>'published_product_id'
    having count(*) > 1
  ) duplicates
),
duplicate_checks as (
  select 'Duplicate links'::text as category, 'product_recommendations.published_product_id'::text as check_name,
    case
      when table_oid is null then 'BLOCKED'
      when not column_exists then 'PASS'
      when not expected_type then 'WARNING'
      when duplicate_groups > 0 then 'BLOCKED'
      else 'PASS'
    end as status,
    case when table_oid is null then 'Recommendations table is missing.'
      when not column_exists then 'Column is not present yet, so no duplicate links can exist.'
      when not expected_type then 'Column has an unexpected type; duplicate scan skipped. The column type check is BLOCKED.'
      else 'Duplicate published_product_id groups: ' || duplicate_groups::text || '.'
    end as details
  from duplicate_probe cross join duplicate_counts
),
published_fk_checks as (
  select 'Foreign keys'::text as category, 'product_recommendations.published_product_id -> products.id ON DELETE SET NULL'::text as check_name,
    case when r.table_oid is null or p.table_oid is null then 'BLOCKED'
      when not exists (select 1 from pg_catalog.pg_attribute a where a.attrelid = r.table_oid and a.attname = 'published_product_id' and not a.attisdropped) then 'PASS'
      when exists (
        select 1 from pg_catalog.pg_constraint c
        join pg_catalog.pg_attribute ra on ra.attrelid = r.table_oid and ra.attname = 'published_product_id' and not ra.attisdropped
        join pg_catalog.pg_attribute pa on pa.attrelid = p.table_oid and pa.attname = 'id' and not pa.attisdropped
        where c.conrelid = r.table_oid and c.confrelid = p.table_oid and c.contype = 'f' and c.convalidated
          and c.confdeltype = 'n' and c.conkey = array[ra.attnum]::smallint[] and c.confkey = array[pa.attnum]::smallint[]
      ) then 'PASS' else 'BLOCKED' end as status,
    case when r.table_oid is null or p.table_oid is null then 'One or both required tables are missing.'
      when not exists (select 1 from pg_catalog.pg_attribute a where a.attrelid = r.table_oid and a.attname = 'published_product_id' and not a.attisdropped) then 'Column is absent; Stage 2 adds it with the expected foreign key.'
      else 'If present, this column must reference products.id with ON DELETE SET NULL.' end as details
  from table_state r cross join table_state p
  where r.table_name = 'product_recommendations' and p.table_name = 'products'
),
published_index_check as (
  select c.oid as object_oid, c.relkind, c.indexrelid, c.indrelid, c.indisunique, c.indisvalid, c.indisready,
    c.indnkeyatts, c.indnatts, c.indpred,
    pg_catalog.pg_get_indexdef(c.indexrelid, 1, true) as first_key,
    pg_catalog.pg_get_expr(c.indpred, c.indrelid) as predicate,
    t.table_oid as recommendations_oid
  from (select c.oid, c.relkind, i.indexrelid, i.indrelid, i.indisunique, i.indisvalid, i.indisready, i.indnkeyatts, i.indnatts, i.indpred
        from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
        left join pg_catalog.pg_index i on i.indexrelid = c.oid
        where n.nspname = 'public' and c.relname = 'product_recommendations_published_product_uidx') c
  right join (select table_oid from table_state where table_name = 'product_recommendations') t on true
),
published_index_checks as (
  select 'Indexes'::text as category, 'product_recommendations_published_product_uidx'::text as check_name,
    case when recommendations_oid is null then 'BLOCKED'
      when object_oid is null then 'PASS'
      when relkind = 'i' and indrelid = recommendations_oid and indisunique and indisvalid and indisready
        and indnkeyatts = 1 and indnatts = 1 and first_key = 'published_product_id'
        and regexp_replace(lower(coalesce(predicate,'')), '[()[:space:]]', '', 'g') = 'published_product_idisnotnull' then 'PASS'
      else 'BLOCKED' end as status,
    case when recommendations_oid is null then 'Recommendations table is missing.'
      when object_oid is null then 'Name is available; Stage 2 will add the expected partial unique index.'
      when relkind = 'i' then 'Existing index definition: ' || coalesce(pg_catalog.pg_get_indexdef(indexrelid), 'unavailable')
      else 'An object with this name already exists in public but is not the expected index.' end as details
  from published_index_check
),
constraint_inventory as (
  select string_agg(r.relname || '.' || c.conname || ': ' || pg_catalog.pg_get_constraintdef(c.oid, true), '; ' order by r.relname, c.conname) as details
  from pg_catalog.pg_constraint c
  join pg_catalog.pg_class r on r.oid = c.conrelid
  join pg_catalog.pg_namespace n on n.oid = r.relnamespace
  where n.nspname = 'public' and r.relname in ('products','product_recommendations')
),
index_inventory as (
  select string_agg(tablename || '.' || indexname || ': ' || indexdef, '; ' order by tablename, indexname) as details
  from pg_catalog.pg_indexes where schemaname = 'public' and tablename in ('products','product_recommendations')
),
inventory_checks as (
  select 'Existing objects'::text as category, 'Constraints on affected tables'::text as check_name, 'PASS'::text as status,
    coalesce(details, 'No constraints found or tables are not visible.') as details from constraint_inventory
  union all
  select 'Existing objects', 'Indexes on affected tables', 'PASS', coalesce(details, 'No indexes found or tables are not visible.') from index_inventory
),
trigger_inventory as (
  select string_agg(r.relname || '.' || t.tgname || ': ' || pg_catalog.pg_get_triggerdef(t.oid, true) ||
    ' [function=' || p.proname || '(' || pg_catalog.pg_get_function_identity_arguments(p.oid) || '), owner=' || pg_catalog.pg_get_userbyid(p.proowner) ||
    ', security_definer=' || p.prosecdef::text || ', search_path=' || coalesce(p.proconfig::text,'unset') || ']', '; ' order by r.relname, t.tgname) as details,
    count(*) filter (where t.tgname = 'stage2_prevent_rejected_recommendation_activation' and r.relname = 'products') as stage2_name_count,
    count(*) filter (where p.proname = 'prevent_rejected_recommendation_activation' and r.relname = 'products') as guard_function_count
  from pg_catalog.pg_trigger t
  join pg_catalog.pg_class r on r.oid = t.tgrelid
  join pg_catalog.pg_namespace n on n.oid = r.relnamespace
  join pg_catalog.pg_proc p on p.oid = t.tgfoid
  where n.nspname = 'public' and r.relname in ('products','product_recommendations') and not t.tgisinternal
),
trigger_checks as (
  select 'Triggers'::text as category, 'Current triggers on affected tables'::text as check_name, 'PASS'::text as status,
    coalesce(details, 'No non-internal triggers found.') as details from trigger_inventory
  union all
  select 'Triggers', 'Named trigger replacement check',
    case when stage2_name_count > 0 and guard_function_count = 0 then 'BLOCKED' else 'PASS' end,
    case when stage2_name_count > 0 and guard_function_count = 0 then 'The new Stage 2 trigger name is occupied by a different function; the guard cannot be attached with this name.'
      when guard_function_count > 0 then 'A products trigger already calls the Stage 2 guard function; migration will preserve and reuse it.'
      else 'Existing triggers are preserved; Stage 2 adds its separately named trigger.' end
  from trigger_inventory
),
expected_functions(function_name, argument_types, return_oid) as (
  values
    ('prevent_rejected_recommendation_activation', '', 'trigger'::regtype::oid),
    ('review_product_recommendation', 'uuid, text, uuid, text', 'jsonb'::regtype::oid),
    ('publish_product_recommendation', 'uuid, text, numeric, text[]', 'jsonb'::regtype::oid)
),
function_matches as (
  select e.function_name, e.argument_types, e.return_oid, p.oid as function_oid,
    pg_catalog.pg_get_function_identity_arguments(p.oid) as actual_identity_arguments,
    pg_catalog.oidvectortypes(p.proargtypes) as actual_argument_types,
    p.proowner, p.prosecdef, p.proconfig, p.proacl, p.prorettype, p.prokind,
    (lower(btrim(pg_catalog.oidvectortypes(p.proargtypes))) = lower(e.argument_types)) as exact_signature,
    (p.prorettype = e.return_oid and p.prokind = 'f') as exact_return_and_kind,
    pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
    pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute,
    pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role_execute
  from expected_functions e
  left join pg_catalog.pg_namespace n on n.nspname = 'public'
  left join pg_catalog.pg_proc p on p.pronamespace = n.oid and p.proname = e.function_name
),
function_inventory as (
  select string_agg(function_name || ': expected identity arguments (' || argument_types ||
    ') returns ' || pg_catalog.format_type(return_oid,null) || '; existing identity arguments (' || actual_identity_arguments ||
    '); existing argument types (' || actual_argument_types || '); existing return type (' || pg_catalog.format_type(prorettype,null) ||
    '); kind=' || prokind::text || '; owner=' || pg_catalog.pg_get_userbyid(proowner) ||
    '; security_definer=' || prosecdef::text || '; search_path=' || coalesce(proconfig::text,'unset') ||
    '; grants=' || coalesce(proacl::text,'default') || '; effective EXECUTE anon=' || anon_execute::text ||
    ', authenticated=' || authenticated_execute::text || ', service_role=' || service_role_execute::text,
    '; ' order by function_name, actual_argument_types) as details
  from function_matches where function_oid is not null
),
function_name_checks as (
  select e.function_name, count(m.function_oid) as name_count,
    count(m.function_oid) filter (where m.exact_signature) as exact_count,
    count(m.function_oid) filter (where not m.exact_signature) as overload_count,
    bool_and(m.exact_return_and_kind) filter (where m.exact_signature) as return_and_kind_ok,
    bool_and(m.prosecdef and coalesce(m.proconfig @> array['search_path=pg_catalog, public, pg_temp']::text[],false))
      filter (where m.exact_signature) as secure_definer_settings_ok,
    bool_or(m.proowner = (select oid from pg_catalog.pg_roles where rolname = current_user))
      filter (where m.exact_signature) as owned_by_current_user,
    (select rolsuper from pg_catalog.pg_roles where rolname = current_user) as current_user_superuser
  from expected_functions e left join function_matches m using (function_name)
  group by e.function_name
),
function_checks as (
  select 'Functions'::text as category, function_name || ' exact signature' as check_name,
    case when overload_count > 0 then 'BLOCKED'
      when exact_count = 0 then 'PASS'
      when not coalesce(return_and_kind_ok,false) then 'BLOCKED'
      when not coalesce(owned_by_current_user,false) and not coalesce(current_user_superuser,false) then 'BLOCKED'
      when not coalesce(secure_definer_settings_ok,false) then 'WARNING'
      else 'WARNING' end as status,
    case when overload_count > 0 then 'Same-name function(s) with unexpected signatures exist; inspect the function inventory for possible overload conflicts.'
      when exact_count = 0 then 'No exact-signature function exists; Stage 2 should add it.'
      when not coalesce(return_and_kind_ok,false) then 'Existing exact-argument function has an incompatible return type or object kind and cannot be safely replaced in place.'
      when not coalesce(owned_by_current_user,false) and not coalesce(current_user_superuser,false) then 'Exact function exists but current SQL role does not own it; Stage 2 may not be able to change it.'
      when not coalesce(secure_definer_settings_ok,false) then 'Existing function lacks the expected security attributes; Stage 2 would set them if permitted.'
      else 'Exact function exists and can be replaced by the current role; review its current definition/ACL shown in the inventory.' end as details
  from function_name_checks
  union all
  select 'Functions', 'Current matching-name function details', 'PASS', coalesce(details, 'No matching functions currently exist.') from function_inventory
),
function_permission_checks as (
  select 'Function permissions'::text as category, e.function_name as check_name,
    case when count(m.function_oid) filter (where m.exact_signature) = 0 then 'PASS'
      when bool_or(m.anon_execute or m.authenticated_execute) filter (where m.exact_signature) then 'WARNING'
      when e.function_name <> 'prevent_rejected_recommendation_activation'
        and not bool_or(m.service_role_execute) filter (where m.exact_signature) then 'WARNING'
      else 'PASS' end as status,
    case when count(m.function_oid) filter (where m.exact_signature) = 0 then 'Function is absent; Stage 2 will add it with private permissions.'
      else 'Current anon/authenticated/service_role EXECUTE values are in the function inventory. Stage 2 sets private-client access and service_role RPC permissions.' end as details
  from expected_functions e left join function_matches m using (function_name)
  group by e.function_name
),
role_checks as (
  select 'Permissions and RLS'::text as category, expected.role_name || ' database role' as check_name,
    case when exists (select 1 from pg_catalog.pg_roles r where r.rolname = expected.role_name) then 'PASS' else 'BLOCKED' end as status,
    case when exists (select 1 from pg_catalog.pg_roles r where r.rolname = expected.role_name) then 'Role exists.' else 'Required Supabase role is missing.' end as details
  from (values ('anon'),('authenticated'),('service_role')) expected(role_name)
),
rls_checks as (
  select 'Permissions and RLS'::text as category, 'products RLS and active-product public read policy' as check_name,
    case when t.table_oid is null then 'BLOCKED'
      when not coalesce(t.rls_enabled,false) then 'BLOCKED'
      when not exists (
        select 1 from pg_catalog.pg_policies p where p.schemaname='public' and p.tablename='products' and p.cmd='SELECT'
          and p.roles::text[] @> array['anon','authenticated']::text[]
          and regexp_replace(lower(coalesce(p.qual,'')), '[()[:space:]]', '', 'g') like '%is_active=true%'
      ) then 'BLOCKED' else 'PASS' end as status,
    'Expected RLS plus SELECT policy for anon/authenticated constrained to is_active = true.' as details
  from table_state t where t.table_name='products'
  union all
  select 'Permissions and RLS', 'product_recommendations private RLS and grants',
    case when t.table_oid is null then 'BLOCKED'
      when not coalesce(t.rls_enabled,false) then 'BLOCKED'
      when exists (select 1 from pg_catalog.pg_policies p where p.schemaname='public' and p.tablename='product_recommendations'
        and p.roles::text[] && array['public','anon','authenticated']::text[]) then 'BLOCKED'
      when pg_catalog.has_table_privilege('anon',t.table_oid,'SELECT') or pg_catalog.has_table_privilege('anon',t.table_oid,'INSERT')
        or pg_catalog.has_table_privilege('anon',t.table_oid,'UPDATE') or pg_catalog.has_table_privilege('anon',t.table_oid,'DELETE')
        or pg_catalog.has_table_privilege('authenticated',t.table_oid,'SELECT') or pg_catalog.has_table_privilege('authenticated',t.table_oid,'INSERT')
        or pg_catalog.has_table_privilege('authenticated',t.table_oid,'UPDATE') or pg_catalog.has_table_privilege('authenticated',t.table_oid,'DELETE') then 'BLOCKED'
      when not (pg_catalog.has_table_privilege('service_role',t.table_oid,'SELECT') and pg_catalog.has_table_privilege('service_role',t.table_oid,'INSERT')
        and pg_catalog.has_table_privilege('service_role',t.table_oid,'UPDATE') and pg_catalog.has_table_privilege('service_role',t.table_oid,'DELETE')) then 'BLOCKED'
      else 'PASS' end,
    'Expected RLS enabled, no policy or table privileges for public/anon/authenticated, and backend service_role table access.'
  from table_state t where t.table_name='product_recommendations'
  union all
  select 'Permissions and RLS', 'products public table privileges',
    case when t.table_oid is null then 'BLOCKED'
      when not (pg_catalog.has_table_privilege('anon',t.table_oid,'SELECT') and pg_catalog.has_table_privilege('authenticated',t.table_oid,'SELECT')) then 'BLOCKED'
      when pg_catalog.has_table_privilege('anon',t.table_oid,'INSERT') or pg_catalog.has_table_privilege('anon',t.table_oid,'UPDATE') or pg_catalog.has_table_privilege('anon',t.table_oid,'DELETE')
        or pg_catalog.has_table_privilege('authenticated',t.table_oid,'INSERT') or pg_catalog.has_table_privilege('authenticated',t.table_oid,'UPDATE') or pg_catalog.has_table_privilege('authenticated',t.table_oid,'DELETE') then 'WARNING'
      else 'PASS' end,
    'Expected public SELECT only; RLS should limit rows to active products.'
  from table_state t where t.table_name='products'
),
table_policy_inventory as (
  select string_agg(p.tablename || '.' || p.policyname || ': roles=' || p.roles::text || ', command=' || p.cmd ||
    ', using=' || coalesce(p.qual,'') || ', check=' || coalesce(p.with_check,''), '; ' order by p.tablename,p.policyname) as details
  from pg_catalog.pg_policies p where p.schemaname='public' and p.tablename in ('products','product_recommendations')
),
policy_inventory_checks as (
  select 'Permissions and RLS'::text as category, 'Current policies on affected tables'::text as check_name, 'PASS'::text as status,
    coalesce(details,'No policies found.') as details from table_policy_inventory
),
table_grant_inventory as (
  select string_agg(table_name || ': grantee=' || grantee || ', privilege=' || privilege_type, '; ' order by table_name,grantee,privilege_type) as details
  from information_schema.role_table_grants where table_schema='public' and table_name in ('products','product_recommendations')
),
grant_inventory_checks as (
  select 'Permissions and RLS'::text as category, 'Current table grants'::text as check_name, 'PASS'::text as status,
    coalesce(details,'No table grants visible to this SQL role.') as details from table_grant_inventory
),
migration_ledger as (
  select pg_catalog.to_regclass('supabase_migrations.schema_migrations') as ledger_oid,
    exists (select 1 from pg_catalog.pg_attribute a where a.attrelid=pg_catalog.to_regclass('supabase_migrations.schema_migrations') and a.attname='version' and not a.attisdropped) as has_version
),
migration_checks as (
  select 'Migration history'::text as category, 'Earlier and Stage 2 migration versions'::text as check_name,
    case when ledger_oid is null then 'WARNING'
      when not has_version then 'WARNING'
      else 'WARNING' end as status,
    case when ledger_oid is null then 'Supabase migration ledger is absent; SQL Editor runs may not be recorded there.'
      when not has_version then 'Ledger has no version column visible; verify migration history manually.'
      else 'Migration ledger exists and has a version column, but this read-only preflight does not inspect version rows. Verify versions 202611090001 and 202611150001 are applied and 202611150002 is not already applied.' end as details
  from migration_ledger
),
all_checks as (
  select * from table_checks
  union all select * from column_checks
  union all select * from key_checks
  union all select * from duplicate_checks
  union all select * from published_fk_checks
  union all select * from published_index_checks
  union all select * from inventory_checks
  union all select * from trigger_checks
  union all select * from function_checks
  union all select * from function_permission_checks
  union all select * from role_checks
  union all select * from rls_checks
  union all select * from policy_inventory_checks
  union all select * from grant_inventory_checks
  union all select * from migration_checks
),
scored as (
  select *, max(case status when 'BLOCKED' then 3 when 'WARNING' then 2 else 1 end) over () as overall_score
  from all_checks
)
select case overall_score when 3 then 'BLOCKED' when 2 then 'WARNING' else 'PASS' end as overall_status,
  category, check_name, status, details
from scored
order by case status when 'BLOCKED' then 1 when 'WARNING' then 2 else 3 end, category, check_name;
