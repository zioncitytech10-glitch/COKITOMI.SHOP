import { logoutAndRedirect } from "./admin-session.js";
import { createAdminApi } from "./admin-api.js";
import { renderProductsView } from "./admin-products.js";
import { renderSupplierView } from "./admin-supplier.js";
import { renderOrdersView, renderCustomersView } from "./admin-orders-customers.js";

(() => {
  "use strict";

  const API_BASE = "https://cokitomi-api.onrender.com";
  const authView = document.getElementById("authView");
  const dashboardView = document.getElementById("dashboardView");
  const loginForm = document.getElementById("loginForm");
  const loginButton = document.getElementById("loginButton");
  const authMessage = document.getElementById("authMessage");
  const overviewContent = document.getElementById("overviewContent");
  const supabaseUrl = window.COKITOMI_SUPABASE_URL;
  const publishableKey = window.COKITOMI_SUPABASE_PUBLISHABLE_KEY;
  let authClient = null;
  let adminApi = null;
  let overviewData = null;

  function showMessage(message) {
    authMessage.textContent = message;
  }

  const logoutResult = new URLSearchParams(window.location.search).get("logout");
  if (logoutResult === "warning") {
    showMessage("This browser is signed out, but Supabase could not confirm remote session revocation. Check your connection before signing in again.");
  } else if (logoutResult === "success") {
    showMessage("You have been logged out.");
  }

  function countLabel(metric) {
    if (!metric || metric.status !== "available" || !Number.isSafeInteger(metric.value)) return "Unavailable";
    return new Intl.NumberFormat("en-US").format(metric.value);
  }

  function addMetric(grid, label, value, note, unavailable = false) {
    const card = document.createElement("article");
    card.className = `metric-card${unavailable ? " metric-unavailable" : ""}`;
    const title = document.createElement("span");
    title.className = "metric-label";
    title.textContent = label;
    const number = document.createElement("strong");
    number.className = "metric-value";
    number.textContent = value;
    const detail = document.createElement("span");
    detail.className = "metric-note";
    detail.textContent = note;
    card.append(title, number, detail);
    grid.append(card);
  }

  function renderOverview(overview) {
    overviewData = overview;
    overviewContent.replaceChildren();
    const heading = document.createElement("h2");
    heading.className = "section-title";
    heading.textContent = "Current business data";
    const intro = document.createElement("p");
    intro.className = "section-copy";
    intro.textContent = "Counts are read from the existing Supabase tables. Unavailable means the backend could not verify that data source.";
    const grid = document.createElement("div");
    grid.className = "metric-grid";
    addMetric(grid, "Catalogue products", countLabel(overview.catalogue?.total), "All rows currently available to the backend", overview.catalogue?.total?.status !== "available");
    addMetric(grid, "Active products", countLabel(overview.catalogue?.active), "Products marked active in Supabase", overview.catalogue?.active?.status !== "available");
    addMetric(grid, "Orders", countLabel(overview.orders?.total), "Existing order records; no order action is available here yet", overview.orders?.total?.status !== "available");
    addMetric(grid, "Customer profiles", countLabel(overview.customers?.total), "Existing customer profile records", overview.customers?.total?.status !== "available");
    addMetric(grid, "Pending CJ recommendations", countLabel(overview.recommendations?.pending), "Private recommendations awaiting review", overview.recommendations?.pending?.status !== "available");
    addMetric(grid, "Revenue", "Unavailable", overview.revenue?.reason || "Verified payment data is unavailable.", true);
    const banner = document.createElement("section");
    banner.className = "status-banner";
    const bannerTitle = document.createElement("h2");
    bannerTitle.textContent = "Stage 1 dashboard";
    const bannerText = document.createElement("p");
    bannerText.textContent = "This overview is read-only. Use Products to manage the catalogue and CJ Supplier research to review candidates. Orders and customer management remain unavailable.";
    banner.append(bannerTitle, bannerText);
    overviewContent.append(heading, intro, grid, banner);
  }

  async function signOut() {
    dashboardView.hidden = true;
    authView.hidden = false;
    overviewContent.replaceChildren();
    document.getElementById("adminEmail").textContent = "";
    loginForm.reset();
    showMessage("Signing out…");
    await logoutAndRedirect(authClient, window.location.pathname, (path) => window.location.replace(path));
  }

  async function loadAuthorizedOverview(user) {
    const { data: { session } } = await authClient.auth.getSession();
    if (!session?.access_token) throw new Error("Your sign-in session is no longer valid. Please sign in again.");
    const response = await fetch(`${API_BASE}/api/admin/overview`, {
      method: "GET",
      headers: { Authorization: `Bearer ${session.access_token}` },
      cache: "no-store",
    });
    if (response.status === 401 || response.status === 403) {
      await signOut();
      throw new Error("This Supabase account is not authorized as a COKITOMI administrator.");
    }
    if (!response.ok) throw new Error("The admin service could not load the overview. Please try again later.");
    const result = await response.json();
    if (!result?.admin?.id || result.admin.id !== user.id || !result.overview) {
      await signOut();
      throw new Error("Administrator authorization could not be confirmed.");
    }
    renderOverview(result.overview);
    adminApi = createAdminApi(authClient, () => { void signOut(); });
    document.getElementById("adminEmail").textContent = user.email || "Administrator";
    authView.hidden = true;
    dashboardView.hidden = false;
    showMessage("");
  }

  if (!supabaseUrl || !publishableKey || !window.supabase?.createClient) {
    showMessage("Admin sign-in is unavailable because the public Supabase configuration did not load.");
  } else {
    authClient = window.supabase.createClient(supabaseUrl, publishableKey, {
      auth: { persistSession: false, autoRefreshToken: true, detectSessionInUrl: false },
    });
  }

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!authClient) return;
    loginButton.disabled = true;
    showMessage("Signing in and verifying administrator access…");
    try {
      const form = new FormData(loginForm);
      const { error } = await authClient.auth.signInWithPassword({
        email: String(form.get("email") || "").trim(),
        password: String(form.get("password") || ""),
      });
      if (error) throw new Error("Sign-in failed. Check your email and password.");
      const { data, error: userError } = await authClient.auth.getUser();
      if (userError || !data.user) throw new Error("Supabase could not verify this sign-in.");
      await loadAuthorizedOverview(data.user);
    } catch (error) {
      if (!dashboardView.hidden) await signOut();
      showMessage(error.message || "Sign-in could not be completed.");
    } finally {
      loginButton.disabled = false;
    }
  });

  document.getElementById("logoutButton").addEventListener("click", signOut);

  async function showView(view) {
    const labels = { overview: "Business overview", products: "Products", orders: "Orders", customers: "Customers", supplier: "CJ Supplier research" };
    document.querySelectorAll("[data-view]").forEach((button) => {
      const selected = button.dataset.view === view;
      button.classList.toggle("active", selected);
      if (selected) button.setAttribute("aria-current", "page"); else button.removeAttribute("aria-current");
    });
    document.querySelector(".topbar h1").textContent = labels[view] || labels.overview;
    if (view === "products") return renderProductsView(overviewContent, adminApi);
    if (view === "supplier") return renderSupplierView(overviewContent, adminApi);
    if (view === "orders") return renderOrdersView(overviewContent, adminApi);
    if (view === "customers") return renderCustomersView(overviewContent, adminApi);
    if (overviewData) renderOverview(overviewData);
  }

  document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => {
    if (!button.disabled && adminApi) void showView(button.dataset.view);
  }));
})();
