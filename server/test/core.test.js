import test from "node:test";
import assert from "node:assert/strict";
import { scoreCandidate } from "../src/scoring.js";
import { CjClient } from "../src/cj-client.js";
import { SupabaseService } from "../src/supabase.js";
import { loadConfig } from "../src/config.js";
import { runConnectivityDiagnostic } from "../src/diagnostics.js";

function fakeClock(startAt = 10000) {
  let current = startAt;
  const sleeps = [];
  return {
    now: () => current,
    sleep: async (milliseconds) => { sleeps.push(milliseconds); current += milliseconds; },
    sleeps,
  };
}

test("scoring includes landed cost and yields bounded commercial score", () => {
  const scored = scoreCandidate({ supplierPrice: 5, shippingCost: 2, inventory: 150, usInventory: 20, rating: 4.8, reviewCount: 30, deliveryDays: 6, trending: true });
  assert.equal(scored.landedCost, 7);
  assert.ok(scored.suggestedRetail > scored.landedCost);
  assert.ok(scored.score <= 100);
  assert.ok(scored.score > 0);
});

test("CJ requests use one shared token acquisition and never put keys in URL", async () => {
  let calls = 0;
  const clock = fakeClock();
  const fakeFetch = async (url, options) => {
    calls++;
    if (url.endsWith("getAccessToken")) return Response.json({ result: true, data: { accessToken: "access-only-test", refreshToken: "refresh-only-test", accessTokenExpiryDate: 180 } });
    assert.equal(options.headers["CJ-Access-Token"], "access-only-test");
    return Response.json({ result: true, data: [] });
  };
  const cj = new CjClient({ apiKey: "test-key", baseUrl: "https://cj.example/api", minIntervalMs: 1000, fetchImpl: fakeFetch, nowImpl: clock.now, sleepImpl: clock.sleep });
  await Promise.all([cj.call("/product/listV2"), cj.call("/product/listV2")]);
  assert.equal(calls, 3);
  assert.equal(cj.token, "access-only-test");
});

test("CJ refreshes once after an invalid access token and continues the normal request", async () => {
  const calls = [];
  const clock = fakeClock();
  const fakeFetch = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith("getAccessToken")) return Response.json({ result: true, data: { accessToken: "initial-access", refreshToken: "initial-refresh", accessTokenExpiryDate: "2099-01-01T00:00:00Z" } });
    if (url.endsWith("refreshAccessToken")) return Response.json({ result: true, data: { accessToken: "refreshed-access", refreshToken: "refreshed-refresh", accessTokenExpiryDate: "2099-01-01T00:00:00Z" } });
    if (options.headers["CJ-Access-Token"] === "initial-access") return Response.json({ code: 1600001, result: false, message: "private invalid-token response" });
    assert.equal(options.headers["CJ-Access-Token"], "refreshed-access");
    return Response.json({ result: true, data: [{ id: "product-1" }] });
  };
  const cj = new CjClient({ apiKey: "test-key", baseUrl: "https://cj.example/api", minIntervalMs: 1000, fetchImpl: fakeFetch, nowImpl: clock.now, sleepImpl: clock.sleep });
  const result = await cj.call("/product/listV2", { query: { page: 1 } });
  assert.deepEqual(result.data, [{ id: "product-1" }]);
  assert.equal(calls.filter(({ url }) => url.endsWith("refreshAccessToken")).length, 1);
  assert.equal(calls.filter(({ url }) => url.endsWith("getAccessToken")).length, 1);
  assert.equal(calls.filter(({ url }) => url.endsWith("product/listV2?page=1")).length, 2);
});

test("CJ failed refresh and reauthentication terminate without retry loops", async () => {
  const calls = [];
  const clock = fakeClock();
  const fakeFetch = async (url, options) => {
    calls.push(url);
    if (url.endsWith("getAccessToken")) {
      if (calls.filter((entry) => entry.endsWith("getAccessToken")).length === 1) {
        return Response.json({ result: true, data: { accessToken: "initial-access", refreshToken: "initial-refresh", accessTokenExpiryDate: "2099-01-01T00:00:00Z" } });
      }
      return Response.json({ code: 1600005, result: false, message: "private reauthentication response" });
    }
    if (url.endsWith("refreshAccessToken")) return Response.json({ code: 1600003, result: false, message: "private refresh response" });
    return Response.json({ code: 1600001, result: false, message: "private invalid-token response" });
  };
  const cj = new CjClient({ apiKey: "test-key", baseUrl: "https://cj.example/api", minIntervalMs: 1000, fetchImpl: fakeFetch, nowImpl: clock.now, sleepImpl: clock.sleep });
  await assert.rejects(cj.call("/product/listV2"));
  assert.equal(calls.filter((url) => url.endsWith("refreshAccessToken")).length, 1);
  assert.equal(calls.filter((url) => url.endsWith("getAccessToken")).length, 2);
  assert.equal(calls.filter((url) => url.endsWith("product/listV2")).length, 1);
  assert.equal(calls.length, 4);
});

test("CJ rate limiter spaces every request and serializes concurrent callers", async () => {
  const clock = fakeClock();
  const starts = [];
  let active = 0;
  let maxActive = 0;
  const fakeFetch = async (url, options) => {
    starts.push({ url, at: clock.now() });
    active++;
    maxActive = Math.max(maxActive, active);
    await Promise.resolve();
    active--;
    if (url.endsWith("getAccessToken")) return Response.json({ result: true, data: { accessToken: "test-access", refreshToken: "test-refresh", accessTokenExpiryDate: "2099-01-01T00:00:00Z" } });
    assert.equal(options.headers["CJ-Access-Token"], "test-access");
    return Response.json({ result: true, data: [] });
  };
  const cj = new CjClient({ apiKey: "test-key", baseUrl: "https://cj.example/api", minIntervalMs: 1000, fetchImpl: fakeFetch, nowImpl: clock.now, sleepImpl: clock.sleep });
  await Promise.all([cj.call("/product/listV2"), cj.call("/product/listV2"), cj.call("/product/listV2")]);
  assert.equal(starts.length, 4);
  assert.equal(maxActive, 1);
  for (let index = 1; index < starts.length; index++) assert.ok(starts[index].at - starts[index - 1].at >= 1000);
});

test("CJ HTTP 429 honors Retry-After and succeeds on a bounded retry", async () => {
  const clock = fakeClock();
  const requestStarts = [];
  let productCalls = 0;
  const fakeFetch = async (url) => {
    requestStarts.push({ url, at: clock.now() });
    if (url.endsWith("getAccessToken")) return Response.json({ result: true, data: { accessToken: "test-access", refreshToken: "test-refresh", accessTokenExpiryDate: "2099-01-01T00:00:00Z" } });
    productCalls++;
    if (productCalls === 1) return Response.json({ code: 1600200, result: false, message: "private rate limit response" }, { status: 429, headers: { "Retry-After": "3" } });
    return Response.json({ result: true, data: ["ok"] });
  };
  const cj = new CjClient({ apiKey: "test-key", baseUrl: "https://cj.example/api", minIntervalMs: 1000, fetchImpl: fakeFetch, nowImpl: clock.now, sleepImpl: clock.sleep });
  const result = await cj.call("/product/listV2");
  assert.deepEqual(result.data, ["ok"]);
  assert.equal(productCalls, 2);
  const productStarts = requestStarts.filter(({ url }) => url.endsWith("product/listV2"));
  assert.ok(productStarts[1].at - productStarts[0].at >= 3000);
  assert.ok(clock.sleeps.includes(3000));
});

test("CJ error 1600200 retries, permanent auth/parameter errors do not", async () => {
  for (const code of [1600200, 1600005, 1600300]) {
    const clock = fakeClock();
    let calls = 0;
    const fakeFetch = async (url) => {
      if (url.endsWith("getAccessToken")) return Response.json({ result: true, data: { accessToken: "test-access", refreshToken: "test-refresh", accessTokenExpiryDate: "2099-01-01T00:00:00Z" } });
      calls++;
      if (calls === 1 && code === 1600200) return Response.json({ code, result: false, message: "private rate-limit response" });
      if (code !== 1600200) return Response.json({ code, result: false, message: "private permanent error" });
      return Response.json({ result: true, data: [] });
    };
    const cj = new CjClient({ apiKey: "test-key", baseUrl: "https://cj.example/api", minIntervalMs: 1000, fetchImpl: fakeFetch, nowImpl: clock.now, sleepImpl: clock.sleep });
    if (code === 1600200) {
      await cj.call("/product/listV2");
      assert.equal(calls, 2);
    } else {
      await assert.rejects(cj.call("/product/listV2"));
      assert.equal(calls, 1);
    }
  }
});

test("CJ rate-limit retries are capped at three retries after the initial attempt", async () => {
  const clock = fakeClock();
  let authenticationCalls = 0;
  let productCalls = 0;
  const fakeFetch = async (url) => {
    if (url.endsWith("getAccessToken")) {
      authenticationCalls++;
      return Response.json({ result: true, data: { accessToken: "test-access", refreshToken: "test-refresh", accessTokenExpiryDate: "2099-01-01T00:00:00Z" } });
    }
    productCalls++;
    return Response.json({ code: 1600200, result: false, message: "private rate-limit response" }, { status: 429 });
  };
  const cj = new CjClient({ apiKey: "test-key", baseUrl: "https://cj.example/api", minIntervalMs: 1000, fetchImpl: fakeFetch, nowImpl: clock.now, sleepImpl: clock.sleep });
  await assert.rejects(cj.call("/product/listV2"));
  assert.equal(authenticationCalls, 1);
  assert.equal(productCalls, 4);
});

test("CJ connectivity probes coalesce and cache results to avoid repeat requests", async () => {
  const clock = fakeClock();
  let authenticationCalls = 0;
  let categoryCalls = 0;
  const fakeFetch = async (url) => {
    if (url.endsWith("getAccessToken")) {
      authenticationCalls++;
      return Response.json({ result: true, data: { accessToken: "test-access", refreshToken: "test-refresh", accessTokenExpiryDate: "2099-01-01T00:00:00Z" } });
    }
    categoryCalls++;
    return Response.json({ result: true, data: ["category"] });
  };
  const cj = new CjClient({ apiKey: "test-key", baseUrl: "https://cj.example/api", minIntervalMs: 1000, fetchImpl: fakeFetch, nowImpl: clock.now, sleepImpl: clock.sleep });
  await Promise.all([cj.checkConnectivity(), cj.checkConnectivity()]);
  await cj.checkConnectivity();
  assert.equal(authenticationCalls, 1);
  assert.equal(categoryCalls, 1);
});

test("Supabase admin check validates bearer via Auth API and allowlists UUID", async () => {
  const id = "00000000-0000-4000-8000-000000000001";
  const supabase = new SupabaseService({ url: "https://example.supabase.co", publishableKey: "public-test", serviceRoleKey: "server-test", fetchImpl: async (_url, options) => {
    assert.equal(options.headers.Authorization, "Bearer signed-test-jwt");
    return Response.json({ id });
  } });
  assert.deepEqual(await supabase.verifyAdmin("Bearer signed-test-jwt", new Set([id])), { id });
  assert.equal(await supabase.verifyAdmin("Bearer signed-test-jwt", new Set()), null);
});

test("modern Supabase secret key is sent as apikey, never as a Bearer JWT", async () => {
  let seen;
  const secretKey = "sb_secret_test_only_value";
  const supabase = new SupabaseService({
    url: "https://example.supabase.co",
    publishableKey: "sb_publishable_test_only_value",
    serviceRoleKey: secretKey,
    fetchImpl: async (_url, options) => { seen = options.headers; return Response.json([]); },
  });
  await supabase.listRecommendations();
  assert.equal(seen.apikey, secretKey);
  assert.equal("Authorization" in seen, false);
});

test("config accepts Supabase Auth UUIDs and normalizes GitHub Pages origin", () => {
  const config = loadConfig({
    CJ_API_KEY: "test-cj-key",
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_only_value",
    SUPABASE_SERVICE_ROLE_KEY: "sb_secret_test_only_value",
    ADMIN_USER_IDS: "00000000-0000-4000-8000-000000000001",
    COKITOMI_ALLOWED_ORIGINS: "https://zioncitytech10-glitch.github.io/",
    DIAGNOSTIC_BEARER_TOKEN: "test_only_diagnostic_token_0123456789",
  });
  assert.equal(config.adminUserIds.has("00000000-0000-4000-8000-000000000001"), true);
  assert.equal(config.allowedOrigins.has("https://zioncitytech10-glitch.github.io"), true);
});

test("connectivity diagnostic reports successful read-only checks without data", async () => {
  let supabaseCalls = 0;
  let cjCalls = 0;
  const result = await runConnectivityDiagnostic({
    authorization: "Bearer test_only_diagnostic_token_0123456789",
    diagnosticToken: "test_only_diagnostic_token_0123456789",
    supabase: { checkConnectivity: async () => { supabaseCalls++; return [{ id: 123 }]; } },
    cj: { checkConnectivity: async () => { cjCalls++; return { data: ["private-category-data"] }; } },
  });
  assert.equal(result.httpStatus, 200);
  assert.equal(result.body.status, "healthy");
  assert.deepEqual(Object.keys(result.body.checks), ["server", "supabase", "cj"]);
  assert.equal(JSON.stringify(result.body).includes("private-category-data"), false);
  assert.equal(supabaseCalls, 1);
  assert.equal(cjCalls, 1);
});

test("connectivity diagnostic sanitizes failed provider connections", async () => {
  const logged = [];
  const originalWarn = console.warn;
  console.warn = (line) => logged.push(line);
  let result;
  try {
    result = await runConnectivityDiagnostic({
      authorization: "Bearer test_only_diagnostic_token_0123456789",
      diagnosticToken: "test_only_diagnostic_token_0123456789",
      supabase: new SupabaseService({
        url: "https://example.supabase.co",
        publishableKey: "test-publishable-key",
        serviceRoleKey: "test-service-key",
        fetchImpl: async () => Response.json({ code: "42501", message: "sensitive URL and service key" }, { status: 403 }),
      }),
      cj: new CjClient({
        apiKey: "test-cj-api-key",
        baseUrl: "https://cj.example/api",
        minIntervalMs: 0,
        fetchImpl: async () => Response.json({ code: 1600001, result: false, message: "private CJ token detail" }),
      }),
    });
  } finally { console.warn = originalWarn; }
  const responseText = JSON.stringify(result.body);
  assert.equal(result.httpStatus, 503);
  assert.equal(result.body.status, "degraded");
  assert.equal(result.body.checks.supabase.status, "error");
  assert.equal(result.body.checks.cj.status, "error");
  assert.equal(result.body.checks.supabase.classification, "permission_denied");
  assert.equal(result.body.checks.supabase.phase, "database_query");
  assert.equal(result.body.checks.supabase.providerCode, "42501");
  assert.equal(result.body.checks.supabase.httpStatus, 403);
  assert.equal(result.body.checks.cj.classification, "authentication_error");
  assert.equal(result.body.checks.cj.phase, "token_generation");
  assert.equal(result.body.checks.cj.providerCode, 1600001);
  assert.equal(responseText.includes("sensitive URL"), false);
  assert.equal(responseText.includes("private CJ token"), false);
  const logText = logged.join("\n");
  assert.match(logText, /42501/);
  assert.match(logText, /1600001/);
  assert.match(logText, /database permission denied/);
  assert.match(logText, /CJ authentication or account authorization rejected/);
  assert.equal(logText.includes("service key"), false);
  assert.equal(logText.includes("private CJ token"), false);
  assert.equal(logText.includes("sensitive URL"), false);
  assert.equal(logText.includes("test-service-key"), false);
  assert.equal(logText.includes("test-publishable-key"), false);
  assert.equal(logText.includes("test-cj-api-key"), false);
});

test("connectivity diagnostic classifies provider timeouts safely", async () => {
  const logged = [];
  const originalWarn = console.warn;
  console.warn = (line) => logged.push(line);
  try {
    const timeout = () => Object.assign(new Error("sensitive socket details"), { name: "TimeoutError" });
    const result = await runConnectivityDiagnostic({
      authorization: "Bearer test_only_diagnostic_token_0123456789",
      diagnosticToken: "test_only_diagnostic_token_0123456789",
      supabase: new SupabaseService({ url: "https://example.supabase.co", publishableKey: "public", serviceRoleKey: "secret", fetchImpl: async () => { throw timeout(); } }),
      cj: new CjClient({ apiKey: "cj-secret", baseUrl: "https://cj.example/api", minIntervalMs: 0, fetchImpl: async () => { throw timeout(); } }),
    });
    assert.equal(result.body.checks.supabase.classification, "timeout");
    assert.equal(result.body.checks.cj.classification, "timeout");
    const text = JSON.stringify({ body: result.body, logged });
    assert.equal(text.includes("sensitive socket details"), false);
    assert.equal(text.includes("cj-secret"), false);
  } finally { console.warn = originalWarn; }
});

test("connectivity diagnostic classifies CJ authentication and timeout provider codes", async () => {
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    for (const cjCode of [1600004, 1600005, 1600006]) {
      const result = await runConnectivityDiagnostic({
        authorization: "Bearer test_only_diagnostic_token_0123456789",
        diagnosticToken: "test_only_diagnostic_token_0123456789",
        supabase: { checkConnectivity: async () => [] },
        cj: { checkConnectivity: async () => { throw Object.assign(new Error("private provider response"), { cjCode, httpStatus: 200 }); } },
      });
      assert.equal(result.body.checks.cj.classification, "authentication_error");
      assert.equal(result.body.checks.cj.providerCode, cjCode);
    }
    const timedOut = await runConnectivityDiagnostic({
      authorization: "Bearer test_only_diagnostic_token_0123456789",
      diagnosticToken: "test_only_diagnostic_token_0123456789",
      supabase: { checkConnectivity: async () => [] },
      cj: { checkConnectivity: async () => { throw Object.assign(new Error("private timeout response"), { cjCode: 1600301, httpStatus: 200 }); } },
    });
    assert.equal(timedOut.body.checks.cj.classification, "timeout");
  } finally { console.warn = originalWarn; }
});

test("connectivity diagnostic reports rate limiting separately from authentication", async () => {
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    const result = await runConnectivityDiagnostic({
      authorization: "Bearer test_only_diagnostic_token_0123456789",
      diagnosticToken: "test_only_diagnostic_token_0123456789",
      supabase: { checkConnectivity: async () => [] },
      cj: { checkConnectivity: async () => { throw Object.assign(new Error("private provider response"), { cjCode: 1600200, httpStatus: 429 }); } },
    });
    assert.equal(result.body.checks.cj.classification, "rate_limited");
    assert.equal(result.body.checks.cj.message, "CJ rate limit reached");
    assert.notEqual(result.body.checks.cj.classification, "authentication_error");
  } finally { console.warn = originalWarn; }
});

test("connectivity diagnostic classifies HTTP gateway timeouts for both providers", async () => {
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    for (const httpStatus of [408, 504]) {
      const result = await runConnectivityDiagnostic({
        authorization: "Bearer test_only_diagnostic_token_0123456789",
        diagnosticToken: "test_only_diagnostic_token_0123456789",
        supabase: { checkConnectivity: async () => { throw Object.assign(new Error("private Supabase response"), { httpStatus }); } },
        cj: { checkConnectivity: async () => { throw Object.assign(new Error("private CJ response"), { httpStatus }); } },
      });
      assert.equal(result.body.checks.supabase.classification, "timeout");
      assert.equal(result.body.checks.cj.classification, "timeout");
      assert.equal(result.body.checks.supabase.httpStatus, httpStatus);
      assert.equal(result.body.checks.cj.httpStatus, httpStatus);
    }
  } finally { console.warn = originalWarn; }
});

test("Supabase timeout statuses take precedence over error codes while permission and auth errors remain distinct", async () => {
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    const cases = [
      { httpStatus: 408, code: "42501", classification: "timeout", message: "database request timed out" },
      { httpStatus: 504, code: "42P01", classification: "timeout", message: "database request timed out" },
      { httpStatus: 403, code: "42501", classification: "permission_denied", message: "database permission denied" },
      { httpStatus: 401, code: "", classification: "authentication_or_permission_error", message: "database request authentication rejected" },
    ];
    for (const expected of cases) {
      const result = await runConnectivityDiagnostic({
        authorization: "Bearer test_only_diagnostic_token_0123456789",
        diagnosticToken: "test_only_diagnostic_token_0123456789",
        supabase: new SupabaseService({
          url: "https://example.supabase.co",
          publishableKey: "test-publishable-key",
          serviceRoleKey: "test-service-key",
          fetchImpl: async () => Response.json({ code: expected.code, message: "sensitive provider response" }, { status: expected.httpStatus }),
        }),
        cj: { checkConnectivity: async () => ({ data: [] }) },
      });
      assert.equal(result.body.checks.supabase.classification, expected.classification);
      assert.equal(result.body.checks.supabase.message, expected.message);
      assert.equal(result.body.checks.supabase.httpStatus, expected.httpStatus);
    }
  } finally { console.warn = originalWarn; }
});

test("successful Supabase HTTP response with invalid JSON has a safe classification", async () => {
  const logged = [];
  const originalWarn = console.warn;
  console.warn = (line) => logged.push(line);
  try {
    const result = await runConnectivityDiagnostic({
      authorization: "Bearer test_only_diagnostic_token_0123456789",
      diagnosticToken: "test_only_diagnostic_token_0123456789",
      supabase: new SupabaseService({
        url: "https://example.supabase.co",
        publishableKey: "test-publishable-key",
        serviceRoleKey: "test-service-key",
        fetchImpl: async () => new Response("raw secret body and access token", { status: 200 }),
      }),
      cj: { checkConnectivity: async () => ({ data: [] }) },
    });
    assert.equal(result.body.checks.supabase.classification, "invalid_provider_response");
    assert.equal(result.body.checks.supabase.httpStatus, 200);
    assert.equal(JSON.stringify(result.body).includes("raw secret body"), false);
    assert.equal(logged.join("\n").includes("raw secret body"), false);
  } finally { console.warn = originalWarn; }
});

test("connectivity diagnostic rejects unauthorized requests before calling providers", async () => {
  let calls = 0;
  const result = await runConnectivityDiagnostic({
    authorization: "Bearer incorrect-token",
    diagnosticToken: "test_only_diagnostic_token_0123456789",
    supabase: { checkConnectivity: async () => { calls++; } },
    cj: { call: async () => { calls++; } },
  });
  assert.equal(result.httpStatus, 401);
  assert.deepEqual(result.body, { error: "Unauthorized" });
  assert.equal(calls, 0);
});

test("connectivity diagnostic stays disabled until its bearer token is configured", async () => {
  let calls = 0;
  const result = await runConnectivityDiagnostic({
    authorization: "Bearer anything",
    diagnosticToken: "",
    supabase: { checkConnectivity: async () => { calls++; } },
    cj: { call: async () => { calls++; } },
  });
  assert.equal(result.httpStatus, 503);
  assert.deepEqual(result.body, { error: "Diagnostic unavailable" });
  assert.equal(calls, 0);
});
