import { scoreCandidate } from "./scoring.js";

const KEYWORDS = ["teddy bear", "plush bear", "giant teddy bear", "rose teddy bear", "teddy bear gift"];
const unwrap = (r) => Array.isArray(r?.data) ? r.data : Array.isArray(r?.data?.list) ? r.data.list : Array.isArray(r?.data?.content) ? r.data.content : [];
const first = (...values) => values.find((x) => x !== undefined && x !== null && x !== "");
const num = (x) => Number.isFinite(Number(x)) ? Number(x) : null;
const agingDays = (x) => {
  if (x == null) return null;
  const matches = String(x).match(/\d+(?:\.\d+)?/g);
  return matches?.length ? Math.max(...matches.map(Number)) : null;
};

export class ProductDiscovery {
  constructor({ cj, config, supabase }) { this.cj = cj; this.config = config; this.supabase = supabase; }

  async search(keyword, productFlag) {
    const response = await this.cj.call("/product/listV2", { query: {
      keyWord: keyword,
      countryCode: "US",
      productFlag,
      page: 1,
      size: Math.min(20, this.config.maxCandidates),
    } });
    return unwrap(response);
  }

  async research({ keywords = KEYWORDS, productFlags = [0, 1] } = {}) {
    const products = new Map();
    for (const keyword of keywords.slice(0, 8)) {
      for (const flag of productFlags.slice(0, 2)) {
        const results = await this.search(keyword, flag).catch(() => []);
        for (const product of results) {
          const pid = String(first(product.pid, product.productId, product.id, ""));
          if (pid) products.set(pid, { ...product, _searchedKeyword: keyword, _productFlag: flag });
        }
      }
    }
    const candidates = [...products.values()].slice(0, this.config.maxCandidates);
    const recommendations = [];
    for (const summary of candidates) {
      try { recommendations.push(await this.#evaluate(summary)); } catch { /* Skip malformed or unavailable supplier records. */ }
    }
    recommendations.sort((a, b) => b.commercial_score - a.commercial_score);
    if (recommendations.length) await this.supabase.saveRecommendations(recommendations);
    return { searched: candidates.length, saved: recommendations.length };
  }

  async #evaluate(summary) {
    const pid = String(first(summary.pid, summary.productId, summary.id));
    const detailsResponse = await this.cj.call("/product/productDetail/query", { method: "POST", body: { id: pid } });
    const detail = detailsResponse.data || {};
    const variants = Array.isArray(detail.variants) ? detail.variants : [];
    const variant = variants.find((v) => num(first(v.variantInventory, v.inventory, v.stock)) > 0) || variants[0] || {};
    const vid = String(first(variant.vid, variant.variantId, ""));
    let stock = first(variant.variantInventory, variant.inventory, variant.stock, 0);
    let usStock = first(variant.usInventory, variant.USInventory, 0);
    if (vid) {
      const stockResponse = await this.cj.call("/product/stock/queryByVid", { query: { vid } }).catch(() => null);
      const stockRows = unwrap(stockResponse);
      if (stockRows.length) {
        stock = stockRows.reduce((sum, row) => sum + (num(first(row.totalInventoryNum, row.totalInventory, row.storageNum, row.inventory)) || 0), 0);
        usStock = stockRows.filter((row) => String(first(row.countryCode, row.country, "")).toUpperCase() === "US")
          .reduce((sum, row) => sum + (num(first(row.totalInventoryNum, row.totalInventory, row.storageNum, row.inventory)) || 0), 0);
      }
    }
    const reviewResponse = await this.cj.call("/product/productComments", { query: { pid, pageNum: 1, pageSize: 20 } }).catch(() => null);
    const reviewRows = unwrap(reviewResponse);
    const ratings = reviewRows.map((r) => num(first(r.score, r.rating, r.star))).filter((x) => x !== null);
    const rating = ratings.length ? ratings.reduce((sum, value) => sum + value, 0) / ratings.length : null;
    const reviewCount = num(reviewResponse?.data?.total) ?? reviewRows.length;
    const sku = String(first(variant.variantSku, detail.productSku, ""));
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
    const supplierPrice = num(first(variant.variantSellPrice, variant.variantPrice, detail.sellPrice, detail.productSellPrice, summary.sellPrice)) || 0;
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
    const scored = scoreCandidate(info, this.config);
    const title = String(first(detail.productNameEn, summary.productNameEn, summary.productName, "CJ teddy bear"));
    return {
      cj_product_id: pid,
      cj_variant_id: vid || null,
      title: title.slice(0, 300),
      description: String(first(detail.description, detail.productDescription, "")).slice(0, 5000),
      image_url: first(detail.bigImage, detail.productImage, detail.productImageUrl, summary.bigImage, summary.productImage, summary.productImageUrl) || null,
      gallery: Array.isArray(detail.productImageSet) ? detail.productImageSet.slice(0, 20) : Array.isArray(detail.image) ? detail.image.slice(0, 20) : [],
      variant_data: { sku: sku || null, name: first(variant.variantName, variant.variantKey), options: variant.variantKey || null },
      supplier_data: { supplier: "CJdropshipping", country: sourceCountry, warehouse_us_inventory: info.usInventory },
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
      research_signals: { searched_keyword: summary._searchedKeyword, trending: info.trending, new_arrival: info.newArrival, shipping_quote_available: Boolean(shipping) },
      status: "pending",
      researched_at: new Date().toISOString(),
    };
  }
}
