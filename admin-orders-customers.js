const make = (tag, className = "", text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = String(text ?? "");
  return node;
};

const shown = (value, fallback = "—") =>
  value === null || value === undefined || value === "" ? fallback : String(value);

const money = (value, currency = "USD") => {
  const amount = Number(value);
  if (value === null || value === undefined || value === "" || !Number.isFinite(amount)) return "—";
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: /^[A-Z]{3}$/.test(currency || "") ? currency : "USD" }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency || "USD"}`;
  }
};

const date = (value) => {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(parsed);
};

const statusLabel = (value) => shown(value, "Unknown").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

function toolbarInput(placeholder, label) {
  const input = make("input", "admin-search");
  input.type = "search";
  input.placeholder = placeholder;
  input.setAttribute("aria-label", label);
  return input;
}

function statusPill(value) {
  const pill = make("span", "admin-status-pill", statusLabel(value));
  pill.dataset.status = String(value || "unknown").toLowerCase();
  return pill;
}

function setMessage(host, message, isError = false) {
  const node = make("p", isError ? "admin-notice admin-error" : "admin-notice", message);
  node.setAttribute("role", "status");
  host.replaceChildren(node);
}

function createPager(onPrevious, onNext, page, hasNext) {
  const pager = make("div", "admin-pager");
  const previous = make("button", "quiet-button", "Previous");
  previous.type = "button";
  previous.disabled = page <= 0;
  previous.addEventListener("click", onPrevious);
  const label = make("span", "admin-notice", `Page ${page + 1}`);
  const next = make("button", "quiet-button", "Next");
  next.type = "button";
  next.disabled = !hasNext;
  next.addEventListener("click", onNext);
  pager.append(previous, label, next);
  return pager;
}

export async function renderOrdersView(host, api) {
  host.replaceChildren(
    make("h2", "section-title", "Store orders"),
    make("p", "section-copy", "Review order records and purchased items. This page is read-only; payment and fulfilment actions are not enabled.")
  );

  const controls = make("div", "admin-data-toolbar");
  const search = toolbarInput("Search order number or email…", "Search orders");
  const status = document.createElement("select");
  status.className = "admin-select";
  status.setAttribute("aria-label", "Filter by order status");
  [["", "All statuses"], ["pending", "Pending"], ["payment_processing", "Payment processing"], ["paid", "Paid"], ["submitted_to_supplier", "Submitted to supplier"], ["processing", "Processing"], ["shipped", "Shipped"], ["delivered", "Delivered"], ["cancelled", "Cancelled"], ["refunded", "Refunded"], ["fulfillment_error", "Fulfilment error"]].forEach(([value, label]) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    status.append(option);
  });
  const refreshButton = make("button", "quiet-button", "Refresh");
  refreshButton.type = "button";
  controls.append(search, status, refreshButton);
  host.append(controls);

  const results = make("section", "admin-data-results");
  host.append(results);
  let page = 0;
  let requestVersion = 0;
  let debounce;

  const load = async () => {
    const version = ++requestVersion;
    setMessage(results, "Loading orders…");
    const params = new URLSearchParams({ limit: "25", offset: String(page * 25) });
    if (status.value) params.set("status", status.value);
    if (search.value.trim()) params.set("search", search.value.trim());
    try {
      const orders = await api(`/api/admin/orders?${params}`);
      if (version !== requestVersion) return;
      results.replaceChildren();
      if (!Array.isArray(orders) || !orders.length) {
        results.append(make("p", "muted", "No orders found for this search."));
      } else {
        const tableWrap = make("div", "admin-table-wrap");
        const table = make("table", "admin-data-table");
        const thead = document.createElement("thead");
        const headRow = document.createElement("tr");
        ["Order", "Customer", "Date", "Status", "Total", "Details"].forEach((label) => headRow.append(make("th", "", label)));
        thead.append(headRow);
        const tbody = document.createElement("tbody");
        orders.forEach((order) => {
          const row = document.createElement("tr");
          row.append(
            make("td", "admin-cell-strong", shown(order.order_number, `#${order.id?.slice(0, 8) || "—"}`)),
            make("td", "", shown(order.shipping_name, order.email || "Guest")),
            make("td", "", date(order.created_at)),
          );
          const stateCell = document.createElement("td");
          stateCell.append(statusPill(order.status));
          row.append(stateCell, make("td", "admin-cell-strong", money(order.total, order.currency)));
          const actionCell = document.createElement("td");
          const details = make("button", "table-action", "View order");
          details.type = "button";
          details.addEventListener("click", () => showOrderDetail(order, results, load, api));
          actionCell.append(details);
          row.append(actionCell);
          tbody.append(row);
        });
        table.append(thead, tbody);
        tableWrap.append(table);
        results.append(tableWrap);
      }
      results.append(createPager(() => { page = Math.max(0, page - 1); void load(); }, () => { page += 1; void load(); }, page, orders.length === 25));
    } catch (error) {
      if (version === requestVersion) setMessage(results, error.message || "Orders could not be loaded.", true);
    }
  };

  search.addEventListener("input", () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => { page = 0; void load(); }, 300);
  });
  status.addEventListener("change", () => { page = 0; void load(); });
  refreshButton.addEventListener("click", () => void load());
  await load();
}

async function showOrderDetail(order, host, reload, api) {
  const panel = make("section", "admin-detail-panel");
  panel.append(make("div", "admin-detail-heading", `Order ${shown(order.order_number)}`), make("p", "admin-notice", "Loading order details…"));
  const close = make("button", "quiet-button", "Close details");
  close.type = "button";
  close.addEventListener("click", () => panel.remove());
  panel.querySelector(".admin-detail-heading").append(close);
  host.prepend(panel);
  try {
    const result = await api(`/api/admin/orders/${encodeURIComponent(order.id)}`);
    const detail = result.order;
    panel.replaceChildren();
    const heading = make("div", "admin-detail-heading", `Order ${shown(detail.order_number)}`);
    heading.append(close);
    panel.append(heading);
    const summary = make("div", "admin-detail-grid");
    [["Customer", detail.shipping_name || detail.email], ["Email", detail.email], ["Status", statusLabel(detail.status)], ["Order date", date(detail.created_at)], ["Subtotal", money(detail.subtotal, detail.currency)], ["Shipping", money(detail.shipping_total, detail.currency)], ["Tax", money(detail.tax_total, detail.currency)], ["Total", money(detail.total, detail.currency)], ["Payment provider", detail.payment_provider], ["Payment reference", detail.payment_reference], ["Tracking number", detail.tracking_number], ["Tracking URL", detail.tracking_url]].forEach(([label, value]) => {
      const item = make("div", "admin-detail-item");
      item.append(make("span", "", label), make("strong", "", shown(value)));
      summary.append(item);
    });
    panel.append(summary, make("h3", "admin-subheading", "Purchased items"));
    const items = Array.isArray(detail.items) ? detail.items : [];
    if (!items.length) panel.append(make("p", "muted", "No line items were returned for this order."));
    else {
      const list = make("div", "admin-detail-items");
      items.forEach((item) => {
        const row = make("div", "admin-detail-item-row");
        row.append(
          make("strong", "", shown(item.product_name || item.name || item.title, item.product_id ? `Product ${item.product_id}` : "Order item")),
          make("span", "", `Qty: ${shown(item.quantity)} · Unit: ${money(item.unit_price, detail.currency)} · Line total: ${money(item.total_price ?? item.line_total, detail.currency)}`)
        );
        list.append(row);
      });
      panel.append(list);
    }
  } catch (error) {
    panel.replaceChildren(make("div", "admin-detail-heading", "Order details"), make("p", "admin-notice admin-error", error.message || "Could not load this order."));
    panel.append(close);
  }
}

export async function renderCustomersView(host, api) {
  host.replaceChildren(
    make("h2", "section-title", "Customers"),
    make("p", "section-copy", "Browse customer profiles and purchase history. Customer records are read-only in this stage.")
  );
  const controls = make("div", "admin-data-toolbar");
  const search = toolbarInput("Search customer name or phone…", "Search customers");
  const refreshButton = make("button", "quiet-button", "Refresh");
  refreshButton.type = "button";
  controls.append(search, refreshButton);
  host.append(controls);
  const results = make("section", "admin-customer-results");
  host.append(results);
  let page = 0;
  let requestVersion = 0;
  let debounce;

  const load = async () => {
    const version = ++requestVersion;
    setMessage(results, "Loading customers…");
    const params = new URLSearchParams({ limit: "25", offset: String(page * 25) });
    if (search.value.trim()) params.set("search", search.value.trim());
    try {
      const customers = await api(`/api/admin/customers?${params}`);
      if (version !== requestVersion) return;
      results.replaceChildren();
      if (!Array.isArray(customers) || !customers.length) {
        results.append(make("p", "muted", "No customers found for this search."));
      } else {
        const list = make("div", "admin-customer-grid");
        customers.forEach((customer) => {
          const card = make("article", "admin-record admin-customer-card");
          card.append(
            make("h3", "admin-customer-name", shown(customer.full_name, "Customer")),
            make("p", "record-meta", shown(customer.email)),
            make("p", "record-meta", `Phone: ${shown(customer.phone)}`),
            make("div", "record-metrics", `Orders: ${shown(customer.order_count, "0")} · Latest order: ${date(customer.latest_order_at)}`)
          );
          const button = make("button", "table-action", "View customer");
          button.type = "button";
          button.addEventListener("click", () => showCustomerDetail(customer, results, api));
          card.append(button);
          list.append(card);
        });
        results.append(list);
      }
      results.append(createPager(() => { page = Math.max(0, page - 1); void load(); }, () => { page += 1; void load(); }, page, customers.length === 25));
    } catch (error) {
      if (version === requestVersion) setMessage(results, error.message || "Customers could not be loaded.", true);
    }
  };

  search.addEventListener("input", () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => { page = 0; void load(); }, 300);
  });
  refreshButton.addEventListener("click", () => void load());
  await load();
}

async function showCustomerDetail(customer, host, api) {
  const panel = make("section", "admin-detail-panel");
  const close = make("button", "quiet-button", "Close details");
  close.type = "button";
  close.addEventListener("click", () => panel.remove());
  panel.append(make("div", "admin-detail-heading", shown(customer.full_name, "Customer")), make("p", "admin-notice", "Loading customer history…"));
  panel.querySelector(".admin-detail-heading").append(close);
  host.prepend(panel);
  try {
    const result = await api(`/api/admin/customers/${encodeURIComponent(customer.id)}`);
    const detail = result.customer;
    panel.replaceChildren();
    const heading = make("div", "admin-detail-heading", shown(detail.full_name, "Customer"));
    heading.append(close);
    panel.append(heading);
    const summary = make("div", "admin-detail-grid");
    [["Email", detail.email], ["Phone", detail.phone], ["Customer since", date(detail.created_at)], ["Total orders", detail.order_count]].forEach(([label, value]) => {
      const item = make("div", "admin-detail-item");
      item.append(make("span", "", label), make("strong", "", shown(value)));
      summary.append(item);
    });
    panel.append(summary, make("h3", "admin-subheading", "Order history"));
    if (!detail.orders?.length) panel.append(make("p", "muted", "No orders are recorded for this customer."));
    else {
      const table = make("table", "admin-data-table");
      const thead = document.createElement("thead");
      const headRow = document.createElement("tr");
      ["Order", "Date", "Status", "Total"].forEach((label) => headRow.append(make("th", "", label)));
      thead.append(headRow);
      const tbody = document.createElement("tbody");
      detail.orders.forEach((order) => {
        const row = document.createElement("tr");
        row.append(make("td", "admin-cell-strong", shown(order.order_number)), make("td", "", date(order.created_at)));
        const state = document.createElement("td");
        state.append(statusPill(order.status));
        row.append(state, make("td", "admin-cell-strong", money(order.total, order.currency)));
        tbody.append(row);
      });
      table.append(thead, tbody);
      const wrap = make("div", "admin-table-wrap");
      wrap.append(table);
      panel.append(wrap);
    }
    if (detail.orders_truncated) panel.append(make("p", "admin-notice", "Showing the 100 most recent orders. The customer has additional order history."));
  } catch (error) {
    panel.replaceChildren(make("div", "admin-detail-heading", "Customer details"), make("p", "admin-notice admin-error", error.message || "Could not load this customer."));
    panel.append(close);
  }
}
