-- Stage 2 admin product management and explicit CJ recommendation publishing.
-- Additive only: existing product and recommendation rows are preserved.
alter table public.products
  add column if not exists collection_ids text[] not null default '{}';

alter table public.product_recommendations
  add column if not exists published_product_id bigint references public.products(id) on delete set null,
  add column if not exists published_at timestamptz;

create unique index if not exists product_recommendations_published_product_uidx
  on public.product_recommendations(published_product_id)
  where published_product_id is not null;

create or replace function public.prevent_rejected_recommendation_activation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if new.is_active is true and exists (
      select 1 from public.product_recommendations
      where published_product_id = new.id and status = 'rejected'
    ) then
      raise exception 'Rejected recommendation cannot be activated' using errcode = '23514';
    end if;
  elsif tg_op = 'UPDATE' then
    if old.is_active is not true and new.is_active is true and exists (
      select 1 from public.product_recommendations
      where published_product_id = new.id and status = 'rejected'
    ) then
      raise exception 'Rejected recommendation cannot be activated' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.prevent_rejected_recommendation_activation() from public, anon, authenticated;
-- Preserve any existing trigger objects. Add the Stage 2 guard only when no
-- non-internal products trigger already calls this function.
do $stage2_trigger$
begin
  if not exists (
    select 1 from pg_catalog.pg_trigger
    where tgrelid = 'public.products'::regclass
      and tgfoid = 'public.prevent_rejected_recommendation_activation()'::regprocedure
      and not tgisinternal
  ) then
    execute 'create trigger stage2_prevent_rejected_recommendation_activation
      before insert or update on public.products
      for each row execute function public.prevent_rejected_recommendation_activation()';
  end if;
end
$stage2_trigger$;

create or replace function public.review_product_recommendation(
  p_recommendation_id uuid,
  p_status text,
  p_reviewer_id uuid,
  p_review_notes text default null
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  rec public.product_recommendations%rowtype;
begin
  if p_status is null or p_status not in ('pending', 'approved', 'rejected') then
    raise exception 'Invalid recommendation status' using errcode = '22023';
  end if;
  select * into rec from public.product_recommendations where id = p_recommendation_id for update;
  if not found then return null; end if;
  if rec.published_product_id is not null and p_status = 'pending' then
    raise exception 'Published recommendation cannot return to pending' using errcode = '22023';
  end if;
  update public.product_recommendations
    set status = p_status,
        reviewer_id = p_reviewer_id,
        review_notes = nullif(left(coalesce(p_review_notes, ''), 2000), ''),
        reviewed_at = now(),
        updated_at = now()
    where id = p_recommendation_id
    returning * into rec;
  return to_jsonb(rec);
end;
$$;

create or replace function public.publish_product_recommendation(
  p_recommendation_id uuid,
  p_slug text,
  p_price numeric,
  p_collection_ids text[] default '{}'
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  rec public.product_recommendations%rowtype;
  product_row public.products%rowtype;
begin
  if p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or length(p_slug) > 180 then
    raise exception 'Invalid product slug' using errcode = '22023';
  end if;
  if p_price is null or p_price <= 0 or p_price > 1000000 then
    raise exception 'Invalid retail price' using errcode = '22023';
  end if;
  if p_collection_ids is null then p_collection_ids := '{}'; end if;
  select * into rec from public.product_recommendations where id = p_recommendation_id for update;
  if not found then return null; end if;
  if rec.status <> 'approved' then
    raise exception 'Recommendation must be approved before publishing' using errcode = '22023';
  end if;
  if rec.published_product_id is not null then
    update public.products set is_active = true, updated_at = now()
      where id = rec.published_product_id returning * into product_row;
    return to_jsonb(product_row);
  end if;
  if rec.image_url is null or rec.image_url !~ '^https://' then
    raise exception 'Recommendation has no verified HTTPS product image' using errcode = '22023';
  end if;

  -- Idempotent duplicate guard: link to an existing CJ product without changing it.
  select * into product_row from public.products
    where supplier_product_id = rec.cj_product_id for update;
  if found then
    if product_row.is_active is not true then
      raise exception 'An inactive catalogue product with this CJ ID already exists' using errcode = '23505';
    end if;
    update public.product_recommendations
      set published_product_id = product_row.id, published_at = coalesce(published_at, now()), updated_at = now()
      where id = p_recommendation_id returning * into rec;
    return to_jsonb(product_row);
  end if;

  insert into public.products (
    supplier, supplier_product_id, slug, name, description, detail_description, price, currency,
    image_url, gallery_urls, collection_ids, stock_quantity, is_active
  ) values (
    'CJdropshipping', rec.cj_product_id, p_slug, rec.title, rec.description, rec.description,
    p_price, 'USD', rec.image_url,
    array(select item.value from jsonb_array_elements_text(case when jsonb_typeof(rec.gallery) = 'array' then rec.gallery else '[]'::jsonb end) as item(value) where item.value ~ '^https?://'),
    p_collection_ids,
    case
      when jsonb_typeof(rec.supplier_data->'inventory_verified') = 'boolean'
        and rec.supplier_data->'inventory_verified' = 'true'::jsonb
      then rec.inventory
      else null
    end,
    true
  ) returning * into product_row;

  update public.product_recommendations
    set published_product_id = product_row.id, published_at = now(), updated_at = now()
    where id = p_recommendation_id;
  return to_jsonb(product_row);
end;
$$;

revoke all on function public.review_product_recommendation(uuid, text, uuid, text) from public, anon, authenticated;
revoke all on function public.publish_product_recommendation(uuid, text, numeric, text[]) from public, anon, authenticated;
grant execute on function public.review_product_recommendation(uuid, text, uuid, text) to service_role;
grant execute on function public.publish_product_recommendation(uuid, text, numeric, text[]) to service_role;
