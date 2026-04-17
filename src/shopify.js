const SYNC_URL = 'https://vcursretyrfmkgigmwss.supabase.co/functions/v1/shopify-sync'

/**
 * Sync a single size/quantity change to Shopify.
 * - quantity > 0 → update inventory level
 * - quantity === 0 → delete the variant
 * Non-blocking: errors are logged but don't break the app.
 */
export async function syncSizeToShopify(dressId, colorName, size, quantity) {
  try {
    const res = await fetch(SYNC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'sync_size',
        dress_id: dressId,
        color: colorName,
        size,
        quantity,
      }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      console.warn('Shopify sync warning:', err)
    }
  } catch (e) {
    console.warn('Shopify sync failed (non-blocking):', e)
  }
}

/**
 * Sync all sizes for a color after a bulk update.
 */
export async function syncAllSizesToShopify(dressId, colorName, sizesMap) {
  const promises = Object.entries(sizesMap).map(([size, qty]) =>
    syncSizeToShopify(dressId, colorName, parseInt(size), parseInt(qty))
  )
  await Promise.all(promises)
}
