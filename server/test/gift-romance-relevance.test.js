import test from "node:test";
import assert from "node:assert/strict";
import { findTeddyBearCategories, isTeddyBearCandidate, isRoseBouquetCandidate, isRomanticGiftCandidate } from "../src/discovery.js";

test("teddy bear category accepts teddy bear toys and rejects unrelated products", () => {
  assert.equal(isTeddyBearCandidate("Giant Teddy Bear Plush Toy"), true);
  assert.equal(isTeddyBearCandidate("Cute Plush Bear Doll"), true);
  assert.equal(isTeddyBearCandidate("Stuffed Animal Bear"), true);
  assert.equal(isTeddyBearCandidate("Soft Toy", "Plush Bears"), false);
  assert.equal(isTeddyBearCandidate("Cute Bear", "Stuffed Animals"), true);
  assert.equal(isTeddyBearCandidate("CJ teddy bear coffee cup"), false);
  assert.equal(isTeddyBearCandidate("CJ teddy bear", "", "Heat-resistant glass coffee cup"), false);
  assert.equal(isTeddyBearCandidate("Rose Teddy Bear Gift"), true);
  assert.equal(isTeddyBearCandidate("Women's Plush Hooded Jacket"), false);
  assert.equal(isTeddyBearCandidate("Bear Print Blanket"), false);
  assert.equal(isTeddyBearCandidate("Teddy Bear Keychain"), false);
  assert.equal(isTeddyBearCandidate("Teddy Bear Mug"), false);
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

test("CJ category discovery selects plush and stuffed-toy categories but excludes pet categories", () => {
  const response = {
    data: [
      {
        categoryFirstName: "Toys, Kids & Baby",
        categoryFirstList: [
          {
            categorySecondName: "Dolls & Stuffed Toys",
            categorySecondList: [
              { categoryId: "plush-1", categoryName: "Plush & Stuffed Animals" },
              { categoryId: "dolls-2", categoryName: "Dolls" },
            ],
          },
        ],
      },
      {
        categoryFirstName: "Pet Supplies",
        categoryFirstList: [
          {
            categorySecondName: "Pet Toys",
            categorySecondList: [
              { categoryId: "pet-1", categoryName: "Plush Pet Toys" },
            ],
          },
        ],
      },
      {
        categoryFirstName: "Home & Garden",
        categoryFirstList: [
          {
            categorySecondName: "Furniture",
            categorySecondList: [
              { categoryId: "home-1", categoryName: "Plush Cushions" },
            ],
          },
        ],
      },
    ],
  };

  const matches = findTeddyBearCategories(response);
  assert.deepEqual(matches.map((item) => item.id), ["plush-1", "dolls-2"]);
  assert.match(matches[0].path, /Toys, Kids & Baby > Dolls & Stuffed Toys > Plush & Stuffed Animals/);
});
