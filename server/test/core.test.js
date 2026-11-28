import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { scoreCandidate } from "../src/scoring.js";
import { CjClient } from "../src/cj-client.js";
import { SupabaseService } from "../src/supabase.js";
import { loadConfig } from "../src/config.js";
import { runConnectivityDiagnostic } from "../src/diagnostics.js";
import { authenticateAdmin, getAdminOverviewResponse } from "../src/admin-dashboard.js";
import { ProductDiscovery } from "../src/discovery.js";
import { validateProductChanges, validatePublishRequest } from "../src/product-management.js";
import { logoutAndRedirect } from "../../admin-session.js";

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

test("CJ research preserves every returned variant and its available fields using mocked responses", async () => {
  const stockLookups = [];
  let saved;
  const cj = { async call(path, options = {}) {
    if (path === "/product/listV2") return { data: [{ pid: "cj-bear-1", productNameEn: "Mock teddy" }] };
    if (path === "/product/productDetail/query") return { data: {
      productNameEn: "Mock teddy", bigImage: "https://images.example/bear.jpg", productImageSet: ["https://images.example/bear.jpg", "https://images.example/gallery.jpg"],
      variants: [
        { vid: "variant-a", variantName: "Brown · Small", variantSku: "SKU-A", variantSellPrice: 4.25, variantInventory: 12, usInventory: 5, variantImage: "https://images.example/a.jpg" },
        { vid: "variant-b", variantName: "Cream · Large", variantSku: "SKU-B", variantSellPrice: 6.5, variantImage: "https://images.example/b.jpg" },
      ],
    } };
    if (path === "/product/stock/queryByVid") {
      const vid = options.query.vid; stockLookups.push(vid);
      return { data: [{ countryCode: "US", warehouseName: "US warehouse", totalInventoryNum: 8 }, { countryCode: "CN", warehouseName: "China warehouse", totalInventoryNum: 20 }] };
    }
    if (path === "/product/productComments") return { data: [], total: 0 };
    if (path === "/logistic/freightCalculateTip") return { data: [] };
    throw new Error(`Unexpected mocked CJ path ${path}`);
  } };
  const discovery = new ProductDiscovery({
    cj, config: { maxCandidates: 1, retailMultiplier: 2.5, paymentFeeRate: 0.03 },
    supabase: { async saveRecommendations(rows) { saved = rows; } },
  });
  const result = await discovery.research({ keywords: ["teddy bear"], productFlags: [0] });
  assert.deepEqual(result, { searched: 1, saved: 1 });
  assert.deepEqual(stockLookups, ["variant-b"]);
  const variants = saved[0].variant_data.variants;
  assert.equal(variants.length, 2);
  assert.deepEqual(variants.map(({ id, name, price, stock, us_stock }) => ({ id, name, price, stock, us_stock })), [
    { id: "variant-a", name: "Brown · Small", price: 4.25, stock: 12, us_stock: 5 },
    { id: "variant-b", name: "Cream · Large", price: 6.5, stock: 28, us_stock: 8 },
  ]);
  assert.equal(variants[1].image_url, "https://images.example/b.jpg");
  assert.equal(variants[1].stock_verified, true);
  assert.equal(variants[1].us_stock_verified, true);
  assert.equal(saved[0].image_url, "https://images.example/bear.jpg");
  assert.deepEqual(saved[0].gallery, ["https://images.example/bear.jpg", "https://images.example/gallery.jpg"]);
});

test("product management validates only editable catalogue fields and explicit publishing input", () => {
  assert.deepEqual(validateProductChanges({ name: "Updated teddy", price: 42.5, is_active: true }), { name: "Updated teddy", price: 42.5, is_active: true });
  assert.throws(() => validateProductChanges({ supplier_product_id: "cannot-change" }), { status: 400 });
  assert.throws(() => validateProductChanges({ id: 17 }), { status: 400 });
  assert.deepEqual(validatePublishRequest({ slug: "new-cj-teddy-17", price: 49.99, collection_ids: ["birthday-gifts"] }), {
    slug: "new-cj-teddy-17", price: 49.99, collectionIds: ["birthday-gifts"],
  });
  assert.throws(() => validatePublishRequest({ slug: "invalid slug", price: 40 }), { status: 400 });
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

test("CJ HTTP 429 stops immediately and applies a shared cooldown", async () => {
  const clock = fakeClock();
  let productCalls = 0;
  const fakeFetch = async (url) => {
    if (url.endsWith("getAccessToken")) return Response.json({ result: true, data: { accessToken: "test-access", refreshToken: "test-refresh", accessTokenExpiryDate: "2099-01-01T00:00:00Z" } });
    productCalls++;
    return Response.json({ code: 1600200, result: false, message: "private rate limit response" }, { status: 429, headers: { "Retry-After": "3" } });
  };
  const cj = new CjClient({ apiKey: "test-key", baseUrl: "https://cj.example/api", minIntervalMs: 2000, fetchImpl: fakeFetch, nowImpl: clock.now, sleepImpl: clock.sleep });
  await assert.rejects(cj.call("/product/listV2"), (error) => error.rateLimited === true);
  assert.equal(productCalls, 1);
  assert.ok(cj.cooldownUntil >= clock.now() + 3000);
});

test("CJ code 1600200 is not retried automatically; auth and parameter errors also stop", async () => {
  for (const code of [1600200, 1600005, 1600300]) {
    const clock = fakeClock();
    let calls = 0;
    const fakeFetch = async (url) => {
      if (url.endsWith("getAccessToken")) return Response.json({ result: true, data: { accessToken: "test-access", refreshToken: "test-refresh", accessTokenExpiryDate: "2099-01-01T00:00:00Z" } });
      calls++;
      return Response.json({ code, result: false, message: "private provider response" }, { status: code === 1600200 ? 429 : 200 });
    };
    const cj = new CjClient({ apiKey: "test-key", baseUrl: "https://cj.example/api", minIntervalMs: 2000, fetchImpl: fakeFetch, nowImpl: clock.now, sleepImpl: clock.sleep });
    await assert.rejects(cj.call("/product/listV2"));
    assert.equal(calls, 1);
  }
});

test("CJ rate-limit cooldown prevents a second immediate request", async () => {
  const clock = fakeClock();
  let calls = 0;
  const fakeFetch = async (url) => {
    if (url.endsWith("getAccessToken")) return Response.json({ result: true, data: { accessToken: "test-access", refreshToken: "test-refresh", accessTokenExpiryDate: "2099-01-01T00:00:00Z" } });
    calls++;
    if (calls === 1) return Response.json({ code: 1600200, result: false }, { status: 429 });
    return Response.json({ result: true, data: [] });
  };
  const cj = new CjClient({ apiKey: "test-key", baseUrl: "https://cj.example/api", minIntervalMs: 2000, fetchImpl: fakeFetch, nowImpl: clock.now, sleepImpl: clock.sleep });
  await assert.rejects(cj.call("/product/listV2"));
  await cj.call("/product/listV2");
  assert.equal(calls, 2);
  assert.ok(clock.sleeps.some((value) => value >= 60_000));
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
  let authRequests = 0;
  const supabase = new SupabaseService({ url: "https://example.supabase.co", publishableKey: "public-test", serviceRoleKey: "server-test", fetchImpl: async (_url, options) => {
    authRequests += 1;
    assert.equal(options.headers.Authorization, "Bearer signed-test-jwt");
    return Response.json({ id });
  } });
  assert.equal(await supabase.verifyAdmin(undefined, new Set([id])), null);
  assert.equal(authRequests, 0);
  assert.deepEqual(await supabase.verifyAdmin("Bearer signed-test-jwt", new Set([id])), { id });
  assert.equal(await supabase.verifyAdmin("Bearer signed-test-jwt", new Set()), null);
  assert.equal(authRequests, 2);
});

test("admin logout clears the local session and redirects to the login route", async () => {
  let session = { access_token: "test-access-token" };
  let scope;
  let redirectPath;
  const result = await logoutAndRedirect({ auth: { async signOut(options) {
    scope = options.scope;
    session = null;
    return { error: null };
  } } }, "/COKITOMI.SHOP/admin.html", (path) => { redirectPath = path; });

  assert.equal(scope, "local");
  assert.equal(session, null);
  assert.equal(result.remoteLogoutFailed, false);
  assert.equal(redirectPath, "/COKITOMI.SHOP/admin.html?logout=success");
});

test("admin logout remains locally cleared and visibly warns when remote logout fails", async () => {
  let session = { access_token: "test-access-token" };
  let redirectPath;
  const result = await logoutAndRedirect({ auth: { async signOut(options) {
    assert.equal(options.scope, "local");
    session = null;
    return { error: new Error("private simulated network failure") };
  } } }, "/COKITOMI.SHOP/admin.html", (path) => { redirectPath = path; });

  assert.equal(session, null);
  assert.equal(result.remoteLogoutFailed, true);
  assert.equal(redirectPath, "/COKITOMI.SHOP/admin.html?logout=warning");
});

test("admin logout still redirects with a safe warning when remote logout throws", async () => {
  let session = { access_token: "test-access-token" };
  let redirectPath;
  const result = await logoutAndRedirect({ auth: { async signOut(options) {
    assert.equal(options.scope, "local");
    session = null;
    throw new Error("private simulated network failure");
  } } }, "/admin.html", (path) => { redirectPath = path; });

  assert.equal(session, null);
  assert.equal(result.remoteLogoutFailed, true);
  assert.equal(redirectPath, "/admin.html?logout=warning");
});
test("protected overview rejects missing post-logout tokens and expired or invalid sessions", async () => {
  let authValidations = 0;
  let dashboardReads = 0;
  let localSession = { access_token: "test-access-token" };
  await logoutAndRedirect({ auth: { async signOut() { localSession = null; return { error: null }; } } }, "/admin.html", () => {});
  const supabase = new SupabaseService({
    url: "https://example.supabase.co",
    publishableKey: "public-test",
    serviceRoleKey: "server-test",
    fetchImpl: async () => {
      authValidations += 1;
      return Response.json({ message: "invalid session" }, { status: 401 });
    },
  });
  supabase.getAdminOverview = async () => { dashboardReads += 1; return {}; };
  const adminUserIds = new Set(["admin-uuid"]);

  const postLogoutAuthorization = localSession?.access_token ? `Bearer ${localSession.access_token}` : undefined;
  assert.equal(postLogoutAuthorization, undefined);
  for (const authorization of [postLogoutAuthorization, "Bearer expired-session", "Bearer invalid-session"]) {
    const result = await getAdminOverviewResponse({ authorization, adminUserIds, supabase });
    assert.equal(result.httpStatus, 401);
  }
  assert.equal(authValidations, 2);
  assert.equal(dashboardReads, 0);
});

test("admin overview rejects unauthenticated and non-admin users before reading dashboard data", async () => {
  let dashboardReads = 0;
  const authCalls = [];
  const supabase = new SupabaseService({
    url: "https://example.supabase.co",
    publishableKey: "public-test",
    serviceRoleKey: "server-test",
    fetchImpl: async (url, options) => {
      authCalls.push({ url, authorization: options.headers.Authorization });
      const id = options.headers.Authorization === "Bearer valid-admin" ? "admin-uuid" : "non-admin-uuid";
      return Response.json({ id });
    },
  });
  supabase.getAdminOverview = async () => { dashboardReads += 1; return {}; };
  const adminUserIds = new Set(["admin-uuid"]);
  const noToken = await getAdminOverviewResponse({ authorization: undefined, adminUserIds, supabase });
  assert.equal(noToken.httpStatus, 401);
  assert.equal(authCalls.length, 0);

  const denied = await getAdminOverviewResponse({ authorization: "Bearer valid-user", adminUserIds, supabase });
  assert.equal(denied.httpStatus, 401);
  assert.deepEqual(denied.body, { error: "Administrator access required" });
  assert.equal(dashboardReads, 0);

  const allowed = await getAdminOverviewResponse({ authorization: "Bearer valid-admin", adminUserIds, supabase });
  assert.equal(allowed.httpStatus, 200);
  assert.equal(allowed.body.admin.id, "admin-uuid");
  assert.equal(dashboardReads, 1);
  assert.equal(authCalls.length, 2);
});

test("shared admin route authorization denies missing and non-admin sessions and accepts the allowlisted user", async () => {
  const calls = [];
  const supabase = { async verifyAdmin(authorization, allowedIds) {
    calls.push({ authorization, allowedIds });
    if (authorization === "Bearer admin-token" && allowedIds.has("admin-uuid")) return { id: "admin-uuid" };
    return null;
  } };
  const adminUserIds = new Set(["admin-uuid"]);
  assert.equal(await authenticateAdmin({ authorization: undefined, adminUserIds, supabase }), null);
  assert.equal(await authenticateAdmin({ authorization: "Bearer customer-token", adminUserIds, supabase }), null);
  assert.deepEqual(await authenticateAdmin({ authorization: "Bearer admin-token", adminUserIds, supabase }), { id: "admin-uuid" });
  assert.equal(calls.length, 3);
});

test("dashboard counts use exact database counts and unavailable revenue is explicit", async () => {
  const requested = [];
  const supabase = new SupabaseService({
    url: "https://example.supabase.co",
    publishableKey: "public-test",
    serviceRoleKey: "sb_secret_test_only_value",
    fetchImpl: async (url, options) => {
      requested.push({ url, headers: options.headers });
      if (url.includes("customer_profiles")) return new Response("", { status: 403 });
      return new Response("[{\"id\":1}]", { status: 200, headers: { "Content-Range": "0-0/4", "Content-Type": "application/json" } });
    },
  });
  const overview = await supabase.getAdminOverview();
  assert.deepEqual(overview.catalogue.total, { status: "available", value: 4 });
  assert.deepEqual(overview.catalogue.active, { status: "available", value: 4 });
  assert.deepEqual(overview.orders.total, { status: "available", value: 4 });
  assert.deepEqual(overview.customers.total, { status: "unavailable", value: null });
  assert.deepEqual(overview.revenue, {
    status: "unavailable",
    value: null,
    reason: "Payment processing is not enabled; verified revenue data is unavailable.",
  });
  assert.ok(requested.every(({ headers }) => headers.apikey === "sb_secret_test_only_value"));
  assert.ok(requested.every(({ url }) => !url.includes("example@email") && !url.includes("Bearer")));
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

test("admin product listing joins only linked CJ research data and edits through the service-role client", async () => {
  const requests = [];
  const supabase = new SupabaseService({
    url: "https://example.supabase.co", publishableKey: "public-test", serviceRoleKey: "server-test",
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      if (url.includes("/products?")) return Response.json([
        { id: 7, slug: "cj-teddy", name: "CJ Teddy", supplier_product_id: "cj-7", price: 45, collection_ids: [], is_active: true },
        { id: 8, slug: "cj-teddy-2", name: "CJ Teddy 2", supplier_product_id: "cj-8", price: 45, collection_ids: [], is_active: true },
        { id: 9, slug: "cj-teddy-3", name: "CJ Teddy 3", supplier_product_id: "cj-9", price: 45, collection_ids: [], is_active: true },
      ]);
      if (url.includes("product_recommendations?")) return Response.json([
        { published_product_id: 7, cj_product_id: "cj-7", cj_variant_id: "variant-7", variant_data: { variants: [{ id: "variant-7" }] }, supplier_data: { price_verified: true }, supplier_price: 10, shipping_cost: 2, delivery_days: 8, inventory: 12, us_inventory: 4, estimated_landed_cost: 12, estimated_profit: 30, estimated_margin: 0.66 },
        { published_product_id: 8, cj_product_id: "cj-8", variant_data: { variants: [] }, supplier_data: { price_verified: false }, supplier_price: 0, shipping_cost: null },
        { published_product_id: 9, cj_product_id: "cj-9", variant_data: { variants: [] }, supplier_price: 0, shipping_cost: null },
      ]);
      return Response.json([{ id: 7, name: "Changed" }]);
    },
  });
  const listed = await supabase.listProducts();
  assert.equal(listed[0].supplier_research.cj_product_id, "cj-7");
  assert.deepEqual(listed[0].supplier_research.variants, [{ id: "variant-7" }]);
  assert.equal(listed[0].supplier_research.price_verified, true);
  assert.equal(listed[0].supplier_research.supplier_price, 10);
  assert.equal(listed[1].supplier_research.price_verified, false, "unverified supplier prices must remain marked unverified");
  assert.equal(listed[2].supplier_research.price_verified, false, "missing supplier_data must not be treated as verified");
  const recommendationRequest = requests.find(({ url }) => url.includes("product_recommendations?"));
  assert.match(recommendationRequest.url, /supplier_data/);
  const updated = await supabase.updateProduct(7, { name: "Changed" });
  assert.equal(updated.id, 7);
  assert.ok(requests.every(({ options }) => options.headers.apikey === "server-test"));
  assert.ok(requests.some(({ url, options }) => url.includes("products?id=eq.7") && options.method === "PATCH"));
});

test("recommendation review and explicit publish use private service-role RPCs", async () => {
  const calls = [];
  const supabase = new SupabaseService({
    url: "https://example.supabase.co", publishableKey: "public-test", serviceRoleKey: "server-test",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith("/rpc/review_product_recommendation")) {
        const body = JSON.parse(options.body);
        return Response.json({ id: body.p_recommendation_id, status: body.p_status });
      }
      return Response.json({ id: 9, supplier_product_id: "cj-9", is_active: true });
    },
  });
  const reviewed = await supabase.updateRecommendation("rec-1", "approved", "admin-1", null);
  assert.equal(reviewed.status, "approved");
  assert.equal(calls.length, 1, "approval alone does not call the publish RPC");
  const published = await supabase.publishRecommendation("rec-1", { slug: "cj-bear", price: 49.99, collectionIds: [] });
  assert.equal(published.id, 9);
  assert.ok(calls[0].url.endsWith("/rpc/review_product_recommendation"));
  assert.deepEqual(JSON.parse(calls[0].options.body), { p_recommendation_id: "rec-1", p_status: "approved", p_reviewer_id: "admin-1", p_review_notes: null });
  assert.ok(calls[1].url.endsWith("/rpc/publish_product_recommendation"));
  assert.deepEqual(JSON.parse(calls[1].options.body), { p_recommendation_id: "rec-1", p_slug: "cj-bear", p_price: 49.99, p_collection_ids: [] });
  const rejected = await supabase.updateRecommendation("rec-2", "rejected", "admin-1", "Not suitable");
  assert.equal(rejected.status, "rejected");
  assert.deepEqual(JSON.parse(calls[2].options.body), { p_recommendation_id: "rec-2", p_status: "rejected", p_reviewer_id: "admin-1", p_review_notes: "Not suitable" });
});

test("database migration preserves published products on rejection and safely gates inventory", async () => {
  const migration = await readFile(new URL("../../supabase/migrations/202611150002_stage2_product_management.sql", import.meta.url), "utf8");
  assert.match(migration, /select \* into rec from public\.product_recommendations where id = p_recommendation_id for update/i);
  assert.match(migration, /if rec\.status <> 'approved' then/i);
  assert.match(migration, /where supplier_product_id = rec\.cj_product_id for update/i);
  assert.match(migration, /prevent_rejected_recommendation_activation/i);
  assert.doesNotMatch(migration, /drop trigger\s+if exists/i, "migration must preserve existing trigger objects");
  assert.match(migration, /create trigger stage2_prevent_rejected_recommendation_activation/i);
  assert.match(migration, /if tg_op = 'INSERT' then[\s\S]*elsif tg_op = 'UPDATE' then/i, "insert and update trigger behavior must be handled explicitly");
  assert.match(migration, /old\.is_active is not true and new\.is_active is true/i, "updates are rejected only when activating an inactive product");
  assert.equal((migration.match(/set search_path = pg_catalog, public, pg_temp/gi) || []).length, 3, "all security-definer functions use a pinned safe search path");
  assert.match(migration, /unique index if not exists product_recommendations_published_product_uidx/i);
  const reviewFunction = migration.split("create or replace function public.review_product_recommendation(")[1].split("create or replace function public.publish_product_recommendation(")[0];
  assert.doesNotMatch(reviewFunction, /update public\.products/i, "rejecting a recommendation must not change its linked product");
  assert.match(migration, /jsonb_typeof\(rec\.supplier_data->'inventory_verified'\) = 'boolean'[\s\S]*rec\.supplier_data->'inventory_verified' = 'true'::jsonb[\s\S]*else null/i);
  assert.doesNotMatch(migration, /\(rec\.supplier_data->>'inventory_verified'\)::boolean/i, "malformed supplier values must never be cast to boolean");
  assert.match(migration, /grant execute on function public\.publish_product_recommendation[\s\S]*to service_role/i);
});

test("Stage 2 preflight uses only static read-only SQL and handles an absent publication column", async () => {
  const preflight = await readFile(new URL("../../supabase/preflight_stage2_product_management.sql", import.meta.url), "utf8");
  const executableText = preflight.replace(/--.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(executableText, /\b(?:query_to_xml|xpath|execute|do)\s*\(/i);
  assert.doesNotMatch(executableText, /(?:^|\n)\s*(?:insert|update|delete|truncate|alter|drop|create|grant|revoke|call|do)\b/i);
  assert.match(preflight, /pg_catalog\.to_jsonb\(r\)->>'published_product_id'/i);
  assert.match(preflight, /when not column_exists then 'PASS'/i);
  assert.match(preflight, /Migration ledger exists and has a version column, but this read-only preflight does not inspect version rows/i);
  assert.match(preflight, /overall_status/i);
  const indexCheck = preflight.split("published_index_check as (")[1].split("published_index_checks as (")[0];
  assert.match(indexCheck, /select c\.oid as object_oid, c\.relkind, c\.indexrelid, c\.indrelid/i);
  assert.doesNotMatch(indexCheck, /select c\.oid as object_oid, c\.relkind, i\./i, "the outer index CTE must use the exposed c alias");
  assert.match(preflight, /e\.data_type in \('numeric','decimal'\)[\s\S]*a\.numeric_precision[\s\S]*a\.numeric_scale/i);
  assert.doesNotMatch(preflight, /or a\.numeric_precision is distinct from e\.numeric_precision\s+or a\.numeric_scale is distinct from e\.numeric_scale/i, "integer precision metadata must not cause a type mismatch");
  assert.match(preflight, /pg_catalog\.oidvectortypes\(p\.proargtypes\)/i);
  assert.doesNotMatch(preflight, /p\.proargtypes::oid\[\]\s*=\s*e\.argument_oids/i, "function signatures must not depend on array bounds");
  for (const diagnosticField of ["expected identity arguments", "existing identity arguments", "existing argument types", "existing return type", "owner=", "security_definer=", "search_path=", "grants="]) {
    assert.ok(preflight.includes(diagnosticField), `function diagnostics should show ${diagnosticField}`);
  }
  assert.match(preflight, /kind=' \|\| prokind::text/i, "catalog internal-char fields must be cast before text concatenation");
  assert.doesNotMatch(preflight, /\|\|\s*prokind\b(?!\s*::text)/i, "prokind must not be concatenated without an explicit text cast");
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
