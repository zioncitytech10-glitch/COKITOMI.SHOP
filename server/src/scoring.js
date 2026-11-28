const n = (value) => {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

function verifiedSupplierPrice(value, verified) {
  const parsed = n(value);
  return verified === true && parsed !== null && parsed > 0 ? parsed : null;
}

function verifiedShippingCost(value, verified) {
  const parsed = n(value);
  return verified === true && parsed !== null && parsed >= 0 ? parsed : null;
}

export function scoreCandidate(
  candidate,
  { targetMargin = 0.5, paymentFeeRate = 0.03 } = {},
) {
  const supplierPrice = verifiedSupplierPrice(
    candidate.supplierPrice,
    candidate.supplierPriceVerified,
  );
  const shippingCost = verifiedShippingCost(
    candidate.shippingCost,
    candidate.shippingCostVerified,
  );
  const landedCost = supplierPrice === null || shippingCost === null
    ? null
    : supplierPrice + shippingCost;

  // Never derive a retail price, profit, or margin from missing or unverified
  // supplier costs. The target is margin after the estimated payment fee.
  const denominator = 1 - targetMargin - paymentFeeRate;
  const costsVerified = landedCost !== null;
  const pricingConfigurationValid = Number.isFinite(targetMargin)
    && Number.isFinite(paymentFeeRate)
    && targetMargin >= 0
    && paymentFeeRate >= 0
    && denominator > 0;

  const suggestedRetail = costsVerified && pricingConfigurationValid
    ? Number((landedCost / denominator).toFixed(2))
    : null;
  const estimatedPaymentFee = suggestedRetail === null
    ? null
    : Number((suggestedRetail * paymentFeeRate).toFixed(2));
  const estimatedProfit = suggestedRetail === null
    ? null
    : Number((suggestedRetail - landedCost - (suggestedRetail * paymentFeeRate)).toFixed(2));
  const margin = suggestedRetail === null
    ? null
    : (suggestedRetail - landedCost - (suggestedRetail * paymentFeeRate)) / suggestedRetail;

  const inventory = Math.max(0, n(candidate.inventory) ?? 0);
  const rating = Math.min(5, Math.max(0, n(candidate.rating) ?? 0));
  const reviewCount = Math.max(0, n(candidate.reviewCount) ?? 0);
  const deliveryDays = n(candidate.deliveryDays);

  const breakdown = {
    trend: candidate.trending ? 25 : candidate.newArrival ? 12 : 4,
    usAvailability: candidate.usInventory > 0 ? 20 : candidate.usShippingAvailable ? 12 : 0,
    inventory: inventory > 100 ? 15 : inventory > 20 ? 10 : inventory > 0 ? 4 : 0,
    reviews: reviewCount ? Math.min(15, Math.round(rating * 2 + Math.log10(reviewCount + 1) * 2)) : 0,
    delivery: deliveryDays == null ? 0 : deliveryDays <= 7 ? 12 : deliveryDays <= 14 ? 8 : deliveryDays <= 25 ? 4 : 0,
    margin: margin !== null && margin >= 0.5 ? 13 : margin !== null && margin >= 0.35 ? 10 : margin !== null && margin >= 0.2 ? 6 : margin !== null && margin > 0 ? 2 : 0,
  };

  return {
    score: Object.values(breakdown).reduce((total, points) => total + points, 0),
    breakdown,
    supplierPrice,
    shippingCost,
    costsVerified,
    landedCost: landedCost === null ? null : Number(landedCost.toFixed(2)),
    suggestedRetail,
    estimatedPaymentFee,
    estimatedProfit,
    estimatedMargin: margin === null ? null : Number(margin.toFixed(4)),
  };
}
