const API_KEY_PATH = "/authentication/getAccessToken";
const REFRESH_PATH = "/authentication/refreshAccessToken";
const EXPIRY_SKEW_MS = 5 * 60 * 1000;
const MAX_RATE_LIMIT_RETRIES = 3;
const RATE_LIMIT_BACKOFF_BASE_MS = 1000;
const RATE_LIMIT_BACKOFF_MAX_MS = 8000;
const CONNECTIVITY_CACHE_MS = 60 * 1000;
const expiryTime = (value) => {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Date.now() + 180 * 24 * 60 * 60 * 1000;
};

function parseRetryAfter(value, now) {
  if (typeof value !== "string" || !value.trim()) return null;
  const trimmed = value.trim();
  const seconds = Number(trimmed);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
  const date = Date.parse(trimmed);
  return Number.isFinite(date) ? Math.max(0, date - now) : null;
}

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export class CjClient {
  constructor({ apiKey, baseUrl, minIntervalMs = 1100, fetchImpl = fetch, nowImpl = Date.now, sleepImpl = sleep }) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.fetchImpl = fetchImpl;
    this.minIntervalMs = Math.max(1000, Number(minIntervalMs) || 0);
    this.nowImpl = nowImpl;
    this.sleepImpl = sleepImpl;
    this.token = null;
    this.refreshToken = null;
    this.expiresAt = 0;
    this.tokenPromise = null;
    this.lastRequestAt = null;
    this.cooldownUntil = 0;
    this.requestQueue = Promise.resolve();
    this.connectivityCache = null;
    this.connectivityPromise = null;
  }

  #enqueue(operation) {
    const pending = this.requestQueue.then(operation);
    this.requestQueue = pending.then(() => undefined, () => undefined);
    return pending;
  }

  async #requestOnce(path, { method = "GET", body, accessToken } = {}) {
    let response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: { "Content-Type": "application/json", ...(accessToken ? { "CJ-Access-Token": accessToken } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(25000),
      });
    } catch (cause) {
      const timeoutFailure = cause?.name === "TimeoutError" || cause?.name === "AbortError";
      const error = new Error(timeoutFailure ? "CJ request timed out" : "CJ network request failed");
      error.timeoutFailure = timeoutFailure;
      error.networkFailure = !timeoutFailure;
      throw error;
    }
    let data;
    try { data = await response.json(); } catch {
      const error = new Error("CJ returned a non-JSON response");
      error.httpStatus = response.status;
      error.protocolFailure = true;
      error.rateLimited = response.status === 429;
      error.retryAfterMs = parseRetryAfter(response.headers?.get("Retry-After"), this.nowImpl());
      throw error;
    }
    if (!response.ok || data?.result === false) {
      const parsedCode = Number(data?.code);
      const err = new Error("CJ provider request failed");
      err.cjCode = Number.isInteger(parsedCode) ? parsedCode : null;
      err.httpStatus = response.status;
      err.rateLimited = response.status === 429 || err.cjCode === 1600200;
      if (err.rateLimited) err.retryAfterMs = parseRetryAfter(response.headers?.get("Retry-After"), this.nowImpl());
      throw err;
    }
    return data;
  }

  async #request(path, options = {}) {
    // Serialize complete attempts, including retry waits, so parallel callers
    // cannot observe the same last-request timestamp and burst past the limit.
    return this.#enqueue(async () => {
      let retryIndex = 0;
      while (true) {
        const now = this.nowImpl();
        const spacingWait = this.lastRequestAt === null ? 0 : Math.max(0, this.minIntervalMs - (now - this.lastRequestAt));
        const cooldownWait = Math.max(0, this.cooldownUntil - now);
        const wait = Math.max(spacingWait, cooldownWait);
        if (wait > 0) await this.sleepImpl(wait);
        this.lastRequestAt = this.nowImpl();

        try {
          return await this.#requestOnce(path, options);
        } catch (error) {
          if (!error.rateLimited) throw error;

          const backoff = Math.min(RATE_LIMIT_BACKOFF_MAX_MS, RATE_LIMIT_BACKOFF_BASE_MS * (2 ** retryIndex));
          const delay = Math.max(backoff, error.retryAfterMs || 0);
          this.cooldownUntil = Math.max(this.cooldownUntil, this.nowImpl() + delay);
          if (retryIndex >= MAX_RATE_LIMIT_RETRIES) throw error;
          retryIndex++;
        }
      }
    });
  }

  async checkConnectivity() {
    const now = this.nowImpl();
    if (this.connectivityCache && now < this.connectivityCache.expiresAt) {
      if (this.connectivityCache.error) throw this.connectivityCache.error;
      return { data: true };
    }
    if (this.connectivityPromise) return this.connectivityPromise;

    this.connectivityPromise = this.call("/product/getCategory").then(
      () => {
        this.connectivityCache = { expiresAt: this.nowImpl() + CONNECTIVITY_CACHE_MS, error: null };
        return { data: true };
      },
      (error) => {
        this.connectivityCache = { expiresAt: this.nowImpl() + CONNECTIVITY_CACHE_MS, error };
        throw error;
      },
    ).finally(() => { this.connectivityPromise = null; });
    return this.connectivityPromise;
  }

  async #authenticate() {
    let response;
    try { response = await this.#request(API_KEY_PATH, { method: "POST", body: { apiKey: this.apiKey } }); }
    catch (error) { error.cjPhase = "authentication"; throw error; }
    const data = response.data || {};
    if (!data.accessToken || !data.refreshToken) {
      const error = new Error("CJ authentication response was incomplete");
      error.cjPhase = "authentication";
      error.protocolFailure = true;
      throw error;
    }
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
      error.cjPhase = "authentication";
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
    let token;
    try { token = await this.getToken(); }
    catch (error) { error.cjPhase ||= "authentication"; throw error; }
    try { return await this.#request(`${path}${qs}`, { method, body, accessToken: token }); }
    catch (error) {
      if (![1600001, 1600002].includes(error.cjCode)) throw error;
      this.expiresAt = 0;
      token = await this.getToken();
      return this.#request(`${path}${qs}`, { method, body, accessToken: token });
    }
  }
}
