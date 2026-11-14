import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { loadConfig } from "./config.js";
import { CjClient } from "./cj-client.js";
import { ProductDiscovery } from "./discovery.js";
import { SupabaseService } from "./supabase.js";
import { runConnectivityDiagnostic } from "./diagnostics.js";

const config = loadConfig();
const supabase = new SupabaseService({
  url: config.supabaseUrl,
  publishableKey: config.supabasePublishableKey,
  serviceRoleKey: config.supabaseServiceRoleKey,
});
const cj = new CjClient({ apiKey: config.cjApiKey, baseUrl: config.cjBaseUrl, minIntervalMs: config.requestIntervalMs });
const discovery = new ProductDiscovery({ cj, config, supabase });
const MAX_BODY = 16 * 1024;

function send(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > MAX_BODY) throw Object.assign(new Error("Request body too large"), { status: 413 });
  }
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw Object.assign(new Error("Invalid JSON"), { status: 400 }); }
}

async function requireAdmin(req) {
  const admin = await supabase.verifyAdmin(req.headers.authorization, config.adminUserIds);
  return admin;
}

const server = createServer(async (req, res) => {
  const requestId = randomUUID();
  const origin = req.headers.origin;
  if (origin && config.allowedOrigins.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS");
  }
  if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }
  try {
    const url = new URL(req.url, "http://localhost");
    if (req.method === "GET" && url.pathname === "/healthz") return send(res, 200, { ok: true });
    if (req.method === "GET" && url.pathname === "/api/admin/diagnostics/connectivity") {
      const result = await runConnectivityDiagnostic({
        authorization: req.headers.authorization,
        diagnosticToken: config.diagnosticBearerToken,
        supabase,
        cj,
      });
      return send(res, result.httpStatus, result.body);
    }
    if (url.pathname.startsWith("/api/admin/")) {
      const admin = await requireAdmin(req);
      if (!admin) return send(res, 401, { error: "Admin authentication required" });

      if (req.method === "POST" && url.pathname === "/api/admin/cj/research") {
        const body = await readJson(req);
        const keywords = body.keywords === undefined ? undefined : body.keywords;
        if (keywords !== undefined && (!Array.isArray(keywords) || keywords.some((x) => typeof x !== "string" || x.length > 80))) {
          return send(res, 400, { error: "keywords must be an array of short search terms" });
        }
        const result = await discovery.research({ keywords });
        return send(res, 200, result);
      }

      if (req.method === "GET" && url.pathname === "/api/admin/recommendations") {
        const status = url.searchParams.get("status") || "pending";
        const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") || 50)));
        if (!["pending", "approved", "rejected"].includes(status)) return send(res, 400, { error: "Invalid status" });
        return send(res, 200, { recommendations: await supabase.listRecommendations(status, limit) });
      }

      const match = url.pathname.match(/^\/api\/admin\/recommendations\/([0-9a-f-]{36})$/i);
      if (req.method === "PATCH" && match) {
        const body = await readJson(req);
        if (!["pending", "approved", "rejected"].includes(body.status)) return send(res, 400, { error: "status must be pending, approved or rejected" });
        const notes = typeof body.notes === "string" ? body.notes.slice(0, 2000) : null;
        const updated = await supabase.updateRecommendation(match[1], body.status, admin.id, notes);
        return send(res, updated.length ? 200 : 404, { recommendation: updated[0] || null });
      }
    }
    return send(res, 404, { error: "Not found" });
  } catch (error) {
    // Never log request headers, CJ payloads, tokens, or environment values.
    console.error(JSON.stringify({ requestId, error: error.status ? error.message : "Internal service error" }));
    return send(res, error.status || 500, { error: error.status ? error.message : "Internal service error", requestId });
  }
});

server.listen(config.port, "0.0.0.0", () => console.log(JSON.stringify({ event: "server_started", port: config.port })));

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
