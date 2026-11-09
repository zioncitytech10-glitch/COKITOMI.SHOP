-- COKITOMI.SHOP product seed
-- Safe to run more than once: rows are matched by the unique product slug.
-- The initial products schema has one description column; this adds a separate
-- field so the storefront's short and detail descriptions are both preserved.

begin;

alter table public.products
  add column if not exists detail_description text;

insert into public.products (
  slug,
  name,
  description,
  detail_description,
  price,
  currency,
  image_url,
  gallery_urls,
  is_active
)
values
  (
    'amigo-classic-teddy',
    'Amigo Classic Teddy',
    'A timeless friend for every occasion.',
    'A classic teddy bear gift for birthdays, milestones, and small just-because moments. This is a demonstration listing; product specifications and fulfilment details have not been confirmed.',
    29.99,
    'USD',
    'https://images.unsplash.com/photo-1559454403-b8fb88521f11?auto=format&fit=crop&w=1000&q=85',
    ARRAY['assets/products/amigo-classic-teddy-alt.png']::text[],
    true
  ),
  (
    'blush-heart-teddy',
    'Blush Heart Teddy',
    'A sweet little way to say I love you.',
    'A warm-hearted teddy gift for sharing a little affection and making an ordinary day feel special. This is a demonstration listing; product specifications and fulfilment details have not been confirmed.',
    34.99,
    'USD',
    'https://images.unsplash.com/photo-1562040506-a9b32cb51b94?auto=format&fit=crop&w=1000&q=85',
    ARRAY['assets/products/blush-heart-teddy-alt.png']::text[],
    true
  ),
  (
    'cuddle-cloud-bear',
    'Cuddle Cloud Bear',
    'Extra-soft comfort for cosy moments.',
    'A cosy companion for quiet moments and thoughtful gifting. This is a demonstration listing; product specifications and fulfilment details have not been confirmed.',
    39.99,
    'USD',
    'https://images.unsplash.com/photo-1577568315884-9372fbdd39f4?auto=format&fit=crop&w=1000&q=85',
    ARRAY['assets/products/cuddle-cloud-bear-alt.png']::text[],
    true
  ),
  (
    'rose-hug-teddy',
    'Rose Hug Teddy',
    'A thoughtful gift made to be remembered.',
    'A thoughtful teddy gift for anniversaries, birthdays, or a just-because surprise. This is a demonstration listing; product specifications and fulfilment details have not been confirmed.',
    44.99,
    'USD',
    'https://images.unsplash.com/photo-1708360459857-9563d80d3acb?auto=format&fit=crop&w=1000&q=85',
    ARRAY['assets/products/rose-hug-teddy-alt.png']::text[],
    true
  )
on conflict (slug) do update set
  name = excluded.name,
  description = excluded.description,
  detail_description = excluded.detail_description,
  price = excluded.price,
  currency = excluded.currency,
  image_url = excluded.image_url,
  gallery_urls = excluded.gallery_urls,
  is_active = true,
  updated_at = now();

commit;