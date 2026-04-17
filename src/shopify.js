const SYNC_URL = 'https://vcursretyrfmkgigmwss.supabase.co/functions/v1/shopify-sync'

async function syncOne(dressId, colorName, size, quantity) {
  const res = await fetch(SYNC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'sync_size', dress_id: dressId, color: colorName, size, quantity }),
  })
  return res.json()
}

/**
 * Sync all dresses to Shopify. Called by the manual Sync button.
 * Returns { success, failed } counts.
 */
export async function syncAllDresses(dresses) {
  let success = 0
  let failed = 0

  for (const dress of dresses) {
    for (const color of dress.dress_colors || []) {
      for (const sizeEntry of color.dress_sizes || []) {
        try {
          const result = await syncOne(dress.id, color.color_name, sizeEntry.size, sizeEntry.quantity)
          if (result.ok || result.action === 'skipped') {
            success++
          } else {
            console.warn('Sync failed:', dress.id, color.color_name, sizeEntry.size, result)
            failed++
          }
        } catch (e) {
          console.warn('Sync error:', e)
          failed++
        }
      }
    }
  }

  return { success, failed }
}
