const make = (tag, className = "", text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = String(text ?? "");
  return node;
};

const shown = (value) =>
  value === null || value === undefined || value === ""
    ? "Unavailable / unverified"
    : String(value);

const formatPrice = (value, currency = "USD") => {
  if (value === null || value === undefined || value === "" || !Number.isFinite(Number(value))) {
    return "Unavailable";
  }

  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency
    }).format(Number(value));
  } catch {
    return `${currency} ${Number(value).toFixed(2)}`;
  }
};

const splitLines = (value) =>
  String(value || "")
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean);

const field = (name, label, value = "", type = "text", required = false) => {
  const wrapper = make("label", "admin-field");
  wrapper.append(make("span", "", label));

  const input = type === "textarea" ? make("textarea") : make("input");

  if (type !== "textarea") input.type = type;

  input.name = name;
  input.value = value ?? "";
  input.required = required;

  if (type === "number") {
    input.min = "0";
    input.step = name === "stock_quantity" ? "1" : "0.01";
  }

  wrapper.append(input);
  return wrapper;
};

function createProductForm(api, onSuccess) {
  const details = make("details", "product-edit admin-create-panel");
  details.open = true;

  details.append(make("summary", "", "＋ Add a new product"));

  const form = make("form", "admin-edit-form");

  form.append(
    field("name", "Product name", "", "text", true),
    field("slug", "Product URL slug", "", "text", true),
    field("price", "Retail price (USD)", "", "number", true),
    field("stock_quantity", "Stock quantity (blank = unverified)", "", "number"),
    field("image_url", "Main image URL", ""),
    field("gallery_urls", "Additional image URLs (one per line)", "", "textarea"),
    field("collection_ids", "Collection IDs (one per line)", "", "textarea"),
    field("description", "Short description", "", "textarea"),
    field("detail_description", "Full product description", "", "textarea")
  );

  const feedback = make("p", "admin-notice");
  feedback.setAttribute("role", "status");

  const submit = make("button", "primary-button", "Create product");
  submit.type = "submit";

  form.append(submit, feedback);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const data = new FormData(form);
    const stock = String(data.get("stock_quantity") || "").trim();

    const product = {
      name: String(data.get("name")).trim(),
      slug: String(data.get("slug")).trim(),
      price: Number(data.get("price")),
      currency: "USD",
      stock_quantity: stock ? Number(stock) : null,
      image_url: String(data.get("image_url")).trim() || null,
      gallery_urls: splitLines(data.get("gallery_urls")),
      collection_ids: splitLines(data.get("collection_ids")),
      description: String(data.get("description")),
      detail_description: String(data.get("detail_description")),
      is_active: false
    };

    submit.disabled = true;
    feedback.textContent = "Creating product…";

    try {
      await api("/api/admin/products", {
        method: "POST",
        body: JSON.stringify(product)
      });

      form.reset();
      feedback.textContent = "Product created successfully. It is currently inactive.";
      await onSuccess();

    } catch (error) {
      feedback.textContent = error.message;
    } finally {
      submit.disabled = false;
    }
  });

  details.append(form);
  return details;
}

export async function renderProductsView(host, api) {
  host.replaceChildren();

  host.append(
    make("h2", "section-title", "Storefront products"),
    make(
      "p",
      "section-copy",
      "Manage your catalogue, product information, storefront visibility and linked supplier research."
    )
  );

  const createPanel = createProductForm(api, () => renderProductsView(host, api));
  host.append(createPanel);

  const search = make("input", "admin-product-search");
  search.type = "search";
  search.placeholder = "Search products by name or slug…";
  search.setAttribute("aria-label", "Search products");

  host.append(search);

  const notice = make("p", "admin-notice", "Loading products…");
  host.append(notice);

  try {
    const result = await api("/api/admin/products");
    const products = result.products || [];

    notice.remove();

    if (!products.length) {
      host.append(make("p", "muted", "No products found. Use Add a new product to get started."));
      return;
    }

    const list = make("div", "admin-product-list");
    host.append(list);

    const draw = () => {
      list.replaceChildren();

      const query = search.value.trim().toLowerCase();

      const filtered = products.filter((product) =>
        `${product.name} ${product.slug} ${product.id}`
          .toLowerCase()
          .includes(query)
      );

      if (!filtered.length) {
        list.append(make("p", "muted", "No matching products."));
        return;
      }

      for (const product of filtered) {
        list.append(renderProduct(product, api, () => renderProductsView(host, api)));
      }
    };

    search.addEventListener("input", draw);
    draw();

  } catch (error) {
    notice.textContent = error.message;
  }
}

function renderProduct(product, api, refresh) {
  const card = make("article", "admin-record");

  const head = make("div", "admin-record-head");

  if (product.image_url) {
    const image = make("img", "admin-record-image");
    image.src = product.image_url;
    image.alt = product.name || "Product image";
    image.loading = "lazy";
    head.append(image);
  }

  const summary = make("div", "admin-record-summary");

  summary.append(
    make("h3", "", product.name),
    make(
      "p",
      "",
      `${formatPrice(product.price, product.currency)} · Stock: ${shown(product.stock_quantity)} · ${product.is_active ? "Active" : "Inactive"}`
    ),
    make(
      "p",
      "record-meta",
      `Product ID ${product.id} · Slug ${product.slug} · CJ ID ${shown(product.supplier_research?.cj_product_id || product.supplier_product_id)}`
    )
  );

  head.append(summary);
  card.append(head);

  // Supplier research information
  const research = product.supplier_research;

  if (research) {
    const metrics = make("div", "record-metrics");

    metrics.append(
      make(
        "span",
        "",
        `Supplier cost: ${research.price_verified ? formatPrice(research.supplier_price) : "Unavailable / unverified"}`
      )
    );

    const marginVerified =
      research.price_verified &&
      research.shipping_cost !== null &&
      research.shipping_cost !== undefined &&
      Number.isFinite(Number(research.estimated_profit));

    metrics.append(
      make(
        "span",
        "",
        `Estimated profit: ${marginVerified ? formatPrice(research.estimated_profit) : "Unavailable / unverified"}`
      )
    );

    metrics.append(
      make(
        "span",
        "",
        `Estimated margin: ${
          marginVerified && Number.isFinite(Number(research.estimated_margin))
            ? `${(Number(research.estimated_margin) * 100).toFixed(1)}%`
            : "Unavailable / unverified"
        }`
      )
    );

    card.append(metrics);

    if (research.variants?.length) {
      const variants = make("details", "variant-details");

      variants.append(
        make("summary", "", `${research.variants.length} supplier variants`)
      );

      for (const variant of research.variants) {
        variants.append(
          make(
            "p",
            "record-meta",
            `${shown(variant.name)} · CJ variant ${shown(variant.id)} · ${
              variant.price === null
                ? "Price unavailable / unverified"
                : formatPrice(variant.price)
            } · Stock ${shown(variant.stock)}`
          )
        );
      }

      card.append(variants);
    }
  }

  // Edit product
  const edit = make("details", "product-edit");

  edit.append(make("summary", "", "Edit product information"));

  const form = make("form", "admin-edit-form");

  form.append(
    field("name", "Product name", product.name, "text", true),
    field("slug", "Product URL slug", product.slug, "text", true),
    field("price", "Retail price", product.price, "number", true),
    field("currency", "Currency (3-letter code)", product.currency || "USD", "text", true),
    field("stock_quantity", "Stock quantity (blank = unverified)", product.stock_quantity ?? "", "number"),
    field("image_url", "Main image URL", product.image_url || ""),
    field("gallery_urls", "Additional image URLs (one per line)", (product.gallery_urls || []).join("\n"), "textarea"),
    field("collection_ids", "Collection IDs (one per line)", (product.collection_ids || []).join("\n"), "textarea"),
    field("description", "Short description", product.description || "", "textarea"),
    field("detail_description", "Full description", product.detail_description || "", "textarea")
  );

  const activeLabel = make("label", "admin-checkbox");
  const active = make("input");

  active.type = "checkbox";
  active.checked = product.is_active === true;

  activeLabel.append(active, make("span", "", "Active in storefront"));
  form.append(activeLabel);

  const save = make("button", "primary-button", "Save product changes");
  save.type = "submit";

  const feedback = make("p", "admin-notice");
  feedback.setAttribute("role", "status");

  form.append(save, feedback);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const data = new FormData(form);
    const stock = String(data.get("stock_quantity") || "").trim();

    const changes = {
      name: String(data.get("name")).trim(),
      slug: String(data.get("slug")).trim(),
      price: Number(data.get("price")),
      currency: String(data.get("currency")).trim().toUpperCase(),
      stock_quantity: stock ? Number(stock) : null,
      image_url: String(data.get("image_url")).trim() || null,
      gallery_urls: splitLines(data.get("gallery_urls")),
      collection_ids: splitLines(data.get("collection_ids")),
      description: String(data.get("description")),
      detail_description: String(data.get("detail_description")),
      is_active: active.checked
    };

    save.disabled = true;
    feedback.textContent = "Saving changes…";

    try {
      await api(`/api/admin/products/${encodeURIComponent(product.id)}`, {
        method: "PATCH",
        body: JSON.stringify(changes)
      });

      await refresh();

    } catch (error) {
      feedback.textContent = error.message;
      save.disabled = false;
    }
  });

  edit.append(form);
  card.append(edit);

  // Delete product
  const actions = make("div", "admin-product-actions");

  const deleteButton = make("button", "danger-button", "Delete product");
  deleteButton.type = "button";

  deleteButton.addEventListener("click", async () => {
    const confirmed = window.confirm(
      `Are you sure you want to delete "${product.name}"?\n\nThis action cannot be undone.`
    );

    if (!confirmed) return;

    deleteButton.disabled = true;
    deleteButton.textContent = "Deleting…";

    try {
      await api(`/api/admin/products/${encodeURIComponent(product.id)}`, {
        method: "DELETE"
      });

      await refresh();

    } catch (error) {
      window.alert(error.message);
      deleteButton.disabled = false;
      deleteButton.textContent = "Delete product";
    }
  });

  actions.append(deleteButton);
  card.append(actions);

  return card;
}