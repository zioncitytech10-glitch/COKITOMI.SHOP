import test from "node:test";
import assert from "node:assert/strict";
import { SupabaseService } from "../src/supabase.js";

const USER_A = "00000000-0000-4000-8000-000000000001";
const USER_B = "00000000-0000-4000-8000-000000000002";
const ORDER_A = "10000000-0000-4000-8000-000000000001";

function serviceWith(fetchImpl) {
  return new SupabaseService({
    url: "https://example.supabase.co",
    publishableKey: "test-publishable",
    serviceRoleKey: "test-service-role",
    fetchImpl,
  });
}

test("order listing applies pagination, status and safely cleaned search", async () => {
  let request;
  const service = serviceWith(async (url, options) => {
    request = { url: new URL(url), options };
    return Response.json([{ id: ORDER_A, order_number: "CK-1001", status: "paid" }]);
  });

  const rows = await service.listOrders({
    limit: 25,
    offset: 50,
    status: "paid",
    search: "CK-1001,(*",
  });

  assert.equal(rows.length, 1);
  assert.equal(request.url.pathname, "/rest/v1/orders");
  assert.equal(request.url.searchParams.get("limit"), "25");
  assert.equal(request.url.searchParams.get("offset"), "50");
  assert.equal(request.url.searchParams.get("status"), "eq.paid");
  assert.equal(
    request.url.searchParams.get("or"),
    "(order_number.ilike.*CK-1001*,email.ilike.*CK-1001*)",
  );
  assert.equal(request.options.headers.apikey, "test-service-role");
  assert.equal(request.options.headers.Authorization, "Bearer test-service-role");
});

test("order listing omits optional filters when none are supplied", async () => {
  let requestUrl;
  const service = serviceWith(async (url) => {
    requestUrl = new URL(url);
    return Response.json([]);
  });

  assert.deepEqual(await service.listOrders(), []);
  assert.equal(requestUrl.searchParams.get("limit"), "50");
  assert.equal(requestUrl.searchParams.get("offset"), "0");
  assert.equal(requestUrl.searchParams.has("status"), false);
  assert.equal(requestUrl.searchParams.has("or"), false);
});

test("order listing rejects invalid pagination, status and search types before network access", async () => {
  let calls = 0;
  const service = serviceWith(async () => {
    calls++;
    return Response.json([]);
  });

  await assert.rejects(service.listOrders({ limit: 0 }), TypeError);
  await assert.rejects(service.listOrders({ limit: 101 }), TypeError);
  await assert.rejects(service.listOrders({ offset: -1 }), TypeError);
  await assert.rejects(service.listOrders({ limit: 1.5 }), TypeError);
  await assert.rejects(service.listOrders({ status: "made_up" }), TypeError);
  await assert.rejects(service.listOrders({ search: 123 }), TypeError);
  assert.equal(calls, 0);
});

test("order detail returns the order with its purchased items", async () => {
  const calls = [];
  const service = serviceWith(async (url) => {
    calls.push(new URL(url));
    if (url.includes("/orders?")) {
      return Response.json([{
        id: ORDER_A,
        user_id: USER_A,
        order_number: "CK-1001",
        status: "paid",
        shipping_address: { city: "Lagos" },
      }]);
    }
    if (url.includes("/order_items?")) {
      return Response.json([
        { id: 1, order_id: ORDER_A, product_name: "Classic Teddy", quantity: 2, line_total: 40 },
      ]);
    }
    throw new Error("Unexpected table request");
  });

  const order = await service.getOrder(ORDER_A);
  assert.equal(order.order_number, "CK-1001");
  assert.equal(order.shipping_address.city, "Lagos");
  assert.equal(order.items.length, 1);
  assert.equal(order.items[0].product_name, "Classic Teddy");
  assert.equal(calls.length, 2);
  assert.equal(calls[1].searchParams.get("order_id"), `eq.${ORDER_A}`);
});

test("order detail returns null and does not query line items when order is missing", async () => {
  let calls = 0;
  const service = serviceWith(async () => {
    calls++;
    return Response.json([]);
  });

  assert.equal(await service.getOrder(ORDER_A), null);
  assert.equal(calls, 1);
});

test("order detail rejects malformed IDs before network access", async () => {
  let calls = 0;
  const service = serviceWith(async () => {
    calls++;
    return Response.json([]);
  });

  await assert.rejects(service.getOrder("not-a-uuid"), TypeError);
  assert.equal(calls, 0);
});

test("customer listing uses exact order counts and latest order metadata", async () => {
  const calls = [];
  const service = serviceWith(async (url, options) => {
    const parsed = new URL(url);
    calls.push({ url: parsed, headers: options.headers });
    if (parsed.pathname.endsWith("/customer_profiles")) {
      return Response.json([
        { id: USER_A, full_name: "Ada Customer", phone: "08010000001" },
        { id: USER_B, full_name: "Ben Customer", phone: "08020000002" },
      ]);
    }
    if (parsed.pathname.endsWith("/orders")) {
      const userId = parsed.searchParams.get("user_id");
      const row = userId === `eq.${USER_A}`
        ? { user_id: USER_A, email: "ada@example.com", created_at: "2026-11-20T10:00:00Z" }
        : { user_id: USER_B, email: "ben@example.com", created_at: "2026-11-19T10:00:00Z" };
      const count = userId === `eq.${USER_A}` ? 1250 : 1;
      return new Response(JSON.stringify([row]), {
        headers: { "Content-Type": "application/json", "Content-Range": `0-0/${count}` },
      });
    }
    throw new Error("Unexpected table request");
  });

  const customers = await service.listCustomers({ limit: 20, offset: 10, search: "Ada" });
  assert.equal(customers.length, 2);
  assert.equal(customers[0].email, "ada@example.com");
  assert.equal(customers[0].order_count, 1250);
  assert.equal(customers[0].latest_order_at, "2026-11-20T10:00:00Z");
  assert.equal(customers[1].email, "ben@example.com");
  assert.equal(customers[1].order_count, 1);

  assert.equal(calls[0].url.searchParams.get("limit"), "20");
  assert.equal(calls[0].url.searchParams.get("offset"), "10");
  assert.equal(calls[0].url.searchParams.get("or"), "(full_name.ilike.*Ada*,phone.ilike.*Ada*)");
  assert.equal(calls[1].url.searchParams.get("user_id"), `eq.${USER_A}`);
  assert.equal(calls[1].url.searchParams.get("limit"), "1");
  assert.equal(calls[1].headers.Range, "0-0");
  assert.equal(calls[2].url.searchParams.get("user_id"), `eq.${USER_B}`);
  assert.equal(calls[2].headers.Range, "0-0");
});

test("customer listing returns an empty array without querying orders when no customers exist", async () => {
  let calls = 0;
  const service = serviceWith(async () => {
    calls++;
    return Response.json([]);
  });

  assert.deepEqual(await service.listCustomers(), []);
  assert.equal(calls, 1);
});

test("customer listing rejects invalid page and search inputs before network access", async () => {
  let calls = 0;
  const service = serviceWith(async () => {
    calls++;
    return Response.json([]);
  });

  await assert.rejects(service.listCustomers({ limit: 0 }), TypeError);
  await assert.rejects(service.listCustomers({ offset: -1 }), TypeError);
  await assert.rejects(service.listCustomers({ search: {} }), TypeError);
  assert.equal(calls, 0);
});

test("customer detail returns exact order count and flags truncated history", async () => {
  let orderRequestHeaders;
  const service = serviceWith(async (url, options) => {
    if (url.includes("/customer_profiles?")) {
      return Response.json([{ id: USER_A, full_name: "Ada Customer", phone: "08010000001" }]);
    }
    if (url.includes("/orders?")) {
      orderRequestHeaders = options.headers;
      return new Response(JSON.stringify([
        { id: ORDER_A, order_number: "CK-1001", email: "ada@example.com", status: "paid", currency: "USD", total: 40, created_at: "2026-11-20T10:00:00Z" },
      ]), {
        headers: { "Content-Type": "application/json", "Content-Range": "0-0/1250" },
      });
    }
    throw new Error("Unexpected table request");
  });

  const customer = await service.getCustomer(USER_A);
  assert.equal(customer.id, USER_A);
  assert.equal(customer.email, "ada@example.com");
  assert.equal(customer.order_count, 1250);
  assert.equal(customer.orders[0].order_number, "CK-1001");
  assert.equal(customer.orders_truncated, true);
  assert.equal(orderRequestHeaders.Range, "0-99");
});

test("customer detail returns null without querying orders when profile is missing", async () => {
  let calls = 0;
  const service = serviceWith(async () => {
    calls++;
    return Response.json([]);
  });

  assert.equal(await service.getCustomer(USER_A), null);
  assert.equal(calls, 1);
});

test("customer detail rejects malformed IDs before network access", async () => {
  let calls = 0;
  const service = serviceWith(async () => {
    calls++;
    return Response.json([]);
  });

  await assert.rejects(service.getCustomer("bad-id"), TypeError);
  assert.equal(calls, 0);
});

test("customer listing limits concurrent order-summary requests to batches of ten", async () => {
  const customers = Array.from({ length: 11 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    full_name: `Customer ${index + 1}`,
    phone: null,
  }));
  let activeOrderRequests = 0;
  let maxActiveOrderRequests = 0;

  const service = serviceWith(async (url) => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith("/customer_profiles")) {
      return Response.json(customers);
    }
    if (parsed.pathname.endsWith("/orders")) {
      activeOrderRequests++;
      maxActiveOrderRequests = Math.max(maxActiveOrderRequests, activeOrderRequests);
      await new Promise((resolve) => setTimeout(resolve, 2));
      activeOrderRequests--;
      return new Response(JSON.stringify([]), {
        headers: { "Content-Type": "application/json", "Content-Range": "*/0" },
      });
    }
    throw new Error("Unexpected table request");
  });

  const result = await service.listCustomers({ limit: 20 });
  assert.equal(result.length, 11);
  assert.equal(maxActiveOrderRequests, 10);
  assert.ok(result.every((customer) => customer.order_count === 0));
});
