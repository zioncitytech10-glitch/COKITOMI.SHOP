-- Add the optional storefront detail copy without changing existing product rows.
-- Safe to run when the column already exists.
alter table public.products
  add column if not exists detail_description text;
