import test from "node:test";
import assert from "node:assert/strict";
import { scoreCandidate } from "../src/scoring.js";
import { CjClient } from "../src/cj-client.js";
import { SupabaseService } from "../src/supabase.js";
import { loadConfig } from "../src/config.js";
import { runConnectivityDiagnostic } from "../src/diagnostics.js";

test("scoring includes landed cost and yields bounded commercial score", () => {
  const scored = scoreCandidate({ supplierPrice: 5, shippingCost: 2, inventory: 150, usInventory: 20, rating: 4.8, reviewCount: 30, deliveryDays: 6, trending: true });
  assert.equal(scored.landedCost, 7);
  assert.ok(scored.suggestedRetail > scored.landedCost);
  assert.ok(scored.score <= 100);
  assert.ok(scored.score > 0);
});

test("CJ requests use one shared token acquisition and never put keys in URL", async () => {
  let calls = 0;
  const fakeFetch = async (url, options) => {
    calls++;
    if (url.endsWith("getAccessToken")) return Response.json({ result: true, data: { accessToken: "access-only-test", refreshToken: "refresh-only-test", accessTokenExpiryDate: 180 } });
    assert.equal(options.headers["CJ-Access-Token"], "access-only-test");
    return Response.json({ result: true, data: [] });
  };
  const cj = new CjClient({ apiKey: "test-key", baseUrl: "https://cj.example/api", minIntervalMs: 0, fetchImpl: fakeFetch });
  await Promise.all([cj.call("/product/listV2"), cj.call("/product/listV2")]);
  assert.equal(calls, 3);
  assert.equal(cj.token, "access-only-test");
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
    cj: { call: async (path) => { cjCalls++; assert.equal(path, "/product/getCategory"); return { data: ["private-category-data"] }; } },
  });
  assert.equal(result.httpStatus, 200);
  assert.equal(result.body.status, "healthy");
  assert.deepEqual(Object.keys(result.body.checks), ["server", "supabase", "cj"]);
  assert.equal(JSON.stringify(result.body).includes("private-category-data"), false);
  assert.equal(supabaseCalls, 1);
  assert.equal(cjCalls, 1);
});

test("connectivity diagnostic sanitizes failed provider connections", async () => {
  const result = await runConnectivityDiagnostic({
    authorization: "Bearer test_only_diagnostic_token_0123456789",
    diagnosticToken: "test_only_diagnostic_token_0123456789",
    supabase: { checkConnectivity: async () => { throw new Error("sensitive URL and secret details"); } },
    cj: { call: async () => { throw new Error("private CJ token detail"); } },
  });
  const responseText = JSON.stringify(result.body);
  assert.equal(result.httpStatus, 503);
  assert.equal(result.body.status, "degraded");
  assert.equal(result.body.checks.supabase.status, "error");
  assert.equal(result.body.checks.cj.status, "error");
  assert.equal(responseText.includes("sensitive URL"), false);
  assert.equal(responseText.includes("private CJ token"), false);
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
