import { ensureAuthenticated } from './auth.js'
import { initApp } from './ui.js'

document.addEventListener('DOMContentLoaded', async () => {
  await ensureAuthenticated()
  initApp()
})
