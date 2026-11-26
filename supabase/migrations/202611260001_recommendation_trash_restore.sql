-- Add recoverable soft-delete support for private supplier recommendations.
alter table public.product_recommendations
  add column if not exists deleted_at timestamptz;

create index if not exists product_recommendations_trash_idx
  on public.product_recommendations(deleted_at)
  where deleted_at is not null;
