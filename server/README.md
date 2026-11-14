# COKITOMI discovery API

Private Node.js API for CJdropshipping teddy-bear research and an admin-only recommendation queue. It has no storefront publishing, payment, or supplier-order routes.

## Local setup

Copy `server/.env.example` to a local `server/.env` and fill values only in your local environment. Never commit `.env`. Run `npm start` from this directory. The service uses Node built-ins and requires Node 20+.

Required values: `CJ_API_KEY`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_USER_IDS`, `COKITOMI_ALLOWED_ORIGINS`, and `DIAGNOSTIC_BEARER_TOKEN`. `SUPABASE_SERVICE_ROLE_KEY` accepts either a legacy service-role JWT or a modern `sb_secret_` key; both belong only in server environments. Modern keys are sent in the `apikey` header, while legacy JWT keys also use the bearer header. Configure secrets through Render's environment settings, not this repository.

## Endpoints

- `GET /healthz` — process health only; does not reveal integrations.
- `GET /api/admin/diagnostics/connectivity` — protected by `Authorization: Bearer <DIAGNOSTIC_BEARER_TOKEN>`; returns only server/Supabase/CJ status and latency, never provider details or data. Supabase check reads at most one product ID and discards it; CJ check calls the read-only category endpoint.

`DIAGNOSTIC_BEARER_TOKEN` is intentionally optional at process startup so an existing Render deployment can keep serving `/healthz` before the new secret is added. Until a non-placeholder token of at least 32 characters is configured, the diagnostic endpoint returns `503 Diagnostic unavailable` without contacting either provider.
- `POST /api/admin/cj/research` — Supabase-authenticated admin triggers bounded CJ searches; optional JSON `{ "keywords": ["teddy bear"] }`.
- `GET /api/admin/recommendations?status=pending&limit=50` — private review queue.
- `PATCH /api/admin/recommendations/{uuid}` — JSON `{ "status": "approved|rejected|pending", "notes": "optional" }`. This only updates review metadata; it never publishes a product.

Admin requests need a Supabase user access token whose verified Auth user ID is in `ADMIN_USER_IDS`. Use HTTPS in production. Restrict allowed origins to exact storefront origins.

## Database setup

Run `supabase/migrations/202611090001_product_recommendations.sql` in the Supabase SQL editor. The table is RLS-enabled and grants data access only to `service_role`; do not expose that key to the browser. The migration does not alter the existing `products` table.

## Research limitations

CJ trending/new-arrival flags, live inventory and freight estimates are sampled from CJ account APIs. Review aggregates are populated only if CJ returns rating fields. If freight or reviews are unavailable, those fields remain unknown/empty and scoring gives no credit for them. Margin is an estimate using the configured retail multiplier and payment-fee assumption, before tax, returns, advertising, and other costs. Review all recommendations manually; nothing is published automatically.

## Render

The root `render.yaml` defines the API service with `server` as root, `npm start`, and `/healthz`. Connect the repository to Render, configure each `sync: false` secret in the dashboard, set allowed origins and admin UUIDs, then deploy. Run the Supabase migration separately before enabling research endpoints.
