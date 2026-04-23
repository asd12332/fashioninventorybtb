const SYNC_URL = 'https://vcursretyrfmkgigmwss.supabase.co/functions/v1/shopify-sync'
const ANON_KEY = 'sb_publishable_HSLXAaTslgID8pEdYcbgnQ_pClqgs3j'

async function syncOne(dressId, colorName, size, quantity) {
  const res = await fetch(SYNC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${ANON_KEY}`,
      'apikey': ANON_KEY,
    },
    body: JSON.stringify({ action: 'sync_size', dress_id: dressId, color: colorName, size, quantity }),
  })
  return res.json()
}

/**
 * Sync only the changed sizes to Shopify.
 * changes: Array of { dress_id, color, size, quantity }
 * Returns { succeeded: [...], failed: [...] } — per-item outcome so caller
 * can drop only the succeeded items from its queue and retry the failed ones.
 */
export async function syncPendingChanges(changes) {
  const succeeded = []
  const failed = []

  for (const change of changes) {
    const { dress_id, color, size, quantity } = change
    try {
      const result = await syncOne(dress_id, color, size, quantity)
      if (result.ok || result.action === 'skipped') {
        succeeded.push(change)
      } else {
        console.warn('Sync failed:', dress_id, color, size, result)
        failed.push({ ...change, reason: result.error || JSON.stringify(result) })
      }
    } catch (e) {
      console.warn('Sync error:', e)
      failed.push({ ...change, reason: e.message || String(e) })
    }
  }

  return { succeeded, failed }
}

/**
 * Sync all dresses to Shopify. Full sync fallback.
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

/**
 * Sync the full current variant state for a specific list of dresses.
 * Pushes every color × size with current quantity — not just pending changes.
 */
export async function syncDressesFullState(dresses) {
  const succeeded = []
  const failed = []

  for (const dress of dresses) {
    for (const color of dress.dress_colors || []) {
      for (const sizeEntry of color.dress_sizes || []) {
        const entry = { dress_id: dress.id, color: color.color_name, size: sizeEntry.size, quantity: sizeEntry.quantity }
        try {
          const result = await syncOne(dress.id, color.color_name, sizeEntry.size, sizeEntry.quantity)
          if (result.ok || result.action === 'skipped') {
            succeeded.push(entry)
          } else {
            console.warn('Sync failed:', dress.id, color.color_name, sizeEntry.size, result)
            failed.push({ ...entry, reason: result.error || JSON.stringify(result) })
          }
        } catch (e) {
          console.warn('Sync error:', e)
          failed.push({ ...entry, reason: e.message || String(e) })
        }
      }
    }
  }

  return { succeeded, failed }
}
