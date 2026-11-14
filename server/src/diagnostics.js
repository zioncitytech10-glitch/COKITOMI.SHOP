import { createHash, timingSafeEqual } from "node:crypto";

export function isDiagnosticAuthorized(authorization, expectedToken) {
  if (typeof authorization !== "string" || typeof expectedToken !== "string" || expectedToken.length < 32) return false;
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) return false;
  const suppliedHash = createHash("sha256").update(match[1]).digest();
  const expectedHash = createHash("sha256").update(expectedToken).digest();
  return timingSafeEqual(suppliedHash, expectedHash);
}

async function check(operation) {
  const startedAt = Date.now();
  try {
    await operation();
    return { status: "ok", latencyMs: Date.now() - startedAt };
  } catch {
    // Deliberately omit provider error messages, request URLs, and credentials.
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
    check(() => supabase.checkConnectivity()),
    check(() => cj.call("/product/getCategory")),
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
