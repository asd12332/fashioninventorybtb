// Wasl Apps Script proxy URL — PASTE YOUR DEPLOYED /exec URL HERE
export const WASL_URL = 'PASTE_YOUR_WASL_APPS_SCRIPT_EXEC_URL_HERE'

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
  if (!WASL_URL || WASL_URL.includes('PASTE_YOUR')) {
    throw new Error('Wasl Apps Script URL not configured in src/scan.js')
  }
  const { base64, mimeType } = await fileToBase64(imageFile)
  const res = await fetch(WASL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'scan_dress_card', image: base64, mimeType }),
  })
  const data = await res.json()
  if (data.error) throw new Error(data.error)
  return data // { dress_id, colors: [...], sizes: [...] }
}
