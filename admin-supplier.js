const make = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = String(text ?? "");
  return node;
};
const value = (input) => input === null || input === undefined || input === "" ? "Missing / unverified" : String(input);
const money = (input) => input !== null && input !== undefined && input !== "" && Number.isFinite(Number(input)) ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(input)) : "Missing / unverified";
const slugify = (text) => String(text).normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 125);

export async function renderSupplierView(host, api) {
  host.replaceChildren(make("h2", "section-title", "CJ Gift & Romance research"), make("p", "section-copy", "Research only teddy bears, rose bouquets and selected romantic gifts. Results stay private until you approve and explicitly publish them."));
  const toolbar = make("div", "supplier-toolbar");
  const category = document.createElement("select"); category.setAttribute("aria-label", "Product research category");
  for (const [key, label] of [["teddy_bears", "Teddy Bears"], ["rose_bouquets", "Roses & Flower Bouquets"], ["romantic_gifts", "Romantic Gifts & Gift Bundles"]]) {
    const option = document.createElement("option"); option.value = key; option.textContent = label; category.append(option);
  }
  const season = document.createElement("select"); season.setAttribute("aria-label", "Seasonal collection");
  for (const [key, label] of [["year_round", "Year-round"], ["christmas_2026", "Christmas 2026"], ["new_year_2027", "New Year 2027"], ["valentines_2027", "Valentine's Day 2027"]]) {
    const option = document.createElement("option"); option.value = key; option.textContent = label; season.append(option);
  }
  const search = make("button", "primary-button", "Research Teddy Bears"); search.type = "button";
  const status = document.createElement("select"); status.setAttribute("aria-label", "Recommendation status");
  for (const item of ["pending", "approved", "rejected"]) { const option = document.createElement("option"); option.value = item; option.textContent = `${item[0].toUpperCase()}${item.slice(1)} recommendations`; status.append(option); }
  toolbar.append(category, season, search, status); host.append(toolbar);
  category.addEventListener("change", () => { search.textContent = `Research ${category.options[category.selectedIndex].text}`; });
  const notice = make("p", "admin-notice"); notice.setAttribute("role", "status"); host.append(notice);
  const cleanup = make("div", "supplier-cleanup");
  const clearRejected = make("button", "quiet-button danger-button", "Delete all rejected, unpublished records");
  clearRejected.type = "button"; clearRejected.hidden = true;
  clearRejected.addEventListener("click", async () => {
    const confirmed = window.confirm("Permanently delete every rejected, unpublished supplier recommendation? Published products will not be touched. This cannot be undone.");
    if (!confirmed) return;
    clearRejected.disabled = true;
    try {
      const result = await api("/api/admin/recommendations?status=rejected", { method: "DELETE" });
      notice.textContent = `Deleted ${result.count} rejected, unpublished recommendation record(s).`;
      await refresh();
    } catch (error) { notice.textContent = error.message; }
    finally { clearRejected.disabled = false; }
  });
  cleanup.append(clearRejected); host.append(cleanup);
  const list = make("div", "admin-product-list"); host.append(list);
  const refresh = async () => {
    list.replaceChildren(make("p", "muted", "Loading recommendations…"));
    try {
      const result = await api(`/api/admin/recommendations?status=${encodeURIComponent(status.value)}&limit=100`);
      list.replaceChildren();
      clearRejected.hidden = status.value !== "rejected" || !result.recommendations?.length;
      if (!result.recommendations?.length) list.append(make("p", "muted", `No ${status.value} recommendations.`));
      for (const recommendation of result.recommendations || []) list.append(renderRecommendation(recommendation, api, refresh));
    } catch (error) { list.replaceChildren(make("p", "admin-notice", error.message)); }
  };
  status.addEventListener("change", refresh);
  search.addEventListener("click", async () => {
    search.disabled = true; notice.textContent = "Searching CJ and gathering available product, variant, stock, review and US shipping data…";
    try {
      const result = await api("/api/admin/cj/research", { method: "POST", body: JSON.stringify({ category: category.value, season: season.value, productFlags: [0, 1] }) });
      status.value = "pending"; const d = result.diagnostics || {};
      const failureSummary = Array.isArray(d.failures) && d.failures.length
        ? " Diagnostics: " + d.failures.map((item) => `${item.phase}: ${item.classification}${item.providerCode ? ` (code ${item.providerCode})` : ""}${item.endpoint ? ` at ${item.endpoint}` : ""}${item.productId ? ` for product ${item.productId}` : ""}${item.requestId ? ` [CJ request ${item.requestId}]` : ""}${item.stage ? ` [stage ${item.stage}]` : ""}${item.errorType ? ` [${item.errorType}]` : ""}${item.referenceHint ? ` [${item.referenceHint}]` : ""}`).join("; ")
        : "";
      notice.textContent = `Research complete for ${category.options[category.selectedIndex].text} · ${season.options[season.selectedIndex].text}. ${result.saved ?? 0} recommendation record${result.saved === 1 ? "" : "s"} saved. Searches: ${d.searchesSucceeded ?? 0}/${d.searchesAttempted ?? 0} successful; CJ products: ${d.productsReturned ?? 0}; unique: ${d.uniqueProducts ?? 0}; evaluated: ${d.productsEvaluated ?? 0}; evaluation failures: ${d.evaluationFailures ?? 0}.${failureSummary}`;
      await refresh();
    } catch (error) { notice.textContent = error.message; }
    finally { search.disabled = false; }
  });
  await refresh();
}

function renderRecommendation(rec, api, refresh) {
  const card = make("article", "admin-record");
  const head = make("div", "admin-record-head");
  if (rec.image_url) { const image = make("img", "admin-record-image"); image.src = rec.image_url; image.alt = ""; image.loading = "lazy"; head.append(image); }
  const summary = make("div", "admin-record-summary");
  summary.append(make("h3", "", rec.title), make("p", "", `CJ product ID ${value(rec.cj_product_id)} · Status: ${rec.status} · Commercial score ${value(rec.commercial_score)}/100`));
  head.append(summary); card.append(head);
  const stats = make("div", "record-metrics");
  for (const detail of [
    `Supplier price: ${rec.supplier_data?.price_verified ? money(rec.supplier_price) : "Missing / unverified"}`, `Shipping to US (researched variant): ${rec.shipping_cost == null ? "Missing / unverified" : money(rec.shipping_cost)}`,
    `Delivery estimate (researched variant): ${rec.delivery_days == null ? "Missing / unverified" : `${rec.delivery_days} days (estimate)`}`,
    `Inventory: ${value(rec.inventory)}${rec.supplier_data?.inventory_verified ? " (verified)" : " (unverified)"}`,
    `US inventory: ${value(rec.us_inventory)}`, `Reviews: ${rec.review_count ? `${rec.review_rating ?? "Rating unavailable"} / 5 · ${rec.review_count}` : "Unavailable"}`,
    `Estimated landed cost: ${rec.supplier_data?.price_verified && rec.shipping_cost != null ? money(rec.estimated_landed_cost) : "Missing / unverified"} · Estimated margin: ${rec.supplier_data?.price_verified && rec.shipping_cost != null && Number.isFinite(Number(rec.estimated_margin)) ? `${(Number(rec.estimated_margin) * 100).toFixed(1)}%` : "Unavailable"}`,
  ]) stats.append(make("span", "", detail));
  card.append(stats);
  const variants = Array.isArray(rec.variant_data?.variants) ? rec.variant_data.variants : [];
  const details = make("details", "variant-details"); details.append(make("summary", "", `${variants.length} variant${variants.length === 1 ? "" : "s"} · all returned variants`));
  if (!variants.length) details.append(make("p", "record-meta", "CJ did not return variant details for this recommendation."));
  for (const variant of variants) {
    const row = make("div", "supplier-variant");
    if (variant.image_url) { const image = make("img", "variant-image"); image.src = variant.image_url; image.alt = ""; image.loading = "lazy"; row.append(image); }
    const description = make("div", "");
    description.append(make("strong", "", value(variant.name)), make("p", "record-meta", `Variant ID ${value(variant.id)} · ${variant.price === null ? "Price unavailable / unverified" : money(variant.price)} · stock ${value(variant.stock)}${variant.stock_verified ? " (verified)" : " (unverified)"} · US stock ${value(variant.us_stock)}${variant.us_stock_verified ? " (verified)" : " (unverified)"}`));
    if (variant.warehouses?.length) description.append(make("p", "record-meta", `Warehouse data: ${variant.warehouses.map((warehouse) => `${value(warehouse.country)} ${value(warehouse.warehouse)}: ${value(warehouse.quantity)}`).join(" · ")}`));
    row.append(description); details.append(row);
  }
  card.append(details);
  if (rec.research_signals?.product_category || rec.research_signals?.seasonal_collection) {
    const categoryLabels = { teddy_bears: "Teddy Bears", rose_bouquets: "Roses & Flower Bouquets", romantic_gifts: "Romantic Gifts & Gift Bundles" };
    const seasonLabels = { year_round: "Year-round", christmas_2026: "Christmas 2026", new_year_2027: "New Year 2027", valentines_2027: "Valentine's Day 2027" };
    card.append(make("p", "record-meta", `Category: ${categoryLabels[rec.research_signals.product_category] || rec.research_signals.product_category || "Unknown"} · Collection: ${seasonLabels[rec.research_signals.seasonal_collection] || rec.research_signals.seasonal_collection || "Unknown"}`));
  }
  if (rec.description) {
    const cleanDescription = String(rec.description).replace(/<br\\s*\\/?\\s*>/gi, " ").replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/\\s+/g, " ").trim();
    if (cleanDescription) card.append(make("p", "record-meta", cleanDescription.slice(0, 600)));
  }
  const actions = make("div", "admin-record-actions");
  if (rec.status === "pending") {
    actions.append(action("Approve", "quiet-button", async () => { await changeStatus(api, rec.id, "approved"); await refresh(); }));
    actions.append(action("Reject", "quiet-button danger-button", async () => { await changeStatus(api, rec.id, "rejected"); await refresh(); }));
  }
  if (rec.status === "approved" && !rec.published_product_id) actions.append(makePublishForm(rec, api, refresh));
  if (rec.published_product_id) actions.append(make("p", "admin-notice", `Published as storefront product ${rec.published_product_id}${rec.published_at ? ` on ${new Date(rec.published_at).toLocaleDateString()}` : ""}. Published records are protected from deletion.`));
  else actions.append(action("Delete record", "quiet-button danger-button", async () => {
    if (!window.confirm(`Permanently delete "${rec.title}" from supplier research?`)) return;
    await api(`/api/admin/recommendations/${encodeURIComponent(rec.id)}`, { method: "DELETE" });
    await refresh();
  }));
  card.append(actions);
  return card;
}

function action(label, className, callback) {
  const button = make("button", className, label); button.type = "button";
  button.addEventListener("click", async () => { button.disabled = true; try { await callback(); } catch (error) { button.disabled = false; window.alert(error.message); } });
  return button;
}

async function changeStatus(api, id, status) {
  await api(`/api/admin/recommendations/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ status }) });
}

function makePublishForm(rec, api, refresh) {
  const details = make("details", "publish-details"); details.append(make("summary", "primary-button", "Prepare explicit storefront publish"));
  const form = make("form", "admin-edit-form");
  const slug = `${slugify(rec.title)}-${slugify(rec.cj_product_id).slice(-18)}`.replace(/-+/g, "-").slice(0, 180);
  for (const [name, label, type, initial] of [["slug", "Storefront URL slug", "text", slug], ["price", "Retail price (USD)", "number", rec.suggested_retail_price || ""]]) {
    const wrap = make("label", "admin-field"); wrap.append(make("span", "", label)); const input = make("input"); input.type = type; input.name = name; input.value = initial;
    if (type === "number") { input.min = "0.01"; input.step = "0.01"; }
    wrap.append(input); form.append(wrap);
  }
  const collections = make("label", "admin-field"); collections.append(make("span", "", "Collections (comma-separated IDs; optional)"));
  const collectionInput = make("input"); collectionInput.name = "collection_ids"; collectionInput.placeholder = "best-sellers, birthday-gifts"; collections.append(collectionInput); form.append(collections);
  const feedback = make("p", "admin-notice"); feedback.setAttribute("role", "status");
  const publish = make("button", "primary-button", "Publish approved product now"); publish.type = "submit";
  form.append(publish, feedback); form.addEventListener("submit", async (event) => {
    event.preventDefault(); publish.disabled = true; feedback.textContent = "Publishing the approved record…";
    const data = new FormData(form);
    try {
      await api(`/api/admin/recommendations/${encodeURIComponent(rec.id)}/publish`, { method: "POST", body: JSON.stringify({
        slug: String(data.get("slug")).trim(), price: Number(data.get("price")),
        collection_ids: String(data.get("collection_ids") || "").split(",").map((part) => part.trim()).filter(Boolean),
      }) });
      feedback.textContent = "Published to the active storefront catalogue."; await refresh();
    } catch (error) { feedback.textContent = error.message; publish.disabled = false; }
  });
  details.append(form); return details;
}
