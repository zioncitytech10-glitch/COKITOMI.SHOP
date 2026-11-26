const API_BASE = "https://cokitomi-api.onrender.com";

export function createAdminApi(authClient, onUnauthorized = () => {}) {
  return async function adminRequest(path, options = {}) {
    const { data: { session } = {} } = await authClient.auth.getSession();
    if (!session?.access_token) {
      onUnauthorized();
      throw new Error("Your administrator session has expired. Please sign in again.");
    }
    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      cache: "no-store",
      headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers, Authorization: `Bearer ${session.access_token}` },
    });
    if (response.status === 401 || response.status === 403) {
      onUnauthorized();
      throw new Error("Administrator access could not be verified. Please sign in again.");
    }
    if (!response.ok) {
      let message = "The admin service could not complete that request.";
      try {
        const body = await response.json();
        if (typeof body.error === "string" && body.error.length < 180) message = body.error;
      } catch { /* Keep provider response details out of the interface. */ }
      throw new Error(message);
    }
    return response.status === 204 ? null : response.json();
  };
}
