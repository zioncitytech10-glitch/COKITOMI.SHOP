-- Private CJ research queue. This table is deliberately separate from products:
-- recommendation approval never publishes or writes to the storefront catalogue.
create table if not exists public.product_recommendations (
  id uuid primary key default gen_random_uuid(),
  cj_product_id text not null unique,
  cj_variant_id text,
  title text not null,
  description text,
  image_url text,
  gallery jsonb not null default '[]'::jsonb,
  variant_data jsonb not null default '{}'::jsonb,
  supplier_data jsonb not null default '{}'::jsonb,
  supplier_price numeric(12,2) not null default 0 check (supplier_price >= 0),
  shipping_cost numeric(12,2) check (shipping_cost is null or shipping_cost >= 0),
  shipping_method text,
  delivery_days numeric(8,2),
  inventory integer not null default 0 check (inventory >= 0),
  us_inventory integer not null default 0 check (us_inventory >= 0),
  review_rating numeric(3,2) check (review_rating is null or review_rating between 0 and 5),
  review_count integer not null default 0 check (review_count >= 0),
  suggested_retail_price numeric(12,2) not null default 0 check (suggested_retail_price >= 0),
  estimated_landed_cost numeric(12,2) not null default 0 check (estimated_landed_cost >= 0),
  estimated_profit numeric(12,2) not null default 0,
  estimated_margin numeric(7,4) not null default 0,
  commercial_score integer not null default 0 check (commercial_score between 0 and 100),
  score_breakdown jsonb not null default '{}'::jsonb,
  research_signals jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewer_id uuid references auth.users(id) on delete set null,
  review_notes text,
  reviewed_at timestamptz,
  researched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists product_recommendations_queue_idx
  on public.product_recommendations(status, commercial_score desc, researched_at desc);
alter table public.product_recommendations enable row level security;
revoke all on table public.product_recommendations from anon, authenticated;
grant all on table public.product_recommendations to service_role;

-- There are deliberately no anon/authenticated policies and no INSERT/UPDATE
-- permission for those roles. Admin access is mediated by the private backend.
