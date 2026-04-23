# Luxury UI Redesign — Black & Gold Mobile App

**Date:** 2026-04-23  
**Approach:** A — Full style.css rewrite + shell restructure  

---

## 1. Authentication

### Edge Function: `verify-password`
- New Supabase edge function deployed with `--no-verify-jwt`
- Accepts `POST { password: string }`
- Compares against `APP_PASSWORD` env secret (value: `aya123` — set in Supabase dashboard, never in source code)
- Returns `{ ok: true }` on match, HTTP 401 `{ error: "Incorrect password" }` on mismatch
- CORS headers for the GitHub Pages origin

### Frontend: `src/auth.js`
- Exports `ensureAuthenticated()` — called in `main.js` before `initApp()`
- Checks `sessionStorage.getItem('btb_auth')` — if `"1"`, resolves immediately
- Otherwise renders full-screen lock screen, waits for correct password
- On success: sets `sessionStorage.btb_auth = "1"`, removes lock screen, calls `initApp()`
- On failure: red shake animation on the input, "Incorrect password" message, clears input
- Rate limiting: 3 failed attempts → 10s lockout (client-side only, UX hardening)

### Lock Screen UI
- Full viewport, black background (`#0a0a0a`)
- Centered card: gold dress icon, "BrideToBe" title in gold, subtitle "Fashion Inventory"
- Single password input (type="password"), gold-bordered on focus
- "Unlock" button — gold gradient, full width
- No hint of what the password is anywhere in the DOM or network payloads

---

## 2. Desktop Blocker

- Runs before auth check in `main.js`
- Condition: `window.innerWidth > 820 || !('ontouchstart' in window)`
- Renders full-screen block page: black bg, gold icon, "This app is designed for mobile only"
- Shows QR code (via qrcode.js CDN or inline SVG generation) linking to the app URL
- `initApp()` and `ensureAuthenticated()` never called on desktop

---

## 3. Layout — Bottom Tab Bar

### Tabs (4):
| Tab | Icon | Content |
|-----|------|---------|
| Inventory | grid-3x3 | Main dress grid (current default view) |
| Scan | camera | Triggers hidden file input (`capture="environment"`) |
| Sync | refresh-cw | Shopify sync — shows pending badge count |
| More | sliders-horizontal | Select mode toggle, Reset selected, Delete selected, Add Dress |

### Safe Area
- `padding-top: env(safe-area-inset-top)` on the app root (Dynamic Island)
- `padding-bottom: calc(64px + env(safe-area-inset-bottom))` on scrollable content (tab bar height + home indicator)
- Tab bar: `position: fixed; bottom: 0; padding-bottom: env(safe-area-inset-bottom)`

### Top Strip (replaces header)
- Sticky, full-width
- Row 1: "BrideToBe" logo left, search input right (expands on focus)
- Row 2: Color filter dropdown · Price input · Sort dropdown (horizontally scrollable pill row)
- No "Per Row" selector — fixed 2-column grid on mobile

### FAB — Add Dress
- Gold circle button, bottom-right, `position: fixed`
- `bottom: calc(72px + env(safe-area-inset-bottom))` — sits above tab bar
- `+` icon, 56×56px, gold gradient, subtle shadow

---

## 4. Visual Theme

### Color Tokens
```css
--bg:          #0a0a0a
--surface:     #141414
--surface-2:   #1e1e1e
--border:      #2a2a2a
--gold:        #c8a96a
--gold-light:  #e8c98a
--gold-dark:   #a8894a
--text-1:      #f5f5f5
--text-2:      #aaaaaa
--text-3:      #666666
--danger:      #e05555
--success:     #4caf7d
```

### Typography
- Font stack: `-apple-system, "SF Pro Display", "Helvetica Neue", sans-serif`
- Logo: 18px bold, gold
- Card title: 16px semibold, white
- Labels: 11px uppercase tracking-widest, `--text-3`

### Dress Cards
- 2-column grid (fixed, no selector)
- Image ratio: 4:5 (portrait)
- Card bg: `--surface`, border: `--border`, border-radius: 12px
- Dress ID badge: gold pill overlay on image (top-left)
- Sold Out: red diagonal banner overlay
- Color dots row below image
- Size chips: small gold-outline pills for available sizes
- Price: gold text, bottom-right of card
- Selected state: gold glow border + `box-shadow: 0 0 0 2px var(--gold)`

### Modals → Bottom Sheets
- Replace centered `.modal-overlay` with slide-up sheets
- Backdrop: `rgba(0,0,0,0.7)` blur
- Sheet: `border-radius: 20px 20px 0 0`, bg `--surface`, max-height 90vh, scrollable
- Drag handle pill at top (purely decorative)
- Enter animation: `translateY(100%) → translateY(0)`, 300ms ease-out

### Toasts
- Dark glass pill, centered top (below Dynamic Island)
- `backdrop-filter: blur(12px)`, `background: rgba(20,20,20,0.9)`
- Success: gold icon; Error: red icon

### Stats Bar
- Horizontal scroll row of 3 stat chips
- Each: `--surface-2` bg, gold number, gray label

### Skeleton Loaders
- Dark shimmer (`--surface-2` → `--surface` gradient animation)

### Buttons
- Primary: gold gradient (`--gold-dark` → `--gold-light`), black text, 44px min height
- Ghost: transparent, gold border, gold text
- Danger: `--danger` bg
- Tab bar icons: `--text-3` inactive, `--gold` active

---

## 5. Files Changed

| File | Change |
|------|--------|
| `src/main.js` | Add desktop blocker + `ensureAuthenticated()` before `initApp()` |
| `src/auth.js` | New — lock screen + session check |
| `src/ui.js` | Replace `renderShell()` with bottom-tab layout; update card HTML; update modal HTML to bottom sheets; remove gridCols state |
| `style.css` | Full rewrite with new tokens and component styles |
| `supabase/functions/verify-password/index.ts` | New edge function |

**Unchanged:** `src/inventory.js`, `src/shopify.js`, `src/scan.js`, `src/supabase.js`, `src/colors.js`, `src/imageCompressor.js`

---

## 6. Deployment Steps (user action required)

1. In Supabase dashboard → Edge Functions → `verify-password` → Secrets → add `APP_PASSWORD = aya123`
2. Run: `supabase functions deploy verify-password --project-ref vcursretyrfmkgigmwss --no-verify-jwt`
3. Run: `npm run build && git push`
