-- Preserve production data while making missing supplier costs explicit.
-- CJ research may only calculate estimates after both supplier and shipping costs
-- have been independently verified.
alter table public.product_recommendations
  alter column supplier_price drop not null,
  alter column supplier_price drop default;

-- rls_auto_enable is an event-trigger implementation detail. It must retain
-- SECURITY DEFINER so it can enable RLS on newly-created public tables, but it
-- is not an RPC and must not be callable through the Data API.
revoke all privileges on function public.rls_auto_enable() from public, anon, authenticated;
