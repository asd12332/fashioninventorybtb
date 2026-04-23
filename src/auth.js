const VERIFY_URL = 'https://vcursretyrfmkgigmwss.supabase.co/functions/v1/verify-password'
const ANON_KEY = 'sb_publishable_HSLXAaTslgID8pEdYcbgnQ_pClqgs3j'
const SESSION_KEY = 'btb_auth'

export function ensureAuthenticated() {
  return new Promise((resolve) => {
    if (sessionStorage.getItem(SESSION_KEY) === '1') {
      resolve()
      return
    }
    showLockScreen(resolve)
  })
}

function showLockScreen(onSuccess) {
  const app = document.getElementById('app')
  app.innerHTML = `
    <div class="lock-screen">
      <div class="lock-card">
        <div class="lock-logo">👗</div>
        <h1 class="lock-title">BrideToBe</h1>
        <p class="lock-subtitle">Fashion Inventory</p>
        <div class="lock-form">
          <input
            type="password"
            id="lockInput"
            class="lock-input"
            placeholder="Enter password"
            autocomplete="current-password"
            enterkeyhint="done"
          />
          <p class="lock-error" id="lockError"></p>
          <button class="lock-btn" id="lockBtn">Unlock</button>
        </div>
      </div>
    </div>
  `

  let attempts = 0
  let lockedUntil = 0

  const input = document.getElementById('lockInput')
  const btn = document.getElementById('lockBtn')
  const errorEl = document.getElementById('lockError')

  async function attempt() {
    const now = Date.now()
    if (now < lockedUntil) {
      const secs = Math.ceil((lockedUntil - now) / 1000)
      errorEl.textContent = `Too many attempts. Wait ${secs}s.`
      return
    }
    const password = input.value
    if (!password) return
    btn.disabled = true
    btn.textContent = '...'
    errorEl.textContent = ''
    try {
      const res = await fetch(VERIFY_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${ANON_KEY}`,
          'apikey': ANON_KEY,
        },
        body: JSON.stringify({ password }),
      })
      const data = await res.json()
      if (data.ok) {
        sessionStorage.setItem(SESSION_KEY, '1')
        onSuccess()
      } else {
        attempts++
        input.value = ''
        input.classList.add('shake')
        setTimeout(() => input.classList.remove('shake'), 500)
        if (attempts >= 3) {
          lockedUntil = Date.now() + 10_000
          attempts = 0
          errorEl.textContent = 'Too many attempts. Wait 10s.'
        } else {
          errorEl.textContent = 'Incorrect password'
        }
        btn.disabled = false
        btn.textContent = 'Unlock'
      }
    } catch {
      errorEl.textContent = 'Connection error. Try again.'
      btn.disabled = false
      btn.textContent = 'Unlock'
    }
  }

  btn.addEventListener('click', attempt)
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') attempt() })
  setTimeout(() => input.focus(), 100)
}
