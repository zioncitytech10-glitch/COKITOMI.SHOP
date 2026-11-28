import test from "node:test";
import assert from "node:assert/strict";
import { scoreCandidate } from "../src/scoring.js";

test("profit and retail price are not calculated when supplier price is missing", () => {
  const result = scoreCandidate({ supplierPrice: null, shippingCost: 5, inventory: 10 });
  assert.equal(result.costsVerified, false);
  assert.equal(result.suggestedRetail, null);
  assert.equal(result.estimatedProfit, null);
  assert.equal(result.estimatedMargin, null);
  assert.equal(result.landedCost, null);
});

test("profit and retail price are not calculated when shipping is missing", () => {
  const result = scoreCandidate({ supplierPrice: 9.38, shippingCost: null, inventory: 10 });
  assert.equal(result.costsVerified, false);
  assert.equal(result.suggestedRetail, null);
  assert.equal(result.estimatedProfit, null);
  assert.equal(result.estimatedMargin, null);
});

test("50 percent target margin is calculated after the payment fee when both costs are verified", () => {
  const result = scoreCandidate(
    { supplierPrice: 10, shippingCost: 5, inventory: 100, usInventory: 0, usShippingAvailable: true },
    { targetMargin: 0.5, paymentFeeRate: 0.03 },
  );
  assert.equal(result.costsVerified, true);
  assert.equal(result.landedCost, 15);
  assert.equal(result.suggestedRetail, 31.91);
  assert.equal(result.estimatedMargin, 0.4998);
  assert.equal(result.estimatedProfit, 15.95);
});
