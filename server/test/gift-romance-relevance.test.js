import test from "node:test";
import assert from "node:assert/strict";
import { isTeddyBearCandidate, isRoseBouquetCandidate, isRomanticGiftCandidate } from "../src/discovery.js";

test("teddy bear category accepts teddy bear toys and rejects unrelated products", () => {
  assert.equal(isTeddyBearCandidate("Giant Teddy Bear Plush Toy"), true);
  assert.equal(isTeddyBearCandidate("Rose Teddy Bear Gift"), true);
  assert.equal(isTeddyBearCandidate("Women's Plush Hooded Jacket"), false);
  assert.equal(isTeddyBearCandidate("Bear Print Blanket"), false);
});

test("rose bouquet category accepts floral gifts and rejects unrelated products", () => {
  assert.equal(isRoseBouquetCandidate("Artificial Red Rose Bouquet"), true);
  assert.equal(isRoseBouquetCandidate("Preserved Pink Roses Gift Box"), true);
  assert.equal(isRoseBouquetCandidate("Rose Print Dress"), false);
  assert.equal(isRoseBouquetCandidate("Rose Phone Case"), false);
});

test("romantic gift category accepts selected gift types only", () => {
  assert.equal(isRomanticGiftCandidate("Teddy Bear and Rose Gift Set"), true);
  assert.equal(isRomanticGiftCandidate("Matching Couple Bracelet Set"), true);
  assert.equal(isRomanticGiftCandidate("Personalized Romantic Gift Box"), true);
  assert.equal(isRomanticGiftCandidate("Women's Winter Jacket"), false);
});
