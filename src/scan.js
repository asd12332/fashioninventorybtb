const SCAN_URL = 'https://vcursretyrfmkgigmwss.supabase.co/functions/v1/dress-scan'
const ANON_KEY = 'sb_publishable_HSLXAaTslgID8pEdYcbgnQ_pClqgs3j'

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      const base64 = result.split(',')[1]
      resolve({ base64, mimeType: file.type || 'image/jpeg' })
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export async function scanDressCard(imageFile) {
  const { base64, mimeType } = await fileToBase64(imageFile)
  const res = await fetch(SCAN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${ANON_KEY}`,
      'apikey': ANON_KEY,
    },
    body: JSON.stringify({ image: base64, mimeType }),
  })
  const data = await res.json()
  if (data.error) throw new Error(data.error)
  return data // { dress_id, color, size }
}
