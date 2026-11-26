# COKITOMI discovery API

Private Node.js API for CJdropshipping teddy-bear research, product management, and explicit admin-controlled recommendation publishing. It has no payment or supplier-order routes.

## Local setup

Copy `server/.env.example` to a local `server/.env` and fill values only in your local environment. Never commit `.env`. Run `npm start` from this directory. The service uses Node built-ins and requires Node 20+.

Required values: `CJ_API_KEY`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_USER_IDS`, `COKITOMI_ALLOWED_ORIGINS`, and `DIAGNOSTIC_BEARER_TOKEN`. `SUPABASE_SERVICE_ROLE_KEY` accepts either a legacy service-role JWT or a modern `sb_secret_` key; both belong only in server environments. Modern keys are sent in the `apikey` header, while legacy JWT keys also use the bearer header. Configure secrets through Render's environment settings, not this repository.

## Endpoints

- `GET /healthz` — process health only; does not reveal integrations.
- `GET /api/admin/diagnostics/connectivity` — protected by `Authorization: Bearer <DIAGNOSTIC_BEARER_TOKEN>`; returns only server/Supabase/CJ status and latency, never provider details or data. Supabase check reads at most one product ID and discards it; CJ check calls the read-only category endpoint.
- `GET /api/admin/overview` — requires a Supabase Auth access token for a user ID in `ADMIN_USER_IDS`; returns exact record counts from existing tables and marks payment revenue unavailable. It exposes no customer or order details.
- `GET /api/admin/products` — admin-only existing storefront catalogue, with linked private CJ research costs/variants when available.
- `PATCH /api/admin/products/{id}` — admin-only, field-allowlisted edits to an existing product. Supplier IDs, records, and private cost data cannot be changed through this route.

The static admin page is `../admin.html`. It uses Supabase email/password sign-in with an in-memory-only session, then requires `/api/admin/overview` to confirm the signed-in user is allowlisted before showing dashboard data. Logging out clears the local session first and redirects to `/admin/login`; a remote revocation failure is shown safely after the redirect. The static page shell is public; all dashboard data remains behind backend authorization.

`DIAGNOSTIC_BEARER_TOKEN` is intentionally optional at process startup so an existing Render deployment can keep serving `/healthz` before the new secret is added. Until a non-placeholder token of at least 32 characters is configured, the diagnostic endpoint returns `503 Diagnostic unavailable` without contacting either provider.
- `POST /api/admin/cj/research` — Supabase-authenticated admin triggers bounded CJ searches; optional JSON `{ "keywords": ["teddy bear"] }`.
- `GET /api/admin/recommendations?status=pending&limit=50` — private review queue.
- `PATCH /api/admin/recommendations/{uuid}` — JSON `{ "status": "approved|rejected|pending", "notes": "optional" }`. Approval only marks a recommendation approved; it never publishes. Rejecting an already published recommendation also deactivates its linked catalogue product.
- `POST /api/admin/recommendations/{uuid}/publish` — separate explicit action; accepts `{ "slug", "price", "collection_ids": [] }`. Only approved records with an HTTPS image can be published. CJ ID and slug duplicates are rejected or linked without overwriting existing product data.

Admin requests need a Supabase user access token whose verified Auth user ID is in `ADMIN_USER_IDS`. Use HTTPS in production. Restrict allowed origins to exact storefront origins.

## Database setup

Run the existing `supabase/migrations/202611090001_product_recommendations.sql` first if it has not already been applied, then review and manually run `supabase/migrations/202611150002_stage2_product_management.sql`. Stage 2 migration adds collection IDs and publication linkage, and installs service-role-only transactional review/publish functions plus a guard that prevents a rejected recommendation from being reactivated. It preserves existing rows and does not alter orders, order items, customer records, or payment data. Do not run it until you have reviewed the SQL. The private recommendations table remains RLS-protected and service-role-only.

## Research limitations

CJ trending/new-arrival flags, live inventory and freight estimates are sampled from CJ account APIs. Each returned variant is retained in private recommendation JSON with its IDs, names, available image/price/stock, warehouse observations and explicit verification flags. Stock calls use the existing shared rate-limited CJ client. Freight and delivery estimates are product-level estimates based on the researched variant; missing provider data stays unavailable. Review aggregates are populated only if CJ returns rating fields. Margin is an estimate before tax, returns, advertising, and other costs. Approval never publishes; only the separate publish action does.

## Render

The root `render.yaml` defines the API service with `server` as root, `npm start`, and `/healthz`. Connect the repository to Render, configure each `sync: false` secret in the dashboard, set allowed origins and admin UUIDs, then deploy. Run the Supabase migration separately before enabling research endpoints.
