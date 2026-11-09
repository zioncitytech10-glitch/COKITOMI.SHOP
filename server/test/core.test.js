import test from "node:test";
import assert from "node:assert/strict";
import { scoreCandidate } from "../src/scoring.js";
import { CjClient } from "../src/cj-client.js";
import { SupabaseService } from "../src/supabase.js";

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
