const PRODUCT_FIELDS = new Set([
  "slug", "name", "description", "detail_description", "price", "currency",
  "image_url", "gallery_urls", "collection_ids", "stock_quantity", "is_active",
]);

export function validateProductChanges(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw Object.assign(new Error("Invalid product changes"), { status: 400 });
  const keys = Object.keys(input);
  if (!keys.length || keys.some((key) => !PRODUCT_FIELDS.has(key))) throw Object.assign(new Error("Unsupported product fields"), { status: 400 });
  const output = {};
  for (const [key, value] of Object.entries(input)) {
    if (["name", "slug", "currency"].includes(key) && typeof value !== "string") throw Object.assign(new Error(`Invalid ${key}`), { status: 400 });
    if (["description", "detail_description", "image_url"].includes(key) && value !== null && typeof value !== "string") throw Object.assign(new Error(`Invalid ${key}`), { status: 400 });
    if (key === "name" && (!value.trim() || value.length > 300)) throw Object.assign(new Error("Invalid name"), { status: 400 });
    if (key === "slug" && (value.length > 180 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value))) throw Object.assign(new Error("Slug must contain lowercase letters, numbers and hyphens"), { status: 400 });
    if (key === "currency" && !/^[A-Z]{3}$/.test(value)) throw Object.assign(new Error("Currency must be a three-letter code"), { status: 400 });
    if (["description", "detail_description"].includes(key) && value?.length > 10000) throw Object.assign(new Error(`Invalid ${key}`), { status: 400 });
    if (key === "image_url" && value && !(/^(https:\/\/|assets\/|\/)/i.test(value) && !value.startsWith("//"))) throw Object.assign(new Error("Product image must use HTTPS or a local site path"), { status: 400 });
    if (key === "price" && (!Number.isFinite(value) || value < 0 || value > 1000000)) throw Object.assign(new Error("Invalid price"), { status: 400 });
    if (key === "stock_quantity" && value !== null && (!Number.isSafeInteger(value) || value < 0)) throw Object.assign(new Error("Invalid stock quantity"), { status: 400 });
    if (key === "is_active" && typeof value !== "boolean") throw Object.assign(new Error("Invalid product status"), { status: 400 });
    if (["gallery_urls", "collection_ids"].includes(key)) {
      if (!Array.isArray(value) || value.length > 50 || value.some((entry) => typeof entry !== "string" || entry.length > 1000)) {
        throw Object.assign(new Error(`Invalid ${key}`), { status: 400 });
      }
      if (key === "gallery_urls" && value.some((entry) => !(/^(https:\/\/|assets\/|\/)/i.test(entry) && !entry.startsWith("//")))) throw Object.assign(new Error("Gallery images must use HTTPS or a local site path"), { status: 400 });
      if (key === "collection_ids" && value.some((entry) => !/^[a-z0-9-]{1,80}$/.test(entry))) throw Object.assign(new Error("Invalid collection id"), { status: 400 });
    }
    output[key] = value;
  }
  return output;
}

export function validatePublishRequest(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw Object.assign(new Error("Invalid publish request"), { status: 400 });
  if (Object.keys(input).some((key) => !["slug", "price", "collection_ids"].includes(key))) throw Object.assign(new Error("Unsupported publish fields"), { status: 400 });
  const slug = input.slug;
  const price = input.price;
  const collectionIds = input.collection_ids ?? [];
  if (typeof slug !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 180) throw Object.assign(new Error("A valid storefront slug is required"), { status: 400 });
  if (!Number.isFinite(price) || price <= 0 || price > 1000000) throw Object.assign(new Error("A positive retail price is required"), { status: 400 });
  if (!Array.isArray(collectionIds) || collectionIds.some((value) => typeof value !== "string" || !/^[a-z0-9-]{1,80}$/.test(value))) throw Object.assign(new Error("Invalid collection ids"), { status: 400 });
  return { slug, price, collectionIds };
}
