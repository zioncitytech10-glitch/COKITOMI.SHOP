const n = (value) => {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export function scoreCandidate(
  candidate,
  { retailMultiplier = 2.5, targetMargin = null, paymentFeeRate = 0.03 } = {},
) {
  const productCost = n(candidate.supplierPrice) ?? 0;
  const shippingCost = n(candidate.shippingCost) ?? 0;
  const landedCost = productCost + shippingCost;

  // Price to the configured target margin after the estimated payment fee.
  // Fall back to the legacy multiplier when no target margin is supplied.
  const effectiveMultiplier = Number.isFinite(targetMargin)
    ? 1 / Math.max(0.01, 1 - targetMargin - paymentFeeRate)
    : retailMultiplier;
  const suggestedRetail = Number((landedCost * effectiveMultiplier).toFixed(2));
  const estimatedPaymentFee = Number((suggestedRetail * paymentFeeRate).toFixed(2));
  const estimatedProfit = Number((suggestedRetail - landedCost - estimatedPaymentFee).toFixed(2));
  const margin = suggestedRetail > 0 ? estimatedProfit / suggestedRetail : 0;

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
    margin: margin >= 0.5 ? 13 : margin >= 0.35 ? 10 : margin >= 0.2 ? 6 : margin > 0 ? 2 : 0,
  };

  return {
    score: Object.values(breakdown).reduce((total, points) => total + points, 0),
    breakdown,
    supplierPrice: productCost,
    shippingCost,
    landedCost: Number(landedCost.toFixed(2)),
    suggestedRetail,
    estimatedPaymentFee,
    estimatedProfit,
    estimatedMargin: Number(margin.toFixed(4)),
  };
}
