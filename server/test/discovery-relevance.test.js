import test from "node:test";
import assert from "node:assert/strict";
import { isTeddyBearCandidate } from "../src/discovery.js";

test("accepts genuine teddy bear and stuffed bear toy titles", () => {
  for (const title of [
    "Classic Teddy Bear Plush Toy",
    "Giant Teddy Bear Soft Stuffed Animal",
    "Rose Teddy Bear Gift",
    "Plush Bear Toy",
  ]) {
    assert.equal(isTeddyBearCandidate(title), true, title);
  }
});

test("rejects clothing and non-toy products containing plush or bear", () => {
  for (const title of [
    "Women's Plush Hooded Parkas Winter Warm Thick Zip-up Jacket",
    "Plush Coat Outerwear Clothing",
    "Bear Print Blanket",
    "Teddy Bear Graphic Shirt",
    "Plush Cushion Pillow",
    "Bear Keychain",
  ]) {
    assert.equal(isTeddyBearCandidate(title), false, title);
  }
});

test("requires bear or teddy identity even when category says toys", () => {
  assert.equal(isTeddyBearCandidate("Cute Soft Plush Toy", "toys"), false);
  assert.equal(isTeddyBearCandidate("Stuffed Rabbit Toy", "stuffed animal"), false);
});
