```javascript
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { loadConfig } from "./config.js";
import { CjClient } from "./cj-client.js";
import { ProductDiscovery } from "./discovery.js";
import { SupabaseService } from "./supabase.js";
import { runConnectivityDiagnostic } from "./diagnostics.js";
import {
  authenticateAdmin,
  getAdminOverviewResponse,
} from "./admin-dashboard.js";
import {
  validateProductChanges,
  validatePublishRequest,
} from "./product-management.js";

const config = loadConfig();

const supabase = new SupabaseService({
  url: config.supabaseUrl,
  publishableKey: config.supabasePublishableKey,
  serviceRoleKey: config.supabaseServiceRoleKey,
});

const cj = new CjClient({
  apiKey: config.cjApiKey,
  baseUrl: config.cjBaseUrl,
  minIntervalMs: config.requestIntervalMs,
});

const discovery = new ProductDiscovery({ cj, config, supabase });

const MAX_BODY = 16 * 1024;

function send(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });

  res.end(JSON.stringify(body));
}

async function readJson(req) {
  let raw = "";

  for await (const chunk of req) {
    raw += chunk;

    if (raw.length > MAX_BODY) {
      throw Object.assign(
        new Error("Request body too large"),
        { status: 413 },
      );
    }
  }

  if (!raw) return {};

  try {
    return JSON.parse(raw);
  } catch {
    throw Object.assign(
      new Error("Invalid JSON"),
      { status: 400 },
    );
  }
}

async function requireAdmin(req) {
  return authenticateAdmin({
    authorization: req.headers.authorization,
    adminUserIds: config.adminUserIds,
    supabase,
  });
}

const server = createServer(async (req, res) => {
  const requestId = randomUUID();
  const origin = req.headers.origin;

  if (origin && config.allowedOrigins.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Authorization, Content-Type",
    );
    res.setHeader(
      "Access-Control-Allow-Methods",
      "GET, POST, PATCH, DELETE, OPTIONS",
    );
  }

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }

  try {
    const url = new URL(req.url, "http://localhost");

    // Health check
    if (req.method === "GET" && url.pathname === "/healthz") {
      return send(res, 200, { ok: true });
    }

    // Administrator dashboard overview
    if (
      req.method === "GET" &&
      url.pathname === "/api/admin/overview"
    ) {
      const result = await getAdminOverviewResponse({
        authorization: req.headers.authorization,
        adminUserIds: config.adminUserIds,
        supabase,
      });

      return send(res, result.httpStatus, result.body);
    }

    // Connectivity diagnostics
    if (
      req.method === "GET" &&
      url.pathname === "/api/admin/diagnostics/connectivity"
    ) {
      const result = await runConnectivityDiagnostic({
        authorization: req.headers.authorization,
        diagnosticToken: config.diagnosticBearerToken,
        supabase,
        cj,
      });

      return send(res, result.httpStatus, result.body);
    }

    // Protected administrator routes
    if (url.pathname.startsWith("/api/admin/")) {
      const admin = await requireAdmin(req);

      if (!admin) {
        return send(res, 401, {
          error: "Admin authentication required",
        });
      }

      // CJ supplier research
      if (
        req.method === "POST" &&
        url.pathname === "/api/admin/cj/research"
      ) {
        const body = await readJson(req);
        const keywords =
          body.keywords === undefined ? undefined : body.keywords;

        if (
          keywords !== undefined &&
          (
            !Array.isArray(keywords) ||
            keywords.some(
              (x) => typeof x !== "string" || x.length > 80,
            )
          )
        ) {
          return send(res, 400, {
            error: "keywords must be an array of short search terms",
          });
        }

        const result = await discovery.research({ keywords });

        return send(res, 200, result);
      }

      // List storefront products
      if (
        req.method === "GET" &&
        url.pathname === "/api/admin/products"
      ) {
        return send(res, 200, {
          products: await supabase.listProducts(),
        });
      }

      // Manually create a storefront product
      if (
        req.method === "POST" &&
        url.pathname === "/api/admin/products"
      ) {
        const input = validateProductChanges(await readJson(req));

        if (
          !input.name ||
          !input.slug ||
          input.price === undefined
        ) {
          return send(res, 400, {
            error: "Product name, slug and price are required",
          });
        }

        try {
          const product = await supabase.createProduct({
            ...input,
            currency: input.currency || "USD",
            is_active: false,
          });

          return send(res, 201, { product });
        } catch (error) {
          if (error.providerCode === "23505") {
            return send(res, 409, {
              error: "A product with this slug already exists",
            });
          }

          throw error;
        }
      }

      // Match individual product IDs
      const productMatch = url.pathname.match(
        /^\/api\/admin\/products\/(\d+)$/,
      );

      // Edit an existing product
      if (req.method === "PATCH" && productMatch) {
        const changes = validateProductChanges(
          await readJson(req),
        );

        try {
          const updated = await supabase.updateProduct(
            productMatch[1],
            changes,
          );

          return updated
            ? send(res, 200, { product: updated })
            : send(res, 404, { error: "Product not found" });
        } catch (error) {
          if (error.providerCode === "23514") {
            return send(res, 409, {
              error:
                "A product linked to a rejected recommendation must be approved before activation",
            });
          }

          if (error.providerCode === "23505") {
            return send(res, 409, {
              error: "A product with this slug already exists",
            });
          }

          throw error;
        }
      }

      // Delete a product
      if (req.method === "DELETE" && productMatch) {
        const deleted = await supabase.deleteProduct(
          productMatch[1],
        );

        return deleted
          ? send(res, 200, {
              deleted: true,
              id: productMatch[1],
            })
          : send(res, 404, {
              error: "Product not found",
            });
      }

      // List supplier recommendations
      if (
        req.method === "GET" &&
        url.pathname === "/api/admin/recommendations"
      ) {
        const status =
          url.searchParams.get("status") || "pending";

        const limit = Math.min(
          100,
          Math.max(
            1,
            Number(url.searchParams.get("limit") || 50),
          ),
        );

        if (
          !["pending", "approved", "rejected"].includes(status)
        ) {
          return send(res, 400, {
            error: "Invalid status",
          });
        }

        return send(res, 200, {
          recommendations: await supabase.listRecommendations(
            status,
            limit,
          ),
        });
      }

      // Match supplier recommendation IDs
      const match = url.pathname.match(
        /^\/api\/admin\/recommendations\/([0-9a-f-]{36})$/i,
      );

      const publishMatch = url.pathname.match(
        /^\/api\/admin\/recommendations\/([0-9a-f-]{36})\/publish$/i,
      );

      // Publish an approved CJ recommendation
      if (req.method === "POST" && publishMatch) {
        const input = validatePublishRequest(
          await readJson(req),
        );

        try {
          const product = await supabase.publishRecommendation(
            publishMatch[1],
            input,
          );

          return product
            ? send(res, 200, {
                product,
                published: true,
              })
            : send(res, 404, {
                error: "Recommendation not found",
              });
        } catch (error) {
          if (
            error.httpStatus === 409 ||
            error.providerCode === "23505"
          ) {
            return send(res, 409, {
              error:
                "A product with this CJ ID or slug already exists",
            });
          }

          if (
            error.httpStatus === 400 ||
            error.providerCode === "22023"
          ) {
            return send(res, 409, {
              error:
                "Recommendation is not publishable or its information is incomplete",
            });
          }

          throw error;
        }
      }

      // Approve, reject or return a recommendation to pending
      if (req.method === "PATCH" && match) {
        const body = await readJson(req);

        if (
          !["pending", "approved", "rejected"].includes(body.status)
        ) {
          return send(res, 400, {
            error:
              "status must be pending, approved or rejected",
          });
        }

        const notes =
          typeof body.notes === "string"
            ? body.notes.slice(0, 2000)
            : null;

        const updated = await supabase.updateRecommendation(
          match[1],
          body.status,
          admin.id,
          notes,
        );

        const recommendation = Array.isArray(updated)
          ? updated[0] || null
          : updated;

        return send(
          res,
          recommendation ? 200 : 404,
          { recommendation },
        );
      }
    }

    return send(res, 404, { error: "Not found" });

  } catch (error) {
    // Never log request headers, CJ payloads, tokens or environment values.
    console.error(
      JSON.stringify({
        requestId,
        error: error.status
          ? error.message
          : "Internal service error",
      }),
    );

    return send(
      res,
      error.status || 500,
      {
        error: error.status
          ? error.message
          : "Internal service error",
        requestId,
      },
    );
  }
});

server.listen(
  config.port,
  "0.0.0.0",
  () => {
    console.log(
      JSON.stringify({
        event: "server_started",
        port: config.port,
      }),
    );
  },
);

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () =>
    server.close(() => process.exit(0)),
  );
}
```