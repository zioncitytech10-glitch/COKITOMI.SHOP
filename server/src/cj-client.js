const API_KEY_PATH = "/authentication/getAccessToken";
const REFRESH_PATH = "/authentication/refreshAccessToken";
const EXPIRY_SKEW_MS = 5 * 60 * 1000;
const expiryTime = (value) => {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Date.now() + 180 * 24 * 60 * 60 * 1000;
};

export class CjClient {
  constructor({ apiKey, baseUrl, minIntervalMs = 1100, fetchImpl = fetch }) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.fetchImpl = fetchImpl;
    this.minIntervalMs = minIntervalMs;
    this.token = null;
    this.refreshToken = null;
    this.expiresAt = 0;
    this.tokenPromise = null;
    this.lastRequestAt = 0;
  }

  async #request(path, { method = "GET", body, accessToken } = {}) {
    const delay = this.minIntervalMs - (Date.now() - this.lastRequestAt);
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    this.lastRequestAt = Date.now();
    let response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: { "Content-Type": "application/json", ...(accessToken ? { "CJ-Access-Token": accessToken } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(25000),
      });
    } catch {
      const error = new Error("CJ network request failed");
      error.networkFailure = true;
      throw error;
    }
    let data;
    try { data = await response.json(); } catch { throw new Error("CJ returned a non-JSON response"); }
    if (!response.ok || data?.result === false) {
      const parsedCode = Number(data?.code);
      const err = new Error("CJ provider request failed");
      err.cjCode = Number.isInteger(parsedCode) ? parsedCode : null;
      err.httpStatus = response.status;
      throw err;
    }
    return data;
  }

  async #authenticate() {
    const response = await this.#request(API_KEY_PATH, { method: "POST", body: { apiKey: this.apiKey } });
    const data = response.data || {};
    if (!data.accessToken || !data.refreshToken) throw new Error("CJ authentication response was incomplete");
    this.token = data.accessToken;
    this.refreshToken = data.refreshToken;
    this.expiresAt = expiryTime(data.accessTokenExpiryDate);
    return this.token;
  }

  async #refresh() {
    if (!this.refreshToken) return this.#authenticate();
    try {
      const response = await this.#request(REFRESH_PATH, { method: "POST", body: { refreshToken: this.refreshToken } });
      const data = response.data || {};
      if (!data.accessToken) throw new Error("CJ refresh response was incomplete");
      this.token = data.accessToken;
      this.refreshToken = data.refreshToken || this.refreshToken;
      this.expiresAt = expiryTime(data.accessTokenExpiryDate);
      return this.token;
    } catch (error) {
      if (error.cjCode === 1600003) return this.#authenticate();
      throw error;
    }
  }

  async getToken() {
    if (this.token && Date.now() < this.expiresAt - EXPIRY_SKEW_MS) return this.token;
    if (!this.tokenPromise) {
      this.tokenPromise = (this.token ? this.#refresh() : this.#authenticate()).finally(() => { this.tokenPromise = null; });
    }
    return this.tokenPromise;
  }

  async call(path, { method = "GET", query, body } = {}) {
    if (!path.startsWith("/") || path.includes("..")) throw new Error("Invalid CJ API path");
    const qs = query ? `?${new URLSearchParams(Object.entries(query).filter(([, value]) => value !== undefined && value !== null)).toString()}` : "";
    let token = await this.getToken();
    try { return await this.#request(`${path}${qs}`, { method, body, accessToken: token }); }
    catch (error) {
      if (![1600001, 1600002].includes(error.cjCode)) throw error;
      this.expiresAt = 0;
      token = await this.getToken();
      return this.#request(`${path}${qs}`, { method, body, accessToken: token });
    }
  }
}
