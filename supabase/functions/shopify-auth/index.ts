import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SHOPIFY_CLIENT_ID = Deno.env.get('SHOPIFY_CLIENT_ID')!
const SHOPIFY_CLIENT_SECRET = Deno.env.get('SHOPIFY_CLIENT_SECRET')!
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SB_SERVICE_KEY')!

Deno.serve(async (req: Request) => {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const shop = url.searchParams.get('shop')

  if (!code || !shop) {
    return new Response('Missing code or shop', { status: 400 })
  }

  // Exchange code for access token
  const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: SHOPIFY_CLIENT_ID,
      client_secret: SHOPIFY_CLIENT_SECRET,
      code,
    }),
  })

  if (!tokenRes.ok) {
    const err = await tokenRes.text()
    return new Response(`Token exchange failed: ${err}`, { status: 500 })
  }

  const { access_token } = await tokenRes.json()

  // Save token + shop to Supabase
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  await supabase.from('shopify_config').upsert({
    id: 1,
    shop,
    access_token,
    updated_at: new Date().toISOString(),
  })

  return new Response(
    `<html><body style="font-family:sans-serif;text-align:center;padding:60px">
      <h1>✅ Connected!</h1>
      <p>Your Shopify store <strong>${shop}</strong> is now linked to your inventory app.</p>
      <p>You can close this tab.</p>
    </body></html>`,
    { headers: { 'Content-Type': 'text/html' } }
  )
})
