# COKITOMI.SHOP — Multi-page storefront

A custom-coded, responsive teddy bear gifting storefront built with HTML, CSS and JavaScript. It has no Shopify dependency and checkout is disabled.

## Pages

- `index.html` — homepage, featured products and collections
- `shop.html` — catalogue search, collection filtering and sorting
- `collections.html` — collection overview
- `product-<product-slug>.html` — dedicated detail page for each listed teddy
- `product.html?id=<product-id>` — backwards-compatible shared product detail fallback
- `about.html` — brand story and values
- `faq.html` — shipping, order, returns, payment and product questions
- `contact.html` — contact details and non-transmitting demo form
- `cart.html` — full shopping bag review and quantity controls

## Shared files

- `products.js` — central demonstration products and collections
- `assets/products/` — product-specific illustrative gallery images
- `script.js` — shared navigation, product rendering, FAQ/contact behavior and local shopping bag
- `styles.css` — shared brand design and responsive layouts

## Run locally

Open `index.html` in a browser or use VS Code Live Server. Keep all HTML pages and the shared JavaScript, CSS and catalogue file together so relative links continue to work.

## Storefront limitations

The four original products and prices are preserved as demonstration listings. Availability and fulfilment are unconfirmed. The bag uses browser `localStorage` under `cokitomi-cart`; its data is local to that browser. Checkout is disabled, and this project does not connect to payment gateways or suppliers. The contact form displays a demo notice and does not transmit submissions.

Never put payment, supplier or advertising API secrets in browser JavaScript. Store secrets only in server-side environment variables when a backend is implemented.
