// Shared demonstration catalogue for every storefront page.
// Availability is intentionally unconfirmed until real supplier data is connected.
window.COKITOMI_COLLECTIONS = [
  {
    id: "best-sellers",
    name: "Best Sellers",
    description: "The little favourites that make thoughtful teddy bear gifts.",
    image: "https://images.unsplash.com/photo-1559454403-b8fb88521f11?auto=format&fit=crop&w=900&q=85"
  },
  {
    id: "rose-teddy-bears",
    name: "Rose Teddy Bears",
    description: "Romantic teddy gifts for a note, a date, or a just-because hug.",
    image: "https://images.unsplash.com/photo-1708360459857-9563d80d3acb?auto=format&fit=crop&w=900&q=85"
  },
  {
    id: "giant-teddy-bears",
    name: "Giant Teddy Bears",
    description: "Explore this collection as larger demo teddy listings are added.",
    image: "https://images.unsplash.com/photo-1562040506-a9b32cb51b94?auto=format&fit=crop&w=900&q=85"
  },
  {
    id: "birthday-gifts",
    name: "Birthday Gifts",
    description: "A soft surprise to make their birthday feel a little more special.",
    image: "https://images.unsplash.com/photo-1559454403-b8fb88521f11?auto=format&fit=crop&w=900&q=85"
  },
  {
    id: "anniversary-gifts",
    name: "Anniversary Gifts",
    description: "A little reminder of the love and memories you share.",
    image: "https://images.unsplash.com/photo-1562040506-a9b32cb51b94?auto=format&fit=crop&w=900&q=85"
  },
  {
    id: "luxury-teddy-bears",
    name: "Luxury Teddy Bears",
    description: "A collection for elevated teddy gifts. Demo listings are coming soon.",
    image: "https://images.unsplash.com/photo-1708360459857-9563d80d3acb?auto=format&fit=crop&w=900&q=85"
  },
  {
    id: "personalized-gifts",
    name: "Personalized Gifts",
    description: "Personalized options will appear here when confirmed products are available.",
    image: "https://images.unsplash.com/photo-1562040506-a9b32cb51b94?auto=format&fit=crop&w=900&q=85"
  }
];

window.COKITOMI_PRODUCTS = [
  {
    id: 1,
    slug: "amigo-classic-teddy",
    name: "Amigo Classic Teddy",
    price: 29.99,
    description: "A timeless friend for every occasion.",
    detailDescription: "A classic teddy bear gift for birthdays, milestones, and small just-because moments. This is a demonstration listing; product specifications and fulfilment details have not been confirmed.",
    image: "https://images.unsplash.com/photo-1559454403-b8fb88521f11?auto=format&fit=crop&w=1000&q=85",
    additionalImages: ["assets/products/amigo-classic-teddy-alt.png"],
    specifications: [
      { label: "Product type", value: "Teddy bear gift" },
      { label: "Material", value: "To be confirmed" },
      { label: "Size", value: "To be confirmed" },
      { label: "Availability", value: "Demo listing · unconfirmed" }
    ],
    collections: ["best-sellers", "birthday-gifts"],
    isBestseller: true,
    isNew: false,
    availabilityStatus: "demo",
    newestRank: 1
  },
  {
    id: 2,
    slug: "blush-heart-teddy",
    name: "Blush Heart Teddy",
    price: 34.99,
    description: "A sweet little way to say I love you.",
    detailDescription: "A warm-hearted teddy gift for sharing a little affection and making an ordinary day feel special. This is a demonstration listing; product specifications and fulfilment details have not been confirmed.",
    image: "https://images.unsplash.com/photo-1562040506-a9b32cb51b94?auto=format&fit=crop&w=1000&q=85",
    additionalImages: ["assets/products/blush-heart-teddy-alt.png"],
    specifications: [
      { label: "Product type", value: "Teddy bear gift" },
      { label: "Material", value: "To be confirmed" },
      { label: "Size", value: "To be confirmed" },
      { label: "Availability", value: "Demo listing · unconfirmed" }
    ],
    collections: ["anniversary-gifts"],
    isBestseller: false,
    isNew: false,
    cardLabel: "Gift favourite",
    availabilityStatus: "demo",
    newestRank: 2
  },
  {
    id: 3,
    slug: "cuddle-cloud-bear",
    name: "Cuddle Cloud Bear",
    price: 39.99,
    description: "Extra-soft comfort for cosy moments.",
    detailDescription: "A cosy companion for quiet moments and thoughtful gifting. This is a demonstration listing; product specifications and fulfilment details have not been confirmed.",
    image: "https://images.unsplash.com/photo-1577568315884-9372fbdd39f4?auto=format&fit=crop&w=1000&q=85",
    additionalImages: ["assets/products/cuddle-cloud-bear-alt.png"],
    specifications: [
      { label: "Product type", value: "Teddy bear gift" },
      { label: "Material", value: "To be confirmed" },
      { label: "Size", value: "To be confirmed" },
      { label: "Availability", value: "Demo listing · unconfirmed" }
    ],
    collections: [],
    isBestseller: false,
    isNew: true,
    availabilityStatus: "demo",
    newestRank: 4
  },
  {
    id: 4,
    slug: "rose-hug-teddy",
    name: "Rose Hug Teddy",
    price: 44.99,
    description: "A thoughtful gift made to be remembered.",
    detailDescription: "A thoughtful teddy gift for anniversaries, birthdays, or a just-because surprise. This is a demonstration listing; product specifications and fulfilment details have not been confirmed.",
    image: "https://images.unsplash.com/photo-1708360459857-9563d80d3acb?auto=format&fit=crop&w=1000&q=85",
    additionalImages: ["assets/products/rose-hug-teddy-alt.png"],
    specifications: [
      { label: "Product type", value: "Teddy bear gift" },
      { label: "Material", value: "To be confirmed" },
      { label: "Size", value: "To be confirmed" },
      { label: "Availability", value: "Demo listing · unconfirmed" }
    ],
    collections: ["rose-teddy-bears", "anniversary-gifts"],
    isBestseller: false,
    isNew: false,
    cardLabel: "Lovely gift",
    availabilityStatus: "demo",
    newestRank: 3
  }
];
