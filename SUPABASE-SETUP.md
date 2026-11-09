# COKITOMI Supabase setup (first connection)

## 1. Add your public project credentials

Open `supabase-config.js` and replace:

- `YOUR_SUPABASE_PROJECT_URL` with the Project URL shown by Supabase (format: `https://<project-ref>.supabase.co`).
- `YOUR_SUPABASE_PUBLISHABLE_KEY` with the key beginning `sb_publishable_` from Settings > API Keys.

These two values are intended for browser use. Never put a `sb_secret_` key, legacy `service_role` key, database password, CJ API key, or payment secret in this file or in GitHub.

## 2. Create the initial database tables

In the Supabase dashboard, open **SQL Editor** > **New query**. Copy the full contents of `supabase/schema.sql` into the editor and click **Run**.

The schema enables Row Level Security. It allows visitors to read only active products and signed-in customers to read their own profile and orders. It grants `SELECT` on `products` to the public storefront roles; the active-products RLS policy still limits which rows they can see. It intentionally does not allow browser code to create paid orders or change product inventory.

If you already ran the schema and the storefront gets a products-table permission error, run this single statement in the Supabase SQL Editor:

```sql
grant select on table public.products to anon, authenticated;
```

## 3. Verify the client

After saving the config, open the deployed website, open the browser developer console, and look for:

`COKITOMI: Supabase client initialized.`

This confirms the browser client initialized; it does not yet mean checkout, payments, authentication, or CJ fulfilment are implemented.

## 4. Current limitations

The existing catalogue and shopping bag remain the frontend fallback. Active database rows update matching existing products by slug; local descriptions, collections, specifications, product IDs, and original images remain available. New database products without a matching local slug are not displayed yet. This connection does not activate checkout, collect payment, create orders, or submit orders to CJdropshipping. Those require secure server-side functions, payment verification, and additional testing.
