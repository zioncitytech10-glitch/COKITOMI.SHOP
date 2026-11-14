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
      headers: { apikey: this.publishableKey, Authorization: `Bearer ${jwt}` },
      signal: AbortSignal.timeout(10000),
    }).catch(() => null);
    if (!response?.ok) return null;
    const user = await response.json().catch(() => null);
    return user?.id && allowedIds.has(user.id) ? { id: user.id } : null;
  }

  async #db(path, { method = "GET", body, query = "" } = {}) {
    // Modern sb_* API keys are opaque keys, not JWTs. Send them only in
    // apikey; legacy service_role keys are JWTs and continue to use both.
    const isModernApiKey = this.serviceRoleKey.startsWith("sb_secret_") || this.serviceRoleKey.startsWith("sb_publishable_");
    let response;
    try {
      response = await this.fetchImpl(`${this.url}/rest/v1/${path}${query}`, {
        method,
        headers: {
          apikey: this.serviceRoleKey,
          ...(!isModernApiKey ? { Authorization: `Bearer ${this.serviceRoleKey}` } : {}),
          "Content-Type": "application/json",
          Prefer: method === "POST" && path.startsWith("product_recommendations") ? "resolution=merge-duplicates,return=representation" : "return=representation",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(20000),
      });
    } catch {
      const error = new Error("Supabase network request failed");
      error.networkFailure = true;
      throw error;
    }
    if (!response.ok) {
      let providerCode = null;
      try {
        const payload = await response.clone().json();
        if (typeof payload?.code === "string" && /^[A-Z0-9_-]{1,32}$/.test(payload.code)) providerCode = payload.code;
      } catch { /* Provider response text is intentionally not retained or logged. */ }
      const error = new Error("Supabase database request failed");
      error.httpStatus = response.status;
      error.providerCode = providerCode;
      throw error;
    }
    if (response.status === 204) return [];
    return response.json();
  }

  async saveRecommendations(rows) {
    // Merge by CJ product ID; preserve prior review status and admin decision.
    return this.#db("product_recommendations?on_conflict=cj_product_id", {
      method: "POST", body: rows.map(({ status, ...row }) => row),
      query: "",
      // PostgREST merge-duplicates updates passed columns. Omit status so conflicts retain admin decisions.
    });
  }

  async checkConnectivity() {
    // Read at most one identifier and discard the response at the diagnostic layer.
    return this.#db("products?select=id&limit=1");
  }

  async listRecommendations(status = "pending", limit = 100) {
    const params = new URLSearchParams({ select: "*", status: `eq.${status}`, order: "commercial_score.desc", limit: String(limit) });
    return this.#db(`product_recommendations?${params}`);
  }

  async updateRecommendation(id, status, reviewerId, notes) {
    const params = new URLSearchParams({ id: `eq.${id}`, select: "id,status,reviewer_id,review_notes,reviewed_at" });
    const body = { status, reviewer_id: reviewerId, review_notes: notes || null, reviewed_at: new Date().toISOString() };
    return this.#db(`product_recommendations?${params}`, { method: "PATCH", body });
  }
}
