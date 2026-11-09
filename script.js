(() => {
  if (window.__cokitomiStorefrontInitialized) return;
  window.__cokitomiStorefrontInitialized = true;

  const products = (window.COKITOMI_PRODUCTS || []).map(product => ({
    ...product,
    additionalImages: [...(product.additionalImages || [])],
    collections: [...(product.collections || [])],
    specifications: [...(product.specifications || [])]
  }));
  const collections = window.COKITOMI_COLLECTIONS || [];
  const money = value => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
  const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
  const safeCatalogueImage = value => {
    if (typeof value !== "string") return "";
    const image = value.trim();
    return /^(https:\/\/|http:\/\/|assets\/|\/)/i.test(image) && !image.startsWith("//") ? image : "";
  };
  const getProduct = id => products.find(product => product.id === Number(id));
  const productUrl = id => {
    const product = getProduct(id);
    return product?.slug ? `product-${product.slug}.html` : `product.html?id=${encodeURIComponent(id)}`;
  };

  function loadCart() {
    try {
      const saved = JSON.parse(localStorage.getItem("cokitomi-cart") || "[]");
      if (!Array.isArray(saved)) return [];
      return saved
        .filter(item => item && getProduct(item.id) && Number.isInteger(item.qty) && item.qty > 0)
        .map(item => ({ id: Number(item.id), qty: item.qty }));
    } catch {
      return [];
    }
  }

  let cart = loadCart();
  const page = document.body.dataset.page || "home";

  function mountShell() {
    const navItems = [
      ["home", "Home", "index.html"],
      ["shop", "Shop All", "shop.html"],
      ["collections", "Collections", "collections.html"],
      ["about", "Our Story", "about.html"],
      ["faq", "FAQ", "faq.html"],
      ["contact", "Contact", "contact.html"]
    ];
    const headerHost = document.getElementById("siteHeader");
    if (headerHost) {
      headerHost.innerHTML = `
        <div class="announcement">A little joy, delivered to your door <span>♡</span> Thoughtful gifts for every occasion</div>
        <header class="site-header">
          <a class="logo" href="index.html" aria-label="COKITOMI home">cokitomi<span>.</span><small>GIFTS THAT MAKE YOU SMILE</small></a>
          <button class="menu-toggle" id="menuToggle" type="button" aria-label="Open navigation menu" aria-expanded="false" aria-controls="mainNav">☰</button>
          <nav class="main-nav" id="mainNav" aria-label="Main navigation">
            ${navItems.map(([key, label, href]) => `<a href="${href}"${page === key ? ' aria-current="page"' : ""}>${label}</a>`).join("")}
            <a class="mobile-cart-link" href="cart.html">Shopping Bag</a>
          </nav>
          <button class="cart-button" id="openCart" type="button" aria-label="Open shopping bag">Bag <span id="cartCount" aria-live="polite">0</span></button>
        </header>`;
    }

    const footerHost = document.getElementById("siteFooter");
    if (footerHost) {
      footerHost.innerHTML = `
        <footer class="footer">
          <a class="logo footer-logo" href="index.html">cokitomi<span>.</span><small>GIFTS THAT MAKE YOU SMILE</small></a>
          <p>For every hug that needs sending. ♡</p>
          <nav class="footer-links" aria-label="Footer navigation">
            <a href="shop.html">Shop</a><a href="collections.html">Collections</a><a href="about.html">Our story</a>
            <a href="faq.html">FAQ</a><a href="contact.html">Contact</a><a href="cart.html">Shopping bag</a>
          </nav>
          <small>© <span>${new Date().getFullYear()}</span> COKITOMI.SHOP. All rights reserved.</small>
          <p class="demo-disclaimer">Demonstration storefront · Product availability is unconfirmed</p>
        </footer>`;
    }

    const cartHost = document.getElementById("sharedCart");
    if (cartHost) {
      cartHost.innerHTML = `
        <div class="cart-overlay" id="cartOverlay" aria-hidden="true"></div>
        <aside class="cart-drawer" id="cartDrawer" role="dialog" aria-modal="true" aria-labelledby="cartTitle" aria-hidden="true" inert>
          <div class="cart-head"><h2 id="cartTitle">Your bag <span id="drawerCount">(0)</span></h2><button id="closeCart" type="button" aria-label="Close bag">×</button></div>
          <div class="cart-items" id="cartItems"></div>
          <div class="cart-bottom">
            <div class="subtotal"><span>Subtotal</span><strong id="cartSubtotal">$0.00</strong></div>
            <p>Shipping and taxes calculated at checkout.</p>
            <button class="button button-dark checkout-button" type="button" disabled>Checkout unavailable</button>
            <a class="cart-page-link" href="cart.html">View shopping bag</a>
            <small>Checkout will be available after secure payment integration.</small>
          </div>
        </aside>`;
    }

    document.getElementById("menuToggle")?.addEventListener("click", toggleMenu);
    document.getElementById("openCart")?.addEventListener("click", openCart);
    document.getElementById("closeCart")?.addEventListener("click", closeCart);
    document.getElementById("cartOverlay")?.addEventListener("click", closeCart);
    document.getElementById("mainNav")?.addEventListener("click", event => {
      if (event.target.closest("a")) closeMenu();
    });
  }

  function productBadges(product) {
    return [product.isBestseller ? "Bestseller" : "", product.isNew ? "New" : "", product.cardLabel || ""]
      .filter(Boolean)
      .map(label => `<span class="badge">${escapeHtml(label)}</span>`)
      .join("");
  }

  function productCard(product) {
    const name = escapeHtml(product.name);
    const image = escapeHtml(product.image);
    const url = escapeHtml(productUrl(product.id));
    return `<article class="product-card">
      <a class="product-image" href="${url}" aria-label="View ${name}">
        <img src="${image}" alt="${name}" loading="lazy">
        <span class="product-badges">${productBadges(product)}</span>
      </a>
      <div class="product-info">
        <h3><a href="${url}">${name}</a></h3>
        <p>${escapeHtml(product.description)}</p>
        <span class="demo-availability">Demo product · availability unconfirmed</span>
        <span class="price">${money(product.price)}</span>
        <div class="product-actions">
          <a class="button button-light view-product" href="${url}">View Product</a>
          <button class="button button-dark product-add" type="button" data-add-to-bag="${product.id}" aria-label="Add ${name} to bag">Add to Bag</button>
        </div>
      </div>
    </article>`;
  }

  function collectionCard(collection) {
    const count = products.filter(product => product.collections.includes(collection.id)).length;
    return `<article class="collection-card">
      <a class="collection-image" href="shop.html?collection=${encodeURIComponent(collection.id)}" aria-label="Browse ${collection.name}">
        <img src="${collection.image}" alt="${collection.name}" loading="lazy">
      </a>
      <div class="collection-card-copy">
        <p class="eyebrow">${count ? `${count} demo ${count === 1 ? "listing" : "listings"}` : "New collection"}</p>
        <h3><a href="shop.html?collection=${encodeURIComponent(collection.id)}">${collection.name}</a></h3>
        <p>${collection.description}</p>
        <a class="text-link" href="shop.html?collection=${encodeURIComponent(collection.id)}">Explore collection →</a>
      </div>
    </article>`;
  }

  function renderProducts(targetId, list) {
    const target = document.getElementById(targetId);
    if (target) target.innerHTML = list.length
      ? list.map(productCard).join("")
      : `<div class="catalogue-empty"><p>No demo products are assigned to this collection yet.</p><a class="text-link" href="shop.html">Browse all products →</a></div>`;
  }

  function initHome() {
    const featured = document.getElementById("featuredProducts");
    if (featured) renderProducts("featuredProducts", products.filter(product => product.isBestseller || product.isNew).concat(products.filter(product => !product.isBestseller && !product.isNew)).slice(0, 4));
    const bestsellers = document.getElementById("bestsellerProducts");
    if (bestsellers) renderProducts("bestsellerProducts", products.filter(product => product.isBestseller));
    const featuredCollections = document.getElementById("featuredCollections");
    if (featuredCollections) featuredCollections.innerHTML = collections.slice(0, 4).map(collectionCard).join("");
  }

  function initShop() {
    const grid = document.getElementById("shopGrid");
    if (!grid) return;
    const search = document.getElementById("productSearch");
    const collectionFilter = document.getElementById("shopCollection");
    const sort = document.getElementById("shopSort");
    const params = new URLSearchParams(window.location.search);
    const initialCollection = params.get("collection");
    collectionFilter.innerHTML = `<option value="">All Products</option>${collections.map(collection => `<option value="${collection.id}">${collection.name}</option>`).join("")}`;
    if (initialCollection && collections.some(collection => collection.id === initialCollection)) collectionFilter.value = initialCollection;

    const update = () => {
      const query = search.value.trim().toLowerCase();
      const collectionId = collectionFilter.value;
      const sortMode = sort.value;
      let list = products.filter(product =>
        (!collectionId || product.collections.includes(collectionId)) &&
        (!query || `${product.name} ${product.description} ${product.detailDescription}`.toLowerCase().includes(query))
      );
      if (sortMode === "low") list.sort((a, b) => a.price - b.price);
      if (sortMode === "high") list.sort((a, b) => b.price - a.price);
      if (sortMode === "newest") list.sort((a, b) => b.newestRank - a.newestRank);
      renderProducts("shopGrid", list);
      const status = document.getElementById("shopResultCount");
      if (status) status.textContent = `${list.length} demo product${list.length === 1 ? "" : "s"}`;
    };
    search.addEventListener("input", update);
    collectionFilter.addEventListener("change", update);
    sort.addEventListener("change", update);
    window.COKITOMI_REFRESH_SHOP = update;
    update();
  }

  function initCollections() {
    const target = document.getElementById("collectionGrid");
    if (target) target.innerHTML = collections.map(collectionCard).join("");
  }

  function initProductPage() {
    const target = document.getElementById("productDetail");
    if (!target) return;
    const productId = document.body.dataset.productId || new URLSearchParams(window.location.search).get("id");
    const product = getProduct(productId);
    if (!product) {
      target.innerHTML = `<div class="catalogue-empty"><h2>We couldn’t find that teddy.</h2><p>Choose a demo product from the catalogue to see its details.</p><a class="button button-dark" href="shop.html">Shop all products</a></div>`;
      return;
    }
    const images = [...new Set([product.image, ...(product.additionalImages || [])])].map(safeCatalogueImage).filter(Boolean);
    const related = products
      .filter(item => item.id !== product.id && item.collections.some(id => product.collections.includes(id)))
      .concat(products.filter(item => item.id !== product.id && !item.collections.some(id => product.collections.includes(id))))
      .slice(0, 3);
    const collection = collections.find(item => product.collections.includes(item.id));
    const breadcrumb = document.getElementById("productBreadcrumb");
    if (breadcrumb) breadcrumb.textContent = collection?.name || "Shop All";
    document.title = `${product.name} | COKITOMI`;
    const productName = escapeHtml(product.name);
    target.innerHTML = `
      <div class="product-detail-layout">
        <div class="detail-gallery">
          <img class="detail-main-image" id="detailMainImage" src="${escapeHtml(images[0])}" alt="${productName}">
          <div class="detail-thumbnails" id="detailThumbnails" aria-label="Product image gallery">
            ${images.map((image, index) => `<button class="detail-thumbnail${index === 0 ? " is-selected" : ""}" type="button" data-detail-image="${index}" aria-label="View image ${index + 1} of ${productName}" aria-pressed="${index === 0}"><img src="${escapeHtml(image)}" alt=""></button>`).join("")}
          </div>
        </div>
        <div class="detail-copy">
          <p class="eyebrow">${collection?.name || "COKITOMI DEMO"}</p>
          <h1>${productName}</h1>
          <p class="detail-price">${money(product.price)}</p>
          <p class="detail-description">${escapeHtml(product.detailDescription)}</p>
          <p class="detail-availability">Demo product · Availability and fulfilment unconfirmed</p>
        <section class="specifications" aria-labelledby="specificationsTitle">
          <h2 id="specificationsTitle">Product details</h2>
          <dl>${(product.specifications || []).map(specification => `<div><dt>${escapeHtml(specification.label)}</dt><dd>${escapeHtml(specification.value)}</dd></div>`).join("")}</dl>
        </section>
          <div class="detail-actions">
            <label class="quantity-label" for="productQuantity">Quantity</label>
            <input id="productQuantity" type="number" min="1" step="1" value="1" inputmode="numeric">
            <button class="button button-dark" type="button" data-add-to-bag="${product.id}" data-quantity-input="productQuantity">Add to Bag</button>
          </div>
          <p class="detail-checkout-note">Checkout is not available yet.</p>
        </div>
      </div>
      <section class="related-section" aria-labelledby="relatedTitle">
        <div class="section-heading"><h2 id="relatedTitle">You may also love</h2><a class="text-link" href="shop.html">Shop all →</a></div>
        <div class="product-grid related-products">${related.map(productCard).join("")}</div>
      </section>`;
    target.querySelector("#detailThumbnails")?.addEventListener("click", event => {
      const button = event.target.closest("[data-detail-image]");
      if (!button) return;
      const index = Number(button.dataset.detailImage);
      document.getElementById("detailMainImage").src = images[index];
      target.querySelectorAll(".detail-thumbnail").forEach(thumbnail => {
        const selected = thumbnail === button;
        thumbnail.classList.toggle("is-selected", selected);
        thumbnail.setAttribute("aria-pressed", String(selected));
      });
    });
  }

  function emptyCartMarkup() {
    return `<div class="empty-cart cart-empty-state">
      <img src="${escapeHtml(products[0]?.image || "")}" alt="A soft teddy bear sitting with a cosy blanket">
      <h2>Your bag is waiting for a little love.</h2>
      <a class="button button-dark" href="shop.html">Continue Shopping</a>
    </div>`;
  }

  function cartRow(item, pageView = false) {
    const product = getProduct(item.id);
    if (!product) return "";
    const name = escapeHtml(product.name);
    const image = escapeHtml(product.image);
    const url = escapeHtml(productUrl(product.id));
    return `<article class="cart-item${pageView ? " cart-page-item" : ""}">
      <a class="cart-item-image" href="${url}"><img src="${image}" alt="${name}"></a>
      <div class="cart-item-copy">
        <h3><a href="${url}">${name}</a></h3>
        <p>${money(product.price)} each · Demo product</p>
        <div class="cart-quantity" aria-label="Quantity controls for ${name}">
          <button type="button" data-cart-step="-1" data-product-id="${product.id}" aria-label="Decrease ${name} quantity">−</button>
          <span>Qty ${item.qty}</span>
          <button type="button" data-cart-step="1" data-product-id="${product.id}" aria-label="Increase ${name} quantity">+</button>
        </div>
        <button class="remove-item" type="button" data-remove-product="${product.id}">Remove</button>
      </div>
      <strong class="cart-line-total">${money(product.price * item.qty)}</strong>
    </article>`;
  }

  function cartTotals() {
    const count = cart.reduce((total, item) => total + item.qty, 0);
    const subtotal = cart.reduce((total, item) => total + (getProduct(item.id)?.price || 0) * item.qty, 0);
    return { count, subtotal };
  }

  function renderCart() {
    const { count, subtotal } = cartTotals();
    const countBadge = document.getElementById("cartCount");
    if (countBadge) countBadge.textContent = count;
    const drawerCount = document.getElementById("drawerCount");
    if (drawerCount) drawerCount.textContent = `(${count})`;
    const drawerSubtotal = document.getElementById("cartSubtotal");
    if (drawerSubtotal) drawerSubtotal.textContent = money(subtotal);
    const drawerItems = document.getElementById("cartItems");
    if (drawerItems) drawerItems.innerHTML = cart.length ? cart.map(item => cartRow(item)).join("") : emptyCartMarkup();

    const pageItems = document.getElementById("cartPageItems");
    if (pageItems) pageItems.innerHTML = cart.length ? cart.map(item => cartRow(item, true)).join("") : emptyCartMarkup();
    const pageSubtotal = document.getElementById("cartPageSubtotal");
    if (pageSubtotal) pageSubtotal.textContent = money(subtotal);
    const pageCount = document.getElementById("cartPageCount");
    if (pageCount) pageCount.textContent = `${count} item${count === 1 ? "" : "s"}`;
    // Checkout intentionally remains disabled on both the drawer and cart page.
  }

  function saveCart() {
    try { localStorage.setItem("cokitomi-cart", JSON.stringify(cart)); } catch { /* local cart remains in memory */ }
    renderCart();
  }

  function applySupabaseProducts(rows) {
    if (!Array.isArray(rows)) return 0;
    let matched = 0;
    rows.forEach(row => {
      if (!row || row.is_active !== true || typeof row.slug !== "string") return;
      if (String(row.currency || "USD").trim().toUpperCase() !== "USD") return;
      const product = products.find(item => item.slug === row.slug);
      if (!product) return;

      const name = typeof row.name === "string" ? row.name.trim() : "";
      const description = typeof row.description === "string" ? row.description.trim() : "";
      const detailDescription = typeof row.detail_description === "string" ? row.detail_description.trim() : "";
      const price = Number(row.price);
      if (name) product.name = name;
      if (description) product.description = description;
      if (detailDescription) product.detailDescription = detailDescription;
      if (Number.isFinite(price) && price >= 0) product.price = price;

      const databaseImages = [row.image_url, ...(Array.isArray(row.gallery_urls) ? row.gallery_urls : [])]
        .map(safeCatalogueImage)
        .filter(image => image && image !== product.image);
      product.additionalImages = [...new Set([...(product.additionalImages || []), ...databaseImages])];
      matched += 1;
    });
    return matched;
  }

  function refreshCatalogueFromSupabase(rows) {
    const matched = applySupabaseProducts(rows);
    if (!matched) return;
    initHome();
    window.COKITOMI_REFRESH_SHOP?.();
    initProductPage();
    renderCart();
  }

  function addToCart(id, quantity = 1) {
    const product = getProduct(id);
    if (!product) return;
    const number = Number(quantity);
    const amount = Number.isFinite(number) ? Math.max(1, Math.floor(number)) : 1;
    const existing = cart.find(item => item.id === product.id);
    if (existing) existing.qty += amount;
    else cart.push({ id: product.id, qty: amount });
    saveCart();
    openCart();
  }

  function updateQuantity(id, quantity) {
    const item = cart.find(entry => entry.id === Number(id));
    if (!item) return;
    const parsed = Number(quantity);
    if (!Number.isFinite(parsed) || parsed < 1) {
      cart = cart.filter(entry => entry.id !== Number(id));
    } else {
      item.qty = Math.floor(parsed);
    }
    saveCart();
  }

  function stepQuantity(id, amount) {
    const item = cart.find(entry => entry.id === Number(id));
    if (item) updateQuantity(id, item.qty + amount);
  }

  function removeFromCart(id) {
    cart = cart.filter(item => item.id !== Number(id));
    saveCart();
  }

  function openCart() {
    const drawer = document.getElementById("cartDrawer");
    if (!drawer) return;
    drawer.inert = false;
    drawer.setAttribute("aria-hidden", "false");
    drawer.classList.add("show");
    document.getElementById("cartOverlay").classList.add("show");
    document.getElementById("closeCart").focus();
  }

  function closeCart() {
    const drawer = document.getElementById("cartDrawer");
    if (!drawer) return;
    drawer.classList.remove("show");
    document.getElementById("cartOverlay").classList.remove("show");
    drawer.setAttribute("aria-hidden", "true");
    drawer.inert = true;
    document.getElementById("openCart")?.focus();
  }

  function closeMenu() {
    const menu = document.getElementById("mainNav");
    const toggle = document.getElementById("menuToggle");
    if (!menu || !toggle) return;
    menu.classList.remove("open");
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-label", "Open navigation menu");
  }

  function toggleMenu() {
    const menu = document.getElementById("mainNav");
    const toggle = document.getElementById("menuToggle");
    const open = toggle.getAttribute("aria-expanded") !== "true";
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", open ? "Close navigation menu" : "Open navigation menu");
    menu.classList.toggle("open", open);
  }

  function initContactForm() {
    const form = document.getElementById("contactForm");
    if (!form) return;
    form.addEventListener("submit", event => {
      event.preventDefault();
      document.getElementById("contactFeedback").textContent = "This demo form does not send messages yet. Please email hello@cokitomi.shop and we’ll be happy to help.";
      form.reset();
    });
  }

  function bindSharedActions() {
    document.addEventListener("click", event => {
      const add = event.target.closest("[data-add-to-bag]");
      if (add) {
        const quantityInput = add.dataset.quantityInput ? document.getElementById(add.dataset.quantityInput) : null;
        addToCart(add.dataset.addToBag, quantityInput?.value || 1);
        return;
      }
      const step = event.target.closest("[data-cart-step]");
      if (step) { stepQuantity(step.dataset.productId, Number(step.dataset.cartStep)); return; }
      const remove = event.target.closest("[data-remove-product]");
      if (remove) removeFromCart(remove.dataset.removeProduct);
    });

    document.addEventListener("change", event => {
      const quantity = event.target.closest("[data-cart-quantity]");
      if (quantity) updateQuantity(quantity.dataset.productId, quantity.value);
    });

    document.addEventListener("keydown", event => {
      const drawer = document.getElementById("cartDrawer");
      if (event.key === "Escape") {
        if (drawer?.classList.contains("show")) closeCart();
        else closeMenu();
      }
      if (event.key === "Tab" && drawer?.classList.contains("show")) {
        const focusable = [...drawer.querySelectorAll('button:not(:disabled),a[href],select:not(:disabled),[tabindex]:not([tabindex="-1"])')];
        const first = focusable[0], last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    });
  }

  mountShell();
  bindSharedActions();
  initHome();
  initShop();
  initCollections();
  initProductPage();
  initContactForm();
  renderCart();
  if (window.COKITOMI_SUPABASE_PRODUCTS_PROMISE && typeof window.COKITOMI_SUPABASE_PRODUCTS_PROMISE.then === "function") {
    window.COKITOMI_SUPABASE_PRODUCTS_PROMISE
      .then(refreshCatalogueFromSupabase)
      .catch(() => console.warn("COKITOMI: Supabase catalogue unavailable; using local products."));
  }
})();
