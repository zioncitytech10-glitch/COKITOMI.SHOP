/* Shared Supabase client for the static COKITOMI storefront. */
(function () {
  const url = window.COKITOMI_SUPABASE_URL;
  const key = window.COKITOMI_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key || url.includes("YOUR_SUPABASE") || key.includes("YOUR_SUPABASE")) {
    console.info("COKITOMI: Supabase credentials have not been configured yet.");
    return;
  }

  if (!window.supabase || typeof window.supabase.createClient !== "function") {
    console.error("COKITOMI: Supabase library did not load.");
    return;
  }

  window.cokitomiSupabase = window.supabase.createClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  });

  console.info("COKITOMI: Supabase client initialized.");

  window.COKITOMI_SUPABASE_PRODUCTS_PROMISE = window.cokitomiSupabase
    .from("products")
    .select("id, slug, name, description, detail_description, price, currency, image_url, gallery_urls, is_active")
    .eq("is_active", true)
    .order("id", { ascending: true })
    .limit(200)
    .then(({ data, error }) => {
      if (error) {
        console.warn("COKITOMI: Supabase catalogue unavailable; using local products.");
        return null;
      }
      return Array.isArray(data) ? data : [];
    })
    .catch(() => {
      console.warn("COKITOMI: Supabase catalogue unavailable; using local products.");
      return null;
    });
})();
