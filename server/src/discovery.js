import { scoreCandidate } from "./scoring.js";

const CATEGORY_SEARCHES = {
  teddy_bears: ["teddy bear plush", "stuffed bear toy", "plush bear", "giant stuffed teddy bear", "soft toy bear", "cute teddy bear", "bear plush toy", "stuffed animal bear"],
  rose_bouquets: ["artificial rose bouquet", "preserved rose bouquet", "soap rose bouquet", "red rose gift box", "pink rose bouquet", "eternal rose gift"],
  romantic_gifts: ["teddy bear rose gift set", "teddy bear and rose bouquet", "couple bracelet set", "personalised romantic gift", "romantic gift box teddy rose", "heart teddy bear gift"],
};
const SEASONS = ["christmas_2026", "new_year_2027", "valentines_2027", "year_round"];
// Verified from CJ category discovery response on 2026-11-28.
// Avoid repeatedly calling CJ's rate-limited category-tree endpoint.
const VERIFIED_TEDDY_CATEGORIES = [{
  id: "DD918287-C279-466A-B9C6-56079DE4B37A",
  name: "Stuffed & Plush Animals",
  path: "Toys, Kids & Babies > Toys & Hobbies > Stuffed & Plush Animals",
}];
// CJ Product List V2 nests actual products inside data.content[].productList[].
const unwrap = (r) => {
  const data = r?.data;
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.list)) return data.list;
  if (Array.isArray(data?.content)) {
    return data.content.flatMap((entry) =>
      Array.isArray(entry?.productList) ? entry.productList
        : Array.isArray(entry?.list) ? entry.list
        : entry && (entry.pid || entry.productId || entry.id) ? [entry]
        : []
    );
  }
  return [];
};
const first = (...values) => values.find((x) => x !== undefined && x !== null && x !== "");
export function findTeddyBearCategories(categoryResponse) {
  const found = new Map();
  const visit = (value, path = [], seen = new Set()) => {
    if (!value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const item of value) visit(item, path, seen);
      return;
    }
    const firstName = first(value.categoryFirstName, value.categoryFirstNameEn);
    const secondName = first(value.categorySecondName, value.categorySecondNameEn);
    const ownName = first(value.categoryName, value.categoryNameEn, value.nameEn, value.name);
    const nextPath = [...path, ...[firstName, secondName, ownName].filter((name) => typeof name === "string" && name.trim())];
    const id = first(value.categoryId, value.categoryID);
    if (id && ownName) {
      const normalizedPath = [...new Set(nextPath)].join(" > ");
      const text = normalizedPath.toLowerCase();
      const relevant = /plush|stuffed|doll|teddy|soft toy/i.test(text);
      const petCategory = /pet supplies|pet toys|dog toys|cat toys|pet bedding/i.test(text);
      if (relevant && !petCategory) found.set(String(id), { id: String(id), name: String(ownName), path: normalizedPath });
    }
    for (const [key, child] of Object.entries(value)) {
      if (key.toLowerCase().includes("list") || key.toLowerCase() === "children" || Array.isArray(child)) visit(child, nextPath, seen);
    }
  };
  visit(categoryResponse?.data ?? categoryResponse);
  return [...found.values()].slice(0, 12);
}

const num = (x) => Number.isFinite(Number(x)) ? Number(x) : null;
const agingDays = (x) => {
  if (x == null) return null;
  const matches = String(x).match(/\d+(?:\.\d+)?/g);
  return matches?.length ? Math.max(...matches.map(Number)) : null;
};
const imageUrl = (value) => typeof value === "string" ? value
  : value && typeof value === "object" ? first(value.imageUrl, value.url, value.bigImage, value.image) : null;
const knownNumber = (...values) => {
  for (const value of values) {
    if (value === undefined || value === null || value === "") continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return null;
};
const variantId = (variant) => String(first(variant?.vid, variant?.variantId, variant?.id, ""));
const productTitle = (detail, summary) => first(
  detail?.nameEn, detail?.productNameEn, detail?.productName, detail?.productNameCn,
  summary?.nameEn, summary?.productNameEn, summary?.productName, summary?.productNameCn, summary?.name,
);
const productCategoryText = (detail, summary) => [
  detail?.category, detail?.categoryName, detail?.categoryNameEn, detail?.threeCategoryName,
  detail?.twoCategoryName, detail?.oneCategoryName, detail?.productType,
  summary?.threeCategoryName, summary?.twoCategoryName, summary?.oneCategoryName,
  summary?.categoryName, summary?.categoryNameEn, summary?.category,
  summary?.productType,
].filter((value) => typeof value === "string").join(" ");
export const isTeddyBearCandidate = (title, categoryText = "", description = "") => {
  const name = String(title || "").toLowerCase();
  const category = String(categoryText || "").toLowerCase();
  const details = String(description || "").toLowerCase();
  // Exclude non-toy products even when a loose CJ keyword result mentions teddy/bear.
  const excluded = /\b(jacket|coat|hoodie|shirt|pants|dress|clothing|blanket|pillow|cushion|bag|keychain|phone\s*case|wall\s*art|poster|print|cup|mug|tumbler|glass|bottle|drinkware|lamp|light|curtain|rug|mat|car\s*seat|costume)\b/i;
  if (excluded.test(name + " " + details)) return false;
  const hasBear = /\b(teddy|bear)\b/i.test(name);
  const toyEvidence = /\b(plush|stuffed|soft\s*toy|soft\s*stuffed|toy|teddy\s*bear|stuffed\s*animals?)\b/i.test(name + " " + category);
  const descriptionEvidence = /\b(plush|stuffed\s*animals?|soft\s*toy|teddy\s*bear)\b/i.test(details);
  return hasBear && (toyEvidence || descriptionEvidence);
};
export const isRoseBouquetCandidate = (title, categoryText = "") => {
  const name = String(title || "").toLowerCase();
  const category = String(categoryText || "").toLowerCase();
  const excluded = /\b(dress|shirt|jacket|fabric|wallpaper|phone case|nail|sticker|print)\b/i;
  if (excluded.test(name)) return false;
  return /\b(rose|roses)\b/i.test(name)
    && /\b(bouquet|flower|flowers|preserved|eternal|soap rose|gift box)\b/i.test(name + " " + category);
};
export const isRomanticGiftCandidate = (title) => {
  const name = String(title || "").toLowerCase();
  if (/\b(clothing|jacket|coat|shirt|dress|blanket|pillow|wall art|poster|phone case|sticker|keychain)\b/i.test(name)) return false;
  if (/\b(teddy|bear)\b/i.test(name) && /\b(rose|roses|gift|plush|stuffed|toy|bouquet)\b/i.test(name)) return true;
  if (/\b(rose|roses)\b/i.test(name) && /\b(gift|bouquet|box|preserved|eternal)\b/i.test(name)) return true;
  return /\b(couple bracelet|matching bracelet|romantic gift box|personalised gift|personalized gift|heart shaped plush)\b/i.test(name);
};
const withStage = async (stage, operation) => {
  try { return await operation(); }
  catch (error) { error.discoveryStage = stage; throw error; }
};

// Return only allowlisted metadata. Never include CJ response bodies, credentials,
// product payloads, request headers, or raw provider messages in diagnostics.
function safeFailure(phase, error) {
  const httpStatus = Number.isInteger(error?.httpStatus) && error.httpStatus >= 100 && error.httpStatus <= 599 ? error.httpStatus : null;
  const providerCode = Number.isInteger(error?.cjCode) && error.cjCode >= 0 && error.cjCode <= 9999999999
    ? error.cjCode
    : typeof error?.providerCode === "string" && /^[A-Z0-9_-]{1,32}$/.test(error.providerCode) ? error.providerCode : null;
  const classification = error?.timeoutFailure ? "timeout"
    : error?.networkFailure ? "network_error"
    : error?.protocolFailure ? "invalid_provider_response"
    : httpStatus === 429 || providerCode === 1600200 ? "rate_limited"
    : phase === "supabase_save" && (providerCode === "42501" || httpStatus === 403) ? "database_permission_denied"
    : providerCode === 1601000 || [1600001, 1600002, 1600004, 1600005, 1600006].includes(providerCode) ? "cj_authentication_error"
    : httpStatus && httpStatus >= 400 ? "provider_http_error"
    : "provider_error";
  const endpoint = typeof error?.cjEndpoint === "string" && /^\/[A-Za-z0-9/_-]{1,160}$/.test(error.cjEndpoint)
    ? error.cjEndpoint
    : null;
  const requestId = typeof error?.cjRequestId === "string" && /^[A-Za-z0-9._:-]{1,120}$/.test(error.cjRequestId)
    ? error.cjRequestId
    : null;
  const stage = typeof error?.discoveryStage === "string" && /^[a-z_]{1,40}$/.test(error.discoveryStage)
    ? error.discoveryStage
    : null;
  const errorType = ["Error", "TypeError", "RangeError", "ReferenceError", "SyntaxError"].includes(error?.name)
    ? error.name
    : "Error";
  const referenceHint = error?.name === "ReferenceError" && typeof error?.message === "string"
    ? error.message.match(/^([A-Za-z_$][A-Za-z0-9_$]*) is not defined$/)?.[0] || null
    : null;
  return { phase, classification, httpStatus, providerCode, endpoint, requestId, stage, errorType, referenceHint };
}

export class ProductDiscovery {
  constructor({ cj, config, supabase }) { this.cj = cj; this.config = config; this.supabase = supabase; this.categoryCache = null; }

  async search({ keyword, productFlag, categoryId, countryCode = "US" } = {}) {
    const query = {
      ...(keyword ? { keyWord: keyword } : {}),
      ...(categoryId ? { categoryId } : {}),
      ...(countryCode ? { countryCode } : {}),
      ...(productFlag === undefined ? {} : { productFlag }),
      page: 1,
      // Use a larger page for discovery; warehouse and shipping suitability are verified later.
      size: Math.min(100, Math.max(50, this.config.maxCandidates)),
      features: ["enable_category", "enable_description"],
    };
    const response = await this.cj.call("/product/listV2", { query });
    return unwrap(response);
  }

  async research({ category = "teddy_bears", season = "year_round", keywords, productFlags = [0, 1] } = {}) {
    if (!Object.hasOwn(CATEGORY_SEARCHES, category)) throw new TypeError("Unsupported product research category");
    if (!SEASONS.includes(season)) throw new TypeError("Unsupported seasonal collection");
    const selectedKeywords = Array.isArray(keywords) ? keywords : CATEGORY_SEARCHES[category];
    const isRelevant = category === "teddy_bears" ? isTeddyBearCandidate
      : category === "rose_bouquets" ? isRoseBouquetCandidate
      : isRomanticGiftCandidate;
    const diagnostics = {
      searchesAttempted: 0,
      searchesSucceeded: 0,
      searchesFailed: 0,
      productsReturned: 0,
      uniqueProducts: 0,
      productsEvaluated: 0,
      evaluationFailures: 0,
      recommendationsSaved: 0,
      productsFilteredAsIrrelevant: 0,
      productChecks: [],
      categoryDiscovery: { attempted: false, succeeded: false, matchedCategories: [], categorySearches: 0 },
      failures: [],
    };
    const recordFailure = (phase, error) => {
      if (diagnostics.failures.length < 10) diagnostics.failures.push(safeFailure(phase, error));
    };

    const products = new Map();
    if (category === "teddy_bears") {
      // Use the verified CJ category ID locally. Calling /product/getCategory
      // on cold starts caused CJ code 1600200 and blocked research before
      // any product-list query could run.
      const categories = VERIFIED_TEDDY_CATEGORIES;
      diagnostics.categoryDiscovery.attempted = false;
      diagnostics.categoryDiscovery.succeeded = true;
      diagnostics.categoryDiscovery.source = "verified_local_category";
      diagnostics.categoryDiscovery.matchedCategories = categories;
      for (const categoryInfo of categories) {
        const categoryQueries = [
          { categoryId: categoryInfo.id, label: "CJ category: " + categoryInfo.path },
          ...selectedKeywords.slice(0, 8).map((keyword) => ({ categoryId: categoryInfo.id, keyword, label: keyword + " in " + categoryInfo.path })),
        ];
        for (const searchQuery of categoryQueries) {
          diagnostics.searchesAttempted++;
          diagnostics.categoryDiscovery.categorySearches++;
          try {
            const results = await this.search({ categoryId: searchQuery.categoryId, keyword: searchQuery.keyword, countryCode: null });
            diagnostics.searchesSucceeded++;
            diagnostics.productsReturned += results.length;
            for (const product of results) {
              const rawPid = first(product.pid, product.productId, product.id);
              const pid = rawPid == null ? "" : String(rawPid).trim();
              if (pid) products.set(pid, { ...product, _cjPid: pid, _searchedKeyword: searchQuery.label, _categoryPath: categoryInfo.path });
            }
          } catch (error) {
            diagnostics.searchesFailed++;
            recordFailure("cj_category_search", error);
          }
        }
      }
    } else {
      for (const keyword of selectedKeywords.slice(0, 8)) {
        for (const flag of productFlags.slice(0, 2)) {
          diagnostics.searchesAttempted++;
          try {
            const results = await this.search({ keyword, productFlag: flag });
            diagnostics.searchesSucceeded++;
            diagnostics.productsReturned += results.length;
            for (const product of results) {
              const rawPid = first(product.pid, product.productId, product.id);
              const pid = rawPid == null ? "" : String(rawPid).trim();
              if (pid) products.set(pid, { ...product, _cjPid: pid, _searchedKeyword: keyword, _productFlag: flag });
            }
          } catch (error) {
            diagnostics.searchesFailed++;
            recordFailure("cj_search", error);
          }
        }
      }
    }

    // Rank likely teddy-bear toys first, but let product details confirm loose keyword hits.
    const candidates = [...products.values()]
      .sort((a, b) => {
        const title = (item) => String(first(item.nameEn, item.productNameEn, item.productName, item.name, "")).toLowerCase();
        const relevance = (item) => {
          const name = title(item);
          if (/\b(cup|mug|tumbler|glass|bottle|jacket|coat|hoodie|shirt|blanket|pillow|keychain)\b/i.test(name)) return -2;
          if (/\bteddy\s*bear\b/i.test(name)) return 4;
          if (/\b(bear|teddy)\b/i.test(name) && /\b(plush|stuffed|toy|soft)\b/i.test(name)) return 3;
          if (/\b(bear|teddy)\b/i.test(name)) return 2;
          return 0;
        };
        return relevance(b) - relevance(a);
      })
      .slice(0, Math.min(60, this.config.maxCandidates * 3));
    diagnostics.uniqueProducts = candidates.length;
    const recommendations = [];
    for (const summary of candidates) {
      try {
        const recommendation = await this.#evaluate(summary, { isRelevant, category, season });
        if (recommendation?._filtered) {
          diagnostics.productsFilteredAsIrrelevant++;
          if (diagnostics.productChecks.length < 30) diagnostics.productChecks.push(recommendation.check);
        } else if (recommendation) {
          recommendations.push(recommendation);
          diagnostics.productsEvaluated++;
          if (diagnostics.productChecks.length < 30) diagnostics.productChecks.push({
            productId: recommendation.cj_product_id,
            title: recommendation.title,
            category: category,
            passed: true,
            reason: "Passed category relevance filter",
          });
        }
      } catch (error) {
        diagnostics.evaluationFailures++;
        recordFailure("product_evaluation", error);
        const lastFailure = diagnostics.failures[diagnostics.failures.length - 1];
        if (lastFailure && lastFailure.phase === "product_evaluation") {
          const failedProductId = first(summary._cjPid, summary.pid, summary.productId, summary.id);
          lastFailure.productId = failedProductId == null ? null : String(failedProductId).slice(0, 80);
        }
      }
    }
    recommendations.sort((a, b) => b.commercial_score - a.commercial_score);

    if (recommendations.length) {
      try {
        await this.supabase.saveRecommendations(recommendations);
        diagnostics.recommendationsSaved = recommendations.length;
      } catch (error) {
        recordFailure("supabase_save", error);
        error.discoveryDiagnostics = diagnostics;
        throw error;
      }
    }

    return { searched: candidates.length, saved: diagnostics.recommendationsSaved, diagnostics };
  }

  async #evaluate(summary, { isRelevant, category, season }) {
    const rawPid = first(summary._cjPid, summary.pid, summary.productId, summary.id);
    if (rawPid == null || !String(rawPid).trim()) {
      const error = new Error("CJ search result did not contain a product ID");
      error.cjPhase = "product_identifier";
      throw error;
    }
    const pid = String(rawPid).trim();
    const detailsResponse = await withStage("product_detail", () =>
      this.cj.call("/product/productDetail/query", { method: "POST", body: { id: pid } })
    );
    const detail = detailsResponse.data || {};
    const titleValue = productTitle(detail, summary);
    const categoryText = productCategoryText(detail, summary);
    const descriptionValue = String(first(detail.description, detail.productDescription, detail.productDesc, ""));
    const cleanText = (value, limit = 500) => String(value || "")
      .replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, limit);
    if (!titleValue) {
      return {
        _filtered: true,
        check: {
          productId: pid,
          title: null,
          category: cleanText(categoryText, 300),
          description: cleanText(descriptionValue),
          searchedKeyword: summary._searchedKeyword || null,
          passed: false,
          reason: "CJ product detail did not provide a usable product title",
        },
      };
    }
    const passedRelevance = isRelevant(titleValue, categoryText, descriptionValue);
    if (!passedRelevance) {
      return {
        _filtered: true,
        check: {
          productId: pid,
          title: cleanText(titleValue, 300),
          category: cleanText(categoryText, 300),
          description: cleanText(descriptionValue),
          searchedKeyword: summary._searchedKeyword || null,
          passed: false,
          reason: "Product title/category/description did not satisfy the teddy-bear relevance rules",
        },
      };
    }
    let variants = Array.isArray(detail.variants) ? detail.variants : [];
    // The product-detail response can omit variants for some products. CJ's
    // dedicated variant endpoint is the documented fallback for a product ID.
    if (!variants.length) {
      const variantResponse = await withStage("variant_lookup", () =>
        this.cj.call("/product/variant/query", { query: { pid } })
      );
      variants = unwrap(variantResponse);
    }
    const variantRecords = await withStage("variant_processing", () => Promise.all(variants.map(async (entry) => {
      if (!entry || typeof entry !== "object") return {
        id: null, sku: null, name: null, image_url: null, price: null,
        stock: null, stock_verified: false, us_stock: null,
        us_stock_verified: false, warehouses: [], options: null,
      };
      const vid = variantId(entry);
      let stock = knownNumber(entry.variantInventory, entry.inventory, entry.stock);
      let usStock = knownNumber(entry.usInventory, entry.USInventory);
      let warehouseStock = [];
      if (vid && (stock === null || usStock === null)) {
        const stockRows = unwrap(await this.cj.call("/product/stock/queryByVid", { query: { vid } }).catch(() => null));
        warehouseStock = stockRows.map((row) => ({
          country: String(first(row.countryCode, row.country, row.areaCode, "")).toUpperCase() || null,
          warehouse: first(row.warehouseName, row.storageName, row.warehouseCode, row.storageCode) || null,
          quantity: knownNumber(row.totalInventoryNum, row.totalInventory, row.storageNum, row.inventory),
        }));
        const knownStocks = warehouseStock.filter((row) => row.quantity !== null);
        if (stock === null && knownStocks.length) stock = knownStocks.reduce((sum, row) => sum + row.quantity, 0);
        if (usStock === null && knownStocks.some((row) => row.country === "US")) {
          usStock = knownStocks.filter((row) => row.country === "US").reduce((sum, row) => sum + row.quantity, 0);
        }
      }
      return {
        id: vid || null,
        sku: first(entry.variantSku, entry.sku) || null,
        name: first(entry.variantName, entry.variantKey, entry.variantNameEn) || null,
        image_url: imageUrl(first(entry.variantImage, entry.image, entry.imageUrl)) || null,
        price: knownNumber(entry.variantSellPrice, entry.variantPrice, entry.sellPrice),
        stock,
        stock_verified: stock !== null,
        us_stock: usStock,
        us_stock_verified: usStock !== null,
        warehouses: warehouseStock,
        options: first(entry.variantKey, entry.variantProperty, entry.property) || null,
      };
    })));
    const variant = variants.find((entry) => entry && knownNumber(entry.variantInventory, entry.inventory, entry.stock) > 0) || variants.find((entry) => entry && typeof entry === "object") || {};
    const vid = variantId(variant);
    const selected = variantRecords.find((entry) => entry.id === vid) || variantRecords[0] || null;
    const stock = selected?.stock ?? null;
    const usStock = selected?.us_stock ?? null;
    const reviewResponse = await this.cj.call("/product/productComments", { query: { pid, pageNum: 1, pageSize: 20 } }).catch(() => null);
    const reviewRows = unwrap(reviewResponse);
    const ratings = reviewRows.map((r) => num(first(r.score, r.rating, r.star))).filter((x) => x !== null);
    const rating = ratings.length ? ratings.reduce((sum, value) => sum + value, 0) / ratings.length : null;
    const reviewCount = num(reviewResponse?.data?.total) ?? reviewRows.length;
    const sku = String(first(variant.variantSku, variant.sku, detail.productSku, detail.sku, ""));
    const sourceCountry = String(first(detail.sourceCountryCode, detail.countryCode, "CN")).toUpperCase();
    let shipping = null;
    if (sku) {
      const productProps = first(detail.productProEnSet, ["COMMON"]);
      const quote = await this.cj.call("/logistic/freightCalculateTip", { method: "POST", body: { reqDTOS: [{
        srcAreaCode: sourceCountry,
        destAreaCode: "US",
        weight: num(first(variant.variantWeight, detail.productWeight, 500)) || 500,
        wrapWeight: num(first(variant.variantWeight, detail.productWeight, 500)) || 500,
        volume: num(first(detail.productVolume, 60000)) || 60000,
        totalGoodsAmount: num(first(variant.variantSellPrice, variant.variantPrice, detail.productSellPrice, 0)) || 0,
        productProp: Array.isArray(productProps) ? productProps : [productProps],
        skuList: [sku],
        freightTrialSkuList: [{ skuQuantity: 1, sku }],
      }] } }).catch(() => null);
      const methods = Array.isArray(quote?.data) ? quote.data : Array.isArray(quote?.data?.logistics) ? quote.data.logistics : Array.isArray(quote?.data?.logisticsList) ? quote.data.logisticsList : [];
      if (Array.isArray(methods) && methods.length) {
        const sorted = methods.map((m) => ({ cost: num(first(m.totalPostageFee, m.logisticPrice, m.price)), days: agingDays(first(m.logisticAging, m.aging)), name: first(m.logisticName, m.logisticsName) }))
          .filter((m) => m.cost !== null).sort((a, b) => a.cost - b.cost);
        shipping = sorted[0] || null;
      }
    }
    const rawSupplierPrice = knownNumber(variant.variantSellPrice, variant.variantPrice, variant.sellPrice, detail.sellPrice, detail.productSellPrice, summary.sellPrice, summary.nowPrice);
    const supplierPrice = rawSupplierPrice ?? 0;
    const info = {
      supplierPrice,
      shippingCost: shipping?.cost ?? 0,
      inventory: num(stock) || 0,
      usInventory: num(usStock) || 0,
      usShippingAvailable: Boolean(shipping),
      deliveryDays: shipping?.days ?? null,
      rating,
      reviewCount,
      trending: summary._productFlag === 0,
      newArrival: summary._productFlag === 1,
    };
    const scored = await withStage("pricing_scoring", async () => scoreCandidate(info, this.config));
    const title = String(titleValue);
    return {
      cj_product_id: pid,
      cj_variant_id: vid || null,
      title: title.slice(0, 300),
      description: String(first(detail.description, detail.productDescription, "")).slice(0, 5000),
      image_url: imageUrl(first(detail.bigImg, detail.bigImage, detail.productImage, detail.productImageUrl, summary.bigImage, summary.productImage, summary.productImageUrl)),
      gallery: [...new Set([
        ...(Array.isArray(detail.productImageSet) ? detail.productImageSet : []),
        ...(Array.isArray(detail.image) ? detail.image : typeof detail.img === "string" ? detail.img.split(",") : []),
      ].map(imageUrl).filter((url) => typeof url === "string" && url.trim()).map((url) => url.trim()))].slice(0, 50),
      variant_data: { sku: sku || null, name: first(variant.variantName, variant.variantKey), options: variant.variantKey || null, variants: variantRecords },
      supplier_data: {
        supplier: "CJdropshipping", country: sourceCountry, warehouse_us_inventory: info.usInventory,
        inventory_verified: selected?.stock_verified === true, price_verified: rawSupplierPrice !== null,
      },
      supplier_price: scored.supplierPrice,
      shipping_cost: shipping?.cost ?? null,
      shipping_method: shipping?.name ?? null,
      delivery_days: shipping?.days ?? null,
      inventory: info.inventory,
      us_inventory: info.usInventory,
      review_rating: rating,
      review_count: reviewCount,
      suggested_retail_price: scored.suggestedRetail,
      estimated_landed_cost: scored.landedCost,
      estimated_profit: scored.estimatedProfit,
      estimated_margin: scored.estimatedMargin,
      commercial_score: scored.score,
      score_breakdown: scored.breakdown,
      research_signals: { searched_keyword: summary._searchedKeyword, product_category: category, seasonal_collection: season, trending: info.trending, new_arrival: info.newArrival, shipping_quote_available: Boolean(shipping) },
      status: "pending",
      researched_at: new Date().toISOString(),
    };
  }
}
