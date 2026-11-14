import { createHash, timingSafeEqual } from "node:crypto";

export function isDiagnosticAuthorized(authorization, expectedToken) {
  if (typeof authorization !== "string" || typeof expectedToken !== "string" || expectedToken.length < 32) return false;
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) return false;
  const suppliedHash = createHash("sha256").update(match[1]).digest();
  const expectedHash = createHash("sha256").update(expectedToken).digest();
  return timingSafeEqual(suppliedHash, expectedHash);
}

function safeProviderDiagnostic(provider, error) {
  const httpStatus = Number.isInteger(error?.httpStatus) && error.httpStatus >= 100 && error.httpStatus <= 599 ? error.httpStatus : null;
  if (provider === "supabase") {
    const code = typeof error?.providerCode === "string" && /^[A-Z0-9_-]{1,32}$/.test(error.providerCode)
      ? error.providerCode : null;
    const classification = [408, 504].includes(httpStatus) || error?.timeoutFailure ? "timeout"
      : code === "42501" ? "permission_denied"
      : ["PGRST205", "42P01"].includes(code) ? "table_unavailable"
      : httpStatus === 401 || httpStatus === 403 ? "authentication_or_permission_error"
      : error?.networkFailure ? "network_error"
      : error?.protocolFailure ? "invalid_provider_response"
      : "provider_error";
    const safeMessage = [408, 504].includes(httpStatus) || error?.timeoutFailure ? "database request timed out"
      : code === "42501" ? "database permission denied"
      : ["PGRST205", "42P01"].includes(code) ? "expected database table unavailable"
      : httpStatus === 401 || httpStatus === 403 ? "database request authentication rejected"
      : error?.networkFailure ? "database network request failed"
      : error?.protocolFailure ? "database returned an invalid response"
      : "database request failed";
    return { classification, phase: "database_query", providerCode: code, httpStatus, message: safeMessage };
  }
  const code = Number.isInteger(error?.cjCode) && error.cjCode >= 0 && error.cjCode <= 9999999999 ? error.cjCode : null;
  const classification = error?.timeoutFailure || code === 1600301 || [408, 504].includes(httpStatus) ? "timeout"
    : error?.networkFailure ? "network_error"
    : [1600001, 1600002, 1600004, 1600005, 1600006, 1601000].includes(code) ? "authentication_error"
    : code === 1600003 ? "token_refresh_error"
    : code === 1600200 ? "rate_limited"
    : error?.protocolFailure ? "invalid_provider_response"
    : httpStatus && httpStatus >= 400 ? "http_error"
    : "provider_error";
  const safeMessage = error?.timeoutFailure || code === 1600301 || [408, 504].includes(httpStatus) ? "CJ request timed out"
    : error?.networkFailure ? "CJ network request failed"
    : [1600001, 1600002, 1600004, 1600005, 1600006].includes(code) ? "CJ authentication or account authorization rejected"
    : code === 1600003 ? "CJ token refresh rejected"
    : code === 1601000 ? "CJ account or API key not recognized"
    : code === 1600200 ? "CJ rate limit reached"
    : code !== null ? "CJ provider request failed"
    : "CJ request failed";
  return { classification, phase: error?.cjPhase === "authentication" ? "token_generation" : "category_request", providerCode: code, httpStatus, message: safeMessage };
}

async function check(provider, operation) {
  const startedAt = Date.now();
  try {
    await operation();
    return { status: "ok", latencyMs: Date.now() - startedAt };
  } catch (error) {
    // Log only an allowlisted provider code/status and a fixed sanitized message.
    // Never include raw messages, URLs, headers, response bodies, or stack traces.
    const diagnostic = safeProviderDiagnostic(provider, error);
    console.warn(JSON.stringify({ event: "connectivity_check_failed", provider, ...diagnostic }));
    return { status: "error", latencyMs: Date.now() - startedAt, ...diagnostic };
  }
}

export async function runConnectivityDiagnostic({ authorization, diagnosticToken, supabase, cj }) {
  if (typeof diagnosticToken !== "string" || diagnosticToken.length < 32) {
    return { httpStatus: 503, body: { error: "Diagnostic unavailable" } };
  }
  if (!isDiagnosticAuthorized(authorization, diagnosticToken)) {
    return { httpStatus: 401, body: { error: "Unauthorized" } };
  }

  const [supabaseCheck, cjCheck] = await Promise.all([
    check("supabase", () => supabase.checkConnectivity()),
    check("cj", () => cj.call("/product/getCategory")),
  ]);
  const checks = {
    server: { status: "ok" },
    supabase: supabaseCheck,
    cj: cjCheck,
  };
  const healthy = supabaseCheck.status === "ok" && cjCheck.status === "ok";
  return {
    httpStatus: healthy ? 200 : 503,
    body: { status: healthy ? "healthy" : "degraded", checks },
  };
}
