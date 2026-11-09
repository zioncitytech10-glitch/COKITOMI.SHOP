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
    const response = await this.fetchImpl(`${this.url}/rest/v1/${path}${query}`, {
      method,
      headers: {
        apikey: this.serviceRoleKey,
        Authorization: `Bearer ${this.serviceRoleKey}`,
        "Content-Type": "application/json",
        Prefer: method === "POST" && path.startsWith("product_recommendations") ? "resolution=merge-duplicates,return=representation" : "return=representation",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error(`Supabase database request failed (${response.status})`);
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
