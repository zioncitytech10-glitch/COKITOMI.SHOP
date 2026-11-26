export class SupabaseService {
  constructor({ url, publishableKey, serviceRoleKey, fetchImpl = fetch }) {
    this.url = url;
    this.publishableKey = publishableKey;
    this.serviceRoleKey = serviceRoleKey;
    this.fetchImpl = fetchImpl;
  }

  async verifyAdmin(authorization, allowedIds) {
    if (!authorization?.startsWith("Bearer ")) return null;

    const jwt = authorization.slice(7);

    const response = await this.fetchImpl(`${this.url}/auth/v1/user`, {
      headers: {
        apikey: this.publishableKey,
        Authorization: `Bearer ${jwt}`,
      },
      signal: AbortSignal.timeout(10000),
    }).catch(() => null);

    if (!response?.ok) return null;

    const user = await response.json().catch(() => null);

    return user?.id && allowedIds.has(user.id)
      ? { id: user.id }
      : null;
  }

  async #db(path, { method = "GET", body, query = "", exactCount = false } = {}) {
    const isModernApiKey =
      this.serviceRoleKey.startsWith("sb_secret_") ||
      this.serviceRoleKey.startsWith("sb_publishable_");

    let response;

    try {
      response = await this.fetchImpl(
        `${this.url}/rest/v1/${path}${query}`,
        {
          method,
          headers: {
            apikey: this.serviceRoleKey,
            ...(!isModernApiKey
              ? { Authorization: `Bearer ${this.serviceRoleKey}` }
              : {}),
            "Content-Type": "application/json",
            Prefer: exactCount
              ? "count=exact"
              : method === "POST" && path.startsWith("product_recommendations")
                ? "resolution=merge-duplicates,return=representation"
                : "return=representation",
            ...(exactCount ? { Range: "0-0" } : {}),
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
          signal: AbortSignal.timeout(20000),
        }
      );
    } catch (cause) {
      const timeoutFailure =
        cause?.name === "TimeoutError" ||
        cause?.name === "AbortError";

      const error = new Error(
        timeoutFailure
          ? "Supabase request timed out"
          : "Supabase network request failed"
      );

      error.timeoutFailure = timeoutFailure;
      error.networkFailure = !timeoutFailure;

      throw error;
    }

    if (!response.ok) {
      let providerCode = null;

      try {
        const payload = await response.clone().json();

        if (
          typeof payload?.code === "string" &&
          /^[A-Z0-9_-]{1,32}$/.test(payload.code)
        ) {
          providerCode = payload.code;
        }
      } catch {
        // Provider response text is intentionally not retained or logged.
      }

      const error = new Error("Supabase database request failed");
      error.httpStatus = response.status;
      error.providerCode = providerCode;

      throw error;
    }

    if (response.status === 204) {
      return exactCount ? { data: [], count: 0 } : [];
    }

    try {
      const data = await response.json();

      if (!exactCount) return data;

      const contentRange = response.headers.get("content-range") || "";
      const total = contentRange.match(/\/(\d+|\*)$/)?.[1];

      return {
        data,
        count: total && total !== "*" ? Number(total) : null,
      };
    } catch {
      const error = new Error("Supabase returned an invalid response");
      error.httpStatus = response.status;
      error.protocolFailure = true;

      throw error;
    }
  }

  async saveRecommendations(rows) {
    // Merge by CJ product ID; preserve prior review status and admin decision.
    return this.#db("product_recommendations?on_conflict=cj_product_id", {
      method: "POST",
      body: rows.map(({ status, ...row }) => row),
      query: "",
    });
  }

  async checkConnectivity() {
    return this.#db("products?select=id&limit=1");
  }

  async getAdminOverview() {
    const count = async (path) => {
      try {
        const result = await this.#db(path, { exactCount: true });

        return Number.isSafeInteger(result.count) && result.count >= 0
          ? { status: "available", value: result.count }
          : { status: "unavailable", value: null };
      } catch {
        return { status: "unavailable", value: null };
      }
    };

    const [
      products,
      activeProducts,
      orders,
      customers,
      pendingRecommendations,
    ] = await Promise.all([
      count("products?select=id&limit=1"),
      count("products?select=id&is_active=eq.true&limit=1"),
      count("orders?select=id&limit=1"),
      count("customer_profiles?select=id&limit=1"),
      count("product_recommendations?select=id&status=eq.pending&limit=1"),
    ]);

    return {
      catalogue: {
        total: products,
        active: activeProducts,
      },
      orders: {
        total: orders,
      },
      customers: {
        total: customers,
      },
      recommendations: {
        pending: pendingRecommendations,
      },
      revenue: {
        status: "unavailable",
        value: null,
        reason: "Payment processing is not enabled; verified revenue data is unavailable.",
      },
    };
  }

  async listRecommendations(status = "pending", limit = 100) {
    const params = new URLSearchParams({
      select: "*",
      status: `eq.${status}`,
      order: "commercial_score.desc",
      limit: String(limit),
    });

    return this.#db(`product_recommendations?${params}`);
  }

  async updateRecommendation(id, status, reviewerId, notes) {
    return this.#db("rpc/review_product_recommendation", {
      method: "POST",
      body: {
        p_recommendation_id: id,
        p_status: status,
        p_reviewer_id: reviewerId,
        p_review_notes: notes || null,
      },
    });
  }

  async listProducts(limit = 200) {
    const params = new URLSearchParams({
      select: "id,supplier,supplier_product_id,slug,name,description,detail_description,price,currency,image_url,gallery_urls,collection_ids,stock_quantity,is_active,created_at,updated_at",
      order: "id.asc",
      limit: String(limit),
    });

    const products = await this.#db(`products?${params}`);

    if (!products.length) return [];

    const ids = products
      .map((product) => product.id)
      .filter(Number.isSafeInteger);

    const recParams = new URLSearchParams({
      select: "id,cj_product_id,cj_variant_id,variant_data,supplier_data,supplier_price,shipping_cost,delivery_days,inventory,us_inventory,estimated_landed_cost,estimated_profit,estimated_margin,published_product_id,published_at",
      published_product_id: `in.(${ids.join(",")})`,
    });

    const research = ids.length
      ? await this.#db(`product_recommendations?${recParams}`)
      : [];

    const byProduct = new Map(
      research.map((row) => [
        Number(row.published_product_id),
        row,
      ])
    );

    return products.map((product) => {
      const linked = byProduct.get(Number(product.id));

      return {
        ...product,

        supplier_research: linked
          ? {
              cj_product_id: linked.cj_product_id,
              cj_variant_id: linked.cj_variant_id,

              variants: Array.isArray(linked.variant_data?.variants)
                ? linked.variant_data.variants
                : [],

              supplier_price: linked.supplier_price,
              price_verified: linked.supplier_data?.price_verified === true,
              supplier_data: linked.supplier_data,
              shipping_cost: linked.shipping_cost,
              delivery_days: linked.delivery_days,
              inventory: linked.inventory,
              us_inventory: linked.us_inventory,
              estimated_landed_cost: linked.estimated_landed_cost,
              estimated_profit: linked.estimated_profit,
              estimated_margin: linked.estimated_margin,
              published_at: linked.published_at,
            }
          : null,
      };
    });
  }

  // Create a manually entered product.
  async createProduct(product) {
    const params = new URLSearchParams({
      select: "id,supplier,supplier_product_id,slug,name,description,detail_description,price,currency,image_url,gallery_urls,collection_ids,stock_quantity,is_active,created_at,updated_at",
    });

    const rows = await this.#db(`products?${params}`, {
      method: "POST",
      body: product,
    });

    return rows[0] || null;
  }

  // Delete a product by its database ID.
  async deleteProduct(id) {
    const params = new URLSearchParams({
      id: `eq.${id}`,
      select: "id",
    });

    const rows = await this.#db(`products?${params}`, {
      method: "DELETE",
    });

    return rows[0] || null;
  }

  // Edit an existing product.
  async updateProduct(id, changes) {
    const params = new URLSearchParams({
      id: `eq.${id}`,
      select: "id,supplier,supplier_product_id,slug,name,description,detail_description,price,currency,image_url,gallery_urls,collection_ids,stock_quantity,is_active,created_at,updated_at",
    });

    const rows = await this.#db(`products?${params}`, {
      method: "PATCH",
      body: {
        ...changes,
        updated_at: new Date().toISOString(),
      },
    });

    return rows[0] || null;
  }

  // Publish an approved CJ supplier recommendation.
  async publishRecommendation(id, { slug, price, collectionIds = [] }) {
    const rows = await this.#db("rpc/publish_product_recommendation", {
      method: "POST",
      body: {
        p_recommendation_id: id,
        p_slug: slug,
        p_price: price,
        p_collection_ids: collectionIds,
      },
    });

    return Array.isArray(rows) ? rows[0] || null : rows;
  }
}