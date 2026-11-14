const PLACEHOLDER = /^(replace_with|your-project-ref|https:\/\/your-|<|\$\{)/i;

export function loadConfig(env = process.env) {
  const required = ["CJ_API_KEY", "SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SERVICE_ROLE_KEY", "ADMIN_USER_IDS"];
  const missing = required.filter((key) => !env[key] || PLACEHOLDER.test(env[key]));
  if (missing.length) throw new Error(`Missing required server environment variables: ${missing.join(", ")}`);

  let supabaseUrl;
  try { supabaseUrl = new URL(env.SUPABASE_URL); } catch { throw new Error("SUPABASE_URL must be a valid HTTPS URL"); }
  if (supabaseUrl.protocol !== "https:") throw new Error("SUPABASE_URL must use HTTPS");

  let cjBaseUrl;
  try { cjBaseUrl = new URL(env.CJ_API_BASE_URL || "https://developers.cjdropshipping.com/api2.0/v1"); }
  catch { throw new Error("CJ_API_BASE_URL must be a valid HTTPS URL"); }
  if (cjBaseUrl.protocol !== "https:") throw new Error("CJ_API_BASE_URL must use HTTPS");
  const adminUserIds = env.ADMIN_USER_IDS.split(",").map((id) => id.trim()).filter(Boolean);
  if (!adminUserIds.length) throw new Error("ADMIN_USER_IDS must contain at least one user UUID");
  const rawOrigins = (env.COKITOMI_ALLOWED_ORIGINS || "").split(",").map((x) => x.trim()).filter(Boolean);
  const allowedOrigins = rawOrigins.map((origin) => {
    let parsed;
    try { parsed = new URL(origin); } catch { throw new Error("COKITOMI_ALLOWED_ORIGINS must contain exact http(s) origins, never *"); }
    if (origin === "*" || !["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) {
      throw new Error("COKITOMI_ALLOWED_ORIGINS must contain exact http(s) origins without paths, never *");
    }
    return parsed.origin;
  });
  if (adminUserIds.some((id) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))) {
    throw new Error("ADMIN_USER_IDS must contain comma-separated Supabase Auth user UUIDs");
  }
  const diagnosticBearerToken = env.DIAGNOSTIC_BEARER_TOKEN && !PLACEHOLDER.test(env.DIAGNOSTIC_BEARER_TOKEN)
    ? env.DIAGNOSTIC_BEARER_TOKEN
    : "";
  if (diagnosticBearerToken && diagnosticBearerToken.length < 32) throw new Error("DIAGNOSTIC_BEARER_TOKEN must be at least 32 characters");

  return Object.freeze({
    cjApiKey: env.CJ_API_KEY,
    cjBaseUrl: cjBaseUrl.toString().replace(/\/$/, ""),
    supabaseUrl: supabaseUrl.toString().replace(/\/$/, ""),
    supabasePublishableKey: env.SUPABASE_PUBLISHABLE_KEY,
    supabaseServiceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
    adminUserIds: new Set(adminUserIds),
    diagnosticBearerToken,
    allowedOrigins: new Set(allowedOrigins),
    port: Number(env.PORT || 10000),
    maxCandidates: Math.min(50, Math.max(1, Number(env.CJ_MAX_CANDIDATES || 20))),
    requestIntervalMs: Math.max(1000, Number(env.CJ_REQUEST_INTERVAL_MS || 1100)),
    retailMultiplier: Math.max(1, Number(env.DISCOVERY_RETAIL_MULTIPLIER || 2.5)),
    paymentFeeRate: Math.min(0.2, Math.max(0, Number(env.ESTIMATED_PAYMENT_FEE_RATE || 0.03))),
  });
}
