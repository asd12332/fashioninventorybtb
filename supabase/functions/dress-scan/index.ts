const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { image, mimeType } = await req.json()
    if (!image) return json({ error: 'Missing image' }, 400)

    const prompt =
      'This is a Bridetobe Fashion dress tag. Format is typically "NNN - Color" and "Size: NN" ' +
      '(e.g. "061 - Blue", "Size: 44"). Extract the dress ID (keep it as a 3-digit string, pad with zeros if shorter), ' +
      'the color name, and the size (number). Respond with ONLY valid JSON: ' +
      '{"dress_id":"061","color":"Blue","size":"44"}. If any field is unreadable, use empty string.'

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-opus-4-5',
        max_tokens: 300,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mimeType || 'image/jpeg', data: image } },
            { type: 'text', text: prompt },
          ],
        }],
      }),
    })

    const data = await resp.json()
    if (!resp.ok) return json({ error: data?.error?.message || 'Anthropic error', details: data }, 500)

    const text = data.content?.[0]?.text || '{}'
    const match = text.match(/\{[\s\S]*\}/)
    const parsed = match ? JSON.parse(match[0]) : { dress_id: '', color: '', size: '' }
    return json(parsed)
  } catch (e) {
    return json({ error: (e as Error).message }, 500)
  }
})

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
