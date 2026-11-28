const n = (value) => {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export function scoreCandidate(
  candidate,
  { retailMultiplier = 2.5, targetMargin = null, paymentFeeRate = 0.03 } = {},
) {
  const productCost = n(candidate.supplierPrice);
  const shippingCost = n(candidate.shippingCost);
  const costsVerified = productCost !== null && shippingCost !== null;
  const landedCost = costsVerified ? productCost + shippingCost : null;

  // Profit and retail price are only calculated when BOTH supplier price and
  // shipping are verified. Missing costs must never be silently treated as $0.
  const effectiveMultiplier = Number.isFinite(targetMargin)
    ? 1 / Math.max(0.01, 1 - targetMargin - paymentFeeRate)
    : retailMultiplier;
  const suggestedRetail = costsVerified ? Number((landedCost * effectiveMultiplier).toFixed(2)) : null;
  const estimatedPaymentFee = suggestedRetail === null ? null : Number((suggestedRetail * paymentFeeRate).toFixed(2));
  const estimatedProfit = suggestedRetail === null ? null : Number((suggestedRetail - landedCost - estimatedPaymentFee).toFixed(2));
  const margin = suggestedRetail > 0 ? estimatedProfit / suggestedRetail : null;

  const inventory = Math.max(0, n(candidate.inventory) ?? 0);
  const rating = Math.min(5, Math.max(0, n(candidate.rating) ?? 0));
  const reviewCount = Math.max(0, n(candidate.reviewCount) ?? 0);
  const deliveryDays = n(candidate.deliveryDays);

  const breakdown = {
    trend: candidate.trending ? 15 : candidate.newArrival ? 8 : 2,
    usAvailability: candidate.usInventory > 0 ? 15 : candidate.usShippingAvailable ? 8 : 0,
    inventory: inventory > 100 ? 15 : inventory > 20 ? 10 : inventory > 0 ? 4 : 0,
    reviews: reviewCount ? Math.min(20, Math.round(rating * 3 + Math.log10(reviewCount + 1) * 2)) : 0,
    delivery: deliveryDays == null ? 0 : deliveryDays <= 7 ? 15 : deliveryDays <= 14 ? 10 : deliveryDays <= 25 ? 5 : 0,
    margin: margin === null ? 0 : margin >= 0.5 ? 15 : margin >= 0.35 ? 10 : margin >= 0.2 ? 5 : margin > 0 ? 2 : 0,
  };

  return {
    score: Object.values(breakdown).reduce((total, points) => total + points, 0),
    breakdown,
    supplierPrice: productCost,
    shippingCost,
    landedCost: landedCost === null ? null : Number(landedCost.toFixed(2)),
    suggestedRetail,
    estimatedPaymentFee,
    estimatedProfit,
    estimatedMargin: margin === null ? null : Number(margin.toFixed(4)),
    costsVerified,
  };
}
