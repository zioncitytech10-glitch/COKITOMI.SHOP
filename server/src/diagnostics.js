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
  const httpStatus = Number.isInteger(error?.httpStatus) ? error.httpStatus : null;
  if (provider === "supabase") {
    const code = typeof error?.providerCode === "string" && /^[A-Z0-9_-]{1,32}$/.test(error.providerCode)
      ? error.providerCode : null;
    const safeMessage = code === "42501" ? "database permission denied"
      : ["PGRST205", "42P01"].includes(code) ? "expected database table unavailable"
      : httpStatus === 401 || httpStatus === 403 ? "database request authentication rejected"
      : error?.networkFailure ? "database network request failed"
      : "database request failed";
    return { providerCode: code, httpStatus, message: safeMessage };
  }
  const code = Number.isInteger(error?.cjCode) ? error.cjCode : null;
  const safeMessage = error?.networkFailure ? "CJ network request failed"
    : code === 1600001 || code === 1600002 ? "CJ authentication rejected"
    : code === 1600003 ? "CJ token refresh rejected"
    : code === 1601000 ? "CJ account or API key not recognized"
    : code === 1600200 ? "CJ rate limit reached"
    : code !== null ? "CJ provider request failed"
    : "CJ request failed";
  return { providerCode: code, httpStatus, message: safeMessage };
}

async function check(provider, operation) {
  const startedAt = Date.now();
  try {
    await operation();
    return { status: "ok", latencyMs: Date.now() - startedAt };
  } catch (error) {
    // Log only an allowlisted provider code/status and a fixed sanitized message.
    // Never include raw messages, URLs, headers, response bodies, or stack traces.
    console.warn(JSON.stringify({ event: "connectivity_check_failed", provider, ...safeProviderDiagnostic(provider, error) }));
    return { status: "error", latencyMs: Date.now() - startedAt };
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
