import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

  // Get stored Shopify credentials
  const { data: config } = await supabase
    .from('shopify_config')
    .select('shop, access_token, location_id')
    .eq('id', 1)
    .single()

  if (!config?.access_token) {
    return json({ error: 'Shopify not connected' }, 400)
  }

  const { shop, access_token } = config
  const shopifyHeaders = {
    'X-Shopify-Access-Token': access_token,
    'Content-Type': 'application/json',
  }

  const body = await req.json()
  const { action, dress_id, color, size, quantity } = body

  // ── Fetch location ID (cached in shopify_config) ──────────
  let location_id = config.location_id
  if (!location_id) {
    const locRes = await fetch(`https://${shop}/admin/api/2026-04/locations.json`, { headers: shopifyHeaders })
    const locData = await locRes.json()
    location_id = locData.locations?.[0]?.id
    if (location_id) {
      await supabase.from('shopify_config').update({ location_id }).eq('id', 1)
    }
  }

  if (action === 'sync_size') {
    // Find or fetch the Shopify variant for this dress/color/size
    const cacheKey = { dress_id, color, size: String(size) }

    const { data: cached } = await supabase
      .from('shopify_products')
      .select('shopify_product_id, shopify_variant_id, inventory_item_id')
      .eq('dress_id', dress_id)
      .eq('color', color)
      .eq('size', String(size))
      .maybeSingle()

    let product_id = cached?.shopify_product_id
    let variant_id = cached?.shopify_variant_id
    let inventory_item_id = cached?.inventory_item_id

    // If not cached, look up product in Shopify by title "Dress {dress_id}"
    let product: any = null
    if (!product_id) {
      const title = encodeURIComponent(`Dress ${dress_id}`)
      const pRes = await fetch(
        `https://${shop}/admin/api/2026-04/products.json?title=${title}&fields=id,title,variants,options,images`,
        { headers: shopifyHeaders }
      )
      const pData = await pRes.json()
      product = pData.products?.find(
        (p: any) => p.title.toLowerCase() === `dress ${dress_id}`.toLowerCase()
      )

      if (!product) {
        return json({ error: `Product "Dress ${dress_id}" not found in Shopify` }, 404)
      }

      product_id = product.id

      // Find variant matching color + size
      const variant = product.variants?.find((v: any) => {
        const opts = [v.option1, v.option2, v.option3].map((o: string) => o?.toLowerCase())
        return opts.includes(color.toLowerCase()) && opts.includes(String(size))
      })

      if (variant) {
        variant_id = variant.id
        inventory_item_id = variant.inventory_item_id

        // Cache for future calls
        await supabase.from('shopify_products').upsert({
          dress_id,
          color,
          size: String(size),
          shopify_product_id: String(product_id),
          shopify_variant_id: String(variant_id),
          inventory_item_id: String(inventory_item_id),
          location_id: String(location_id),
        })
      }
    }

    // If quantity is 0 and no variant exists → nothing to do
    if (quantity === 0 && !variant_id) {
      return json({ ok: true, action: 'skipped', reason: 'variant does not exist' })
    }

    // If quantity is 0 and variant exists → delete it
    if (quantity === 0 && variant_id) {
      const delRes = await fetch(
        `https://${shop}/admin/api/2026-04/products/${product_id}/variants/${variant_id}.json`,
        { method: 'DELETE', headers: shopifyHeaders }
      )
      await supabase.from('shopify_products')
        .delete()
        .eq('dress_id', dress_id)
        .eq('color', color)
        .eq('size', String(size))

      return json({ ok: true, action: 'deleted_variant', status: delRes.status })
    }

    // If variant doesn't exist yet and quantity > 0 → create it
    if (!variant_id) {
      // Fetch full product (variants + options + images) if not already loaded
      if (!product) {
        const pRes = await fetch(
          `https://${shop}/admin/api/2026-04/products/${product_id}.json?fields=id,variants,options,images`,
          { headers: shopifyHeaders }
        )
        const pData = await pRes.json()
        product = pData.product
      }

      const options = product?.options || []
      const colorOptionPos = options.find((o: any) =>
        ['color', 'colour', 'لون'].includes(o.name.toLowerCase())
      )?.position ?? 1
      const sizeOptionPos = options.find((o: any) =>
        ['size', 'مقاس', 'مقاسات'].includes(o.name.toLowerCase())
      )?.position ?? 2

      // Get price and image from existing same-color variants
      const sameColorVariant = product?.variants?.find((v: any) => {
        const opts = [v.option1, v.option2, v.option3]
        return opts.some((o: string) => o?.toLowerCase() === color.toLowerCase())
      })
      const price = sameColorVariant?.price ?? '0'

      // Find the image currently linked to same-color variants
      const sameColorVariantIds: number[] = (product?.variants || [])
        .filter((v: any) => [v.option1, v.option2, v.option3]
          .some((o: string) => o?.toLowerCase() === color.toLowerCase()))
        .map((v: any) => v.id)
      const colorImage = product?.images?.find((img: any) =>
        img.variant_ids?.some((id: number) => sameColorVariantIds.includes(id))
      )

      const variantBody: any = {
        option1: null, option2: null, option3: null,
        inventory_management: 'shopify',
        inventory_policy: 'deny',
        price: String(price),
      }
      variantBody[`option${colorOptionPos}`] = color
      variantBody[`option${sizeOptionPos}`] = String(size)

      const createRes = await fetch(
        `https://${shop}/admin/api/2026-04/products/${product_id}/variants.json`,
        {
          method: 'POST',
          headers: shopifyHeaders,
          body: JSON.stringify({ variant: variantBody }),
        }
      )
      const createData = await createRes.json()
      const newVariant = createData.variant

      if (!newVariant) {
        return json({ error: 'Failed to create variant', details: createData }, 500)
      }

      variant_id = newVariant.id
      inventory_item_id = newVariant.inventory_item_id

      // Cache the new variant
      await supabase.from('shopify_products').upsert({
        dress_id,
        color,
        size: String(size),
        shopify_product_id: String(product_id),
        shopify_variant_id: String(variant_id),
        inventory_item_id: String(inventory_item_id),
        location_id: String(location_id),
      })

      // Link new variant to color image
      if (colorImage) {
        // Existing image in Shopify — just add the new variant ID to it
        const updatedVariantIds = [...(colorImage.variant_ids || []), Number(variant_id)]
        await fetch(
          `https://${shop}/admin/api/2026-04/products/${product_id}/images/${colorImage.id}.json`,
          {
            method: 'PUT',
            headers: shopifyHeaders,
            body: JSON.stringify({ image: { id: colorImage.id, variant_ids: updatedVariantIds } }),
          }
        )
      } else {
        // No existing Shopify image for this color (e.g. all variants were previously deleted).
        // Fall back to the image stored in our dress_colors table.
        const { data: colorRow } = await supabase
          .from('dress_colors')
          .select('image_url')
          .eq('dress_id', dress_id)
          .ilike('color_name', color)
          .maybeSingle()

        if (colorRow?.image_url) {
          await fetch(
            `https://${shop}/admin/api/2026-04/products/${product_id}/images.json`,
            {
              method: 'POST',
              headers: shopifyHeaders,
              body: JSON.stringify({
                image: { src: colorRow.image_url, variant_ids: [Number(variant_id)] },
              }),
            }
          )
        }
      }

      // Connect inventory item to location first (required for new variants)
      const connectRes = await fetch(`https://${shop}/admin/api/2026-04/inventory_levels/connect.json`, {
        method: 'POST',
        headers: shopifyHeaders,
        body: JSON.stringify({
          location_id: Number(location_id),
          inventory_item_id: Number(inventory_item_id),
          relocate_if_necessary: true,
        }),
      })
      const connectData = await connectRes.json()

      // Set the inventory quantity
      const setRes = await fetch(`https://${shop}/admin/api/2026-04/inventory_levels/set.json`, {
        method: 'POST',
        headers: shopifyHeaders,
        body: JSON.stringify({
          location_id: Number(location_id),
          inventory_item_id: Number(inventory_item_id),
          available: quantity,
        }),
      })
      const setData = await setRes.json()

      return json({
        ok: true,
        action: 'created_variant',
        variant_id,
        connect: { ok: connectRes.ok, data: connectData },
        inventory: { ok: setRes.ok, data: setData },
      })
    }

    // Variant exists and quantity > 0 → update inventory level
    const invRes = await fetch(
      `https://${shop}/admin/api/2026-04/inventory_levels/set.json`,
      {
        method: 'POST',
        headers: shopifyHeaders,
        body: JSON.stringify({
          location_id: Number(location_id),
          inventory_item_id: Number(inventory_item_id),
          available: quantity,
        }),
      }
    )
    const invData = await invRes.json()
    return json({ ok: invRes.ok, action: 'updated_inventory', data: invData })
  }

  return json({ error: 'Unknown action' }, 400)
})

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
