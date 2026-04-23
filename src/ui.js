import { FASHION_COLORS, SIZES } from './colors.js';
import { isConfigured } from './supabase.js';
import { compressImage, formatBytes } from './imageCompressor.js';
import {
  addDress, updateDress, deleteDress, getDresses,
  addColorToDress, updateColorImage, deleteColor, renameColor,
  bulkSetSizes, computeStats, searchDresses, resetDressQuantities,
  setSizeQuantity,
} from './inventory.js';
import { syncDressesFullState } from './shopify.js';
import { scanDressCard } from './scan.js';

// ─── STATE ──────────────────────────────────────────────────
let allDresses = [];
let currentView = 'grid'; // 'grid' | 'detail'
let currentDressId = null;
let searchTimeout = null;
let addModeColors = []; // tracks color entries when adding a new dress
let addColorCounter = 0; // unique ID for each color entry in add mode
let selectMode = false;
let selectedDressIds = new Set();
let scanQueue = [];

// ─── FILTER / SORT STATE ────────────────────────────────────
const HISTORY_KEY = 'btb_history.v1';
function logHistory(type, description, dressId = null) {
  try {
    const hist = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    hist.unshift({ type, description, dressId, timestamp: Date.now() });
    if (hist.length > 500) hist.length = 500;
    localStorage.setItem(HISTORY_KEY, JSON.stringify(hist));
  } catch {}
}
let filterColor = '';       // '' = all
let filterPrice = '';
let sortOrder = 'desc';     // 'asc' | 'desc' by ID

// ─── STEPPER HELPERS ────────────────────────────────────────
function renderSizeStepper(size, qty, extraAttrs = '') {
  return `
    <div class="size-stepper-group">
      <label>${size}</label>
      <div class="stepper">
        <button type="button" class="stepper-btn stepper-minus" data-size="${size}" ${extraAttrs}>−</button>
        <span class="stepper-value" data-size="${size}" ${extraAttrs}>${qty}</span>
        <button type="button" class="stepper-btn stepper-plus" data-size="${size}" ${extraAttrs}>+</button>
      </div>
    </div>
  `;
}

function setupSteppers(container) {
  container.querySelectorAll('.stepper-minus').forEach((btn) => {
    btn.addEventListener('click', () => {
      const stepper = btn.closest('.stepper');
      const valueEl = stepper.querySelector('.stepper-value');
      const current = parseInt(valueEl.textContent) || 0;
      if (current > 0) valueEl.textContent = current - 1;
    });
  });
  container.querySelectorAll('.stepper-plus').forEach((btn) => {
    btn.addEventListener('click', () => {
      const stepper = btn.closest('.stepper');
      const valueEl = stepper.querySelector('.stepper-value');
      const current = parseInt(valueEl.textContent) || 0;
      valueEl.textContent = current + 1;
    });
  });
}

function collectStepperValues(container, selector = '.stepper-value') {
  const sizesMap = {};
  container.querySelectorAll(selector).forEach((el) => {
    const qty = parseInt(el.textContent) || 0;
    const size = el.dataset.size;
    if (qty > 0) sizesMap[size] = qty;
  });
  return sizesMap;
}

// ─── INIT ───────────────────────────────────────────────────
export async function initApp() {
  if (!isConfigured()) {
    showSetupScreen();
    return;
  }
  renderShell();
  await loadDresses();
}

function showSetupScreen() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="setup-screen">
      <div class="setup-card">
        <div class="setup-icon">⚙️</div>
        <h1>Setup Required</h1>
        <p>To get started, you need to connect your Supabase project.</p>
        <ol>
          <li>Create a free project at <a href="https://supabase.com" target="_blank">supabase.com</a></li>
          <li>Run the SQL from <code>supabase-setup.sql</code> in the SQL Editor</li>
          <li>Copy your <strong>Project URL</strong> and <strong>Anon Key</strong> from Settings → API</li>
          <li>Paste them in <code>src/supabase.js</code></li>
          <li>Restart the dev server</li>
        </ol>
        <div class="setup-hint">
          <span>📂</span>
          <span>Open <code>src/supabase.js</code> and replace the placeholder values</span>
        </div>
      </div>
    </div>
  `;
}

// ─── APP SHELL ──────────────────────────────────────────────
function renderShell() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="top-strip">
      <div class="top-row">
        <div class="logo">
          <span class="logo-icon">👗</span>
          <span>BrideToBe</span>
        </div>
        <div class="search-box">
          <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
          </svg>
          <input type="text" id="searchInput" placeholder="Search..." autocomplete="off" />
        </div>
      </div>
      <div class="filter-pills">
        <select id="filterColor">
          <option value="">All Colors</option>
          ${FASHION_COLORS.map(c => `<option value="${c.name}">${c.name}</option>`).join('')}
        </select>
        <input type="number" id="filterPrice" placeholder="Price" min="0" />
        <select id="sortOrder">
          <option value="desc">ID: Newest</option>
          <option value="asc">ID: Oldest</option>
          <option value="price_asc">Price ↑</option>
          <option value="price_desc">Price ↓</option>
        </select>
        <button class="btn-reset-filters" id="btnResetFilters">Reset</button>
      </div>
      <div class="stats-bar" id="statsBar"></div>
    </div>

    <main class="main-content">
      <div class="dress-grid" id="dressGrid"></div>
    </main>

    <button class="fab" id="btnAdd" title="Add dress">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="24" height="24">
        <path d="M12 5v14M5 12h14"/>
      </svg>
    </button>

    <nav class="tab-bar">
      <button class="tab-btn active" id="tabInventory">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
          <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
        </svg>
        <span>Inventory</span>
      </button>
      <button class="tab-btn" id="tabScan">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M4 7V5a1 1 0 0 1 1-1h2M17 4h2a1 1 0 0 1 1 1v2M20 17v2a1 1 0 0 1-1 1h-2M7 20H5a1 1 0 0 1-1-1v-2"/>
          <circle cx="12" cy="12" r="3"/>
        </svg>
        <span>Scan</span>
      </button>
      <button class="tab-btn" id="tabSelect">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="9 11 12 14 22 4"/>
          <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>
        </svg>
        <span>Select</span>
      </button>
      <button class="tab-btn" id="tabMore">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="5" r="1.5" fill="currentColor"/>
          <circle cx="12" cy="12" r="1.5" fill="currentColor"/>
          <circle cx="12" cy="19" r="1.5" fill="currentColor"/>
        </svg>
        <span>More</span>
      </button>
    </nav>

    <input type="file" id="scanInput" accept="image/*" capture="environment" style="display:none" />

    <div class="sheet-overlay" id="modalOverlay">
      <div class="sheet" id="dressModal"></div>
    </div>
    <div class="sheet-overlay" id="detailOverlay">
      <div class="sheet" id="detailModal"></div>
    </div>

    <div class="toast-container" id="toastContainer"></div>
  `;

  document.getElementById('btnAdd').addEventListener('click', () => openAddModal());
  document.getElementById('tabSelect').addEventListener('click', toggleSelectMode);
  document.getElementById('tabScan').addEventListener('click', () => document.getElementById('scanInput').click());
  document.getElementById('tabMore').addEventListener('click', openMoreSheet);
  document.getElementById('scanInput').addEventListener('change', handleScanFile);

  document.getElementById('searchInput').addEventListener('input', handleSearch);
  document.getElementById('modalOverlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeModal();
  });
  document.getElementById('detailOverlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeDetail();
  });

  document.getElementById('filterColor').addEventListener('change', (e) => { filterColor = e.target.value; renderGrid(); });
  document.getElementById('filterPrice').addEventListener('input', (e) => { filterPrice = e.target.value; renderGrid(); });
  document.getElementById('sortOrder').addEventListener('change', (e) => { sortOrder = e.target.value; renderGrid(); });
  document.getElementById('btnResetFilters').addEventListener('click', () => {
    filterColor = ''; filterPrice = ''; sortOrder = 'desc';
    document.getElementById('filterColor').value = '';
    document.getElementById('filterPrice').value = '';
    document.getElementById('sortOrder').value = 'desc';
    renderGrid();
  });
}

// ─── DATA LOADING ───────────────────────────────────────────
async function loadDresses() {
  try {
    showGridLoading();
    allDresses = await getDresses();
    renderStats();
    renderGrid();
  } catch (err) {
    showToast('Failed to load dresses: ' + err.message, 'error');
  }
}


function handleSearch(e) {
  clearTimeout(searchTimeout);
  const query = e.target.value.trim();
  searchTimeout = setTimeout(async () => {
    try {
      if (query.length === 0) {
        allDresses = await getDresses();
      } else {
        allDresses = await searchDresses(query);
      }
      renderGrid();
    } catch (err) {
      showToast('Search failed: ' + err.message, 'error');
    }
  }, 300);
}

// ─── STATS BAR ──────────────────────────────────────────────
function renderStats() {
  const stats = computeStats(allDresses);
  const bar = document.getElementById('statsBar');
  bar.innerHTML = `
    <div class="stat-card">
      <span class="stat-value">${stats.totalDresses}</span>
      <span class="stat-label">Dresses</span>
    </div>
    <div class="stat-card">
      <span class="stat-value">${stats.totalColors}</span>
      <span class="stat-label">Color Variants</span>
    </div>
    <div class="stat-card">
      <span class="stat-value">${stats.totalPieces}</span>
      <span class="stat-label">Total Pieces</span>
    </div>
  `;
}

// ─── DRESS GRID ─────────────────────────────────────────────
function showGridLoading() {
  const grid = document.getElementById('dressGrid');
  grid.innerHTML = Array(6).fill('').map(() => `
    <div class="dress-card skeleton">
      <div class="skeleton-img"></div>
      <div class="skeleton-text"></div>
      <div class="skeleton-text short"></div>
    </div>
  `).join('');
}

function renderGrid() {
  const grid = document.getElementById('dressGrid');
  // ── Filter ──
  let filtered = allDresses.filter((dress) => {
    // Color filter: keep dress if it has at least one matching color
    if (filterColor) {
      const hasColor = (dress.dress_colors || []).some(c => c.color_name === filterColor);
      if (!hasColor) return false;
    }
    // Price filter
    const price = Number(dress.price) || 0;
    if (filterPrice !== '' && price !== Number(filterPrice)) return false;
    return true;
  });

  // ── Sort ──
  filtered.sort((a, b) => {
    if (sortOrder === 'asc') return a.id.localeCompare(b.id);
    if (sortOrder === 'desc') return b.id.localeCompare(a.id);
    if (sortOrder === 'price_asc') return (Number(a.price) || 0) - (Number(b.price) || 0);
    if (sortOrder === 'price_desc') return (Number(b.price) || 0) - (Number(a.price) || 0);
    return 0;
  });

  if (filtered.length === 0) {
    grid.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">👗</div>
        <h2>${allDresses.length === 0 ? 'No dresses yet' : 'No matches'}</h2>
        <p>${allDresses.length === 0 ? 'Click "Add Dress" to start tracking your inventory' : 'Try adjusting your filters'}</p>
      </div>
    `;
    return;
  }

  grid.innerHTML = filtered.map((dress) => {
    const firstColor = dress.dress_colors?.[0];
    const totalPieces = (dress.dress_colors || []).reduce((sum, c) =>
      sum + (c.dress_sizes || []).reduce((s, sz) => s + (sz.quantity || 0), 0), 0
    );
    const colorCount = dress.dress_colors?.length || 0;
    const isSoldOut = totalPieces === 0;

    const isSelected = selectedDressIds.has(dress.id);
    return `
      <div class="dress-card${isSoldOut ? ' sold-out' : ''}${isSelected ? ' selected' : ''}${selectMode ? ' select-mode' : ''}" data-id="${dress.id}">
        <div class="card-image" style="${firstColor?.image_url ? `background-image:url(${firstColor.image_url})` : ''}">
          ${!firstColor?.image_url ? '<div class="no-image">👗</div>' : ''}
          <div class="card-badge">${dress.id}</div>
          ${isSoldOut ? '<div class="sold-out-banner">SOLD OUT</div>' : ''}
        </div>
        <div class="card-body">
          <h3 class="card-title">${dress.id}</h3>
          <div class="card-price">${dress.price ? '$' + Number(dress.price).toFixed(0) : ''}</div>
          <div class="card-color-list">
            ${(dress.dress_colors || []).map(c => {
              const availableSizes = (c.dress_sizes || []).filter(sz => sz.quantity > 0).map(sz => sz.size).sort((a,b) => a - b);
              return `<div class="card-color-row">
                <span class="color-dot" style="background:${c.color_hex}"></span>
                <span class="card-color-name">${c.color_name}</span>
                <span class="card-color-sizes">${availableSizes.length > 0 ? availableSizes.map(s => `<span class="size-chip">${s}</span>`).join('') : '<span style="color:var(--text-3)">—</span>'}</span>
              </div>`;
            }).join('')}
            ${colorCount === 0 ? '<div class="card-color-row"><span class="meta-count">No colors</span></div>' : ''}
          </div>
          <div class="card-footer">
            <span class="pieces-badge${isSoldOut ? ' sold-out-badge' : ''}">${isSoldOut ? 'Sold Out' : totalPieces + ' piece' + (totalPieces !== 1 ? 's' : '')}</span>
            <div class="card-actions">
              <button class="btn-icon btn-edit" data-action="edit" data-id="${dress.id}" title="Edit">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
                  <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
                  <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
                </svg>
              </button>
              <button class="btn-icon btn-delete" data-action="delete" data-id="${dress.id}" title="Delete">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
                  <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
  }).join('');

  // Attach card click handlers
  grid.querySelectorAll('.dress-card').forEach((card) => {
    card.addEventListener('click', (e) => {
      const action = e.target.closest('[data-action]');
      const id = card.dataset.id;
      if (selectMode) {
        e.stopPropagation();
        if (selectedDressIds.has(id)) selectedDressIds.delete(id);
        else selectedDressIds.add(id);
        renderGrid();
        updateSelectionUI();
        return;
      }
      if (action?.dataset.action === 'edit') {
        e.stopPropagation();
        openEditModal(id);
      } else if (action?.dataset.action === 'delete') {
        e.stopPropagation();
        confirmDelete(id);
      } else {
        openDetail(id);
      }
    });
  });
}

function toggleSelectMode() {
  selectMode = !selectMode;
  selectedDressIds = new Set();
  updateSelectionUI();
  renderGrid();
}

function updateSelectionUI() {
  const tabSelect = document.getElementById('tabSelect');
  if (tabSelect) tabSelect.classList.toggle('active', selectMode);
}

function openMoreSheet() {
  const modal = document.getElementById('dressModal');
  const overlay = document.getElementById('modalOverlay');
  const count = selectedDressIds.size;

  const cancelSelectBtn = selectMode
    ? `<button class="action-sheet-btn action-sheet-btn-gold" id="btnSheetCancelSelect">Cancel Selection</button>`
    : '';
  const resetBtn = selectMode && count > 0
    ? `<button class="action-sheet-btn action-sheet-btn-warning" id="btnSheetReset">Reset ${count} dress${count !== 1 ? 'es' : ''} to 0</button>`
    : '';
  const deleteBtn = selectMode && count > 0
    ? `<button class="action-sheet-btn action-sheet-btn-danger" id="btnSheetDelete">Delete ${count} dress${count !== 1 ? 'es' : ''}</button>`
    : '';
  const selectBtn = !selectMode
    ? `<button class="action-sheet-btn" id="btnSheetSelect">Select Items</button>`
    : '';

  const syncBtn = selectMode && count > 0
    ? `<button class="action-sheet-btn action-sheet-btn-gold" id="btnSheetSync">Sync ${count} dress${count !== 1 ? 'es' : ''} to Shopify</button>`
    : '';

  modal.innerHTML = `
    <div class="sheet-handle"></div>
    <div class="action-sheet">
      <p class="action-sheet-title">Actions</p>
      ${selectBtn}${cancelSelectBtn}${syncBtn}${resetBtn}${deleteBtn}
      <button class="action-sheet-btn" id="btnSheetHistory">View History</button>
      <button class="action-sheet-btn action-sheet-btn-cancel" id="btnSheetClose">Cancel</button>
    </div>
  `;

  overlay.classList.add('active');
  modal.querySelector('#btnSheetClose')?.addEventListener('click', closeModal);
  modal.querySelector('#btnSheetSelect')?.addEventListener('click', () => { closeModal(); toggleSelectMode(); });
  modal.querySelector('#btnSheetCancelSelect')?.addEventListener('click', () => { closeModal(); toggleSelectMode(); });
  modal.querySelector('#btnSheetReset')?.addEventListener('click', () => { closeModal(); handleResetSelected(); });
  modal.querySelector('#btnSheetDelete')?.addEventListener('click', () => { closeModal(); handleDeleteSelected(); });
  modal.querySelector('#btnSheetSync')?.addEventListener('click', () => { closeModal(); syncSelectedDresses(); });
  modal.querySelector('#btnSheetHistory')?.addEventListener('click', () => { closeModal(); openHistorySheet(); });
}

async function handleResetSelected() {
  const ids = Array.from(selectedDressIds);
  if (ids.length === 0) return;
  if (!confirm(`Reset all quantities to 0 for ${ids.length} dress${ids.length > 1 ? 'es' : ''}?`)) return;
  try {
    for (const id of ids) {
      await resetDressQuantities(id);
      const dress = allDresses.find((d) => d.id === id);
    }
    logHistory('reset', `Reset ${ids.length} dress${ids.length > 1 ? 'es' : ''} to 0`);
    showToast(`${ids.length} dress${ids.length > 1 ? 'es' : ''} reset to 0.`, 'success');
    selectedDressIds = new Set();
    await loadDresses();
    updateSelectionUI();
  } catch (err) {
    showToast('Reset failed: ' + err.message, 'error');
  }
}

async function handleDeleteSelected() {
  const ids = Array.from(selectedDressIds);
  if (ids.length === 0) return;
  if (!confirm(`Delete ${ids.length} dress${ids.length > 1 ? 'es' : ''}? This cannot be undone.`)) return;
  try {
    for (const id of ids) {
      const dressToDelete = allDresses.find((d) => d.id === id);
      await deleteDress(id);
      for (const color of dressToDelete?.dress_colors || []) {
        for (const sz of color.dress_sizes || []) {
        }
      }
    }
    logHistory('delete', `Deleted ${ids.length} dress${ids.length > 1 ? 'es' : ''}`);
    showToast(`${ids.length} dress${ids.length > 1 ? 'es' : ''} deleted.`, 'success');
    selectedDressIds = new Set();
    await loadDresses();
    updateSelectionUI();
  } catch (err) {
    showToast('Delete failed: ' + err.message, 'error');
  }
}

async function syncSelectedDresses() {
  const ids = Array.from(selectedDressIds);
  const dressesToSync = allDresses.filter((d) => ids.includes(d.id));
  if (dressesToSync.length === 0) {
    showToast('No dresses selected.', 'error');
    return;
  }
  const totalVariants = dressesToSync.reduce((n, d) =>
    n + (d.dress_colors || []).reduce((m, c) => m + (c.dress_sizes || []).length, 0), 0);
  if (totalVariants === 0) {
    showToast('Selected dresses have no variants to sync.', 'error');
    return;
  }
  showToast(`Syncing ${totalVariants} variant${totalVariants !== 1 ? 's' : ''}…`, 'info');
  try {
    const { succeeded, failed } = await syncDressesFullState(dressesToSync);
    logHistory('sync', `Full sync of ${ids.length} dress${ids.length !== 1 ? 'es' : ''} (${succeeded.length} variants) to Shopify`);
    if (failed.length === 0) {
      showToast(`Synced ${succeeded.length} variant${succeeded.length !== 1 ? 's' : ''} to Shopify!`, 'success');
    } else {
      showToast(`Sync partial: ${succeeded.length} OK, ${failed.length} failed.`, 'error');
    }
  } catch (err) {
    showToast('Sync failed: ' + err.message, 'error');
  }
}

function openHistorySheet() {
  const modal = document.getElementById('dressModal');
  const overlay = document.getElementById('modalOverlay');

  let hist = [];
  try { hist = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch {}

  const iconMap = { scan: '📸', sync: '🔄', delete: '🗑️', add: '✚', edit: '✏️', reset: '↺' };
  const rowsHtml = hist.slice(0, 100).map((entry) => {
    const d = new Date(entry.timestamp);
    const timeStr = d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const icon = iconMap[entry.type] || '•';
    return `
      <div class="history-row">
        <span class="history-icon">${icon}</span>
        <div class="history-info">
          <span class="history-desc">${entry.description}${entry.dressId ? ' · #' + entry.dressId : ''}</span>
          <span class="history-time">${timeStr}</span>
        </div>
      </div>
    `;
  }).join('') || '<p class="empty-queue-msg">No history yet</p>';

  modal.innerHTML = `
    <div class="sheet-handle"></div>
    <div class="modal-header">
      <h2>History</h2>
      <button class="btn-icon btn-close" id="btnCloseHistory">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20">
          <path d="M18 6L6 18M6 6l12 12"/>
        </svg>
      </button>
    </div>
    <div class="history-list">${rowsHtml}</div>
  `;

  overlay.classList.add('active');
  modal.querySelector('#btnCloseHistory').addEventListener('click', closeModal);
}

async function handleScanFile(e) {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  showToast('Scanning...', 'info');
  try {
    const result = await scanDressCard(file);
    const dressId = (result?.dress_id || '').toString().trim();
    const colorName = (result?.color || '').toString().trim();
    const size = parseInt(result?.size);

    if (!dressId) { showToast('AI could not read a dress ID from the photo.', 'error'); return; }

    const match = allDresses.find((d) => d.id === dressId || d.id === dressId.padStart(3, '0'));
    if (!match) { showToast(`No dress "${dressId}" found in inventory.`, 'error'); return; }

    if (!colorName || !size) {
      showToast(`Read dress ${match.id} but no color/size — opening edit view.`, 'error');
      openEditModal(match.id);
      return;
    }

    const color = match.dress_colors?.find((c) => c.color_name.toLowerCase() === colorName.toLowerCase());
    if (!color) { showToast(`Dress ${match.id} has no color "${colorName}".`, 'error'); return; }

    const sizeEntry = color.dress_sizes?.find((s) => s.size === size);
    const currentQty = sizeEntry?.quantity || 0;

    openScanChoiceModal(match, color, size, currentQty);
  } catch (err) {
    showToast('Scan failed: ' + err.message, 'error');
  }
}

function openScanChoiceModal(dress, color, size, currentQty) {
  const modal = document.getElementById('dressModal');
  const overlay = document.getElementById('modalOverlay');
  modal.innerHTML = `
    <div class="sheet-handle"></div>
    <div class="confirm-dialog">
      <div class="confirm-icon">📸</div>
      <h2>Scanned: ${dress.id}</h2>
      <p>
        <strong>${color.color_name}</strong> · Size <strong>${size}</strong><br>
        Current quantity: <strong>${currentQty}</strong>
      </p>
      <div class="form-actions" style="gap:8px;flex-wrap:wrap;justify-content:center">
        <button class="btn btn-ghost" id="btnScanCancel">Cancel</button>
        <button class="btn btn-primary" id="btnScanAdd">+ Add 1</button>
        <button class="btn btn-danger" id="btnScanRemove" ${currentQty <= 0 ? 'disabled' : ''}>− Remove 1</button>
      </div>
    </div>
  `;
  overlay.classList.add('active');
  modal.querySelector('#btnScanCancel').addEventListener('click', closeModal);
  modal.querySelector('#btnScanAdd').addEventListener('click', () => stageToScanQueue(dress, color, size, currentQty, +1));
  modal.querySelector('#btnScanRemove').addEventListener('click', () => stageToScanQueue(dress, color, size, currentQty, -1));
}

function stageToScanQueue(dress, color, size, currentQty, delta) {
  scanQueue = scanQueue.filter(
    (item) => !(item.dressId === dress.id && item.colorName === color.color_name && item.size === size)
  );
  scanQueue.push({ dressId: dress.id, colorId: color.id, colorName: color.color_name, size, delta, currentQty });
  openScanQueueSheet();
}

function openScanQueueSheet() {
  const modal = document.getElementById('dressModal');
  const overlay = document.getElementById('modalOverlay');

  const rowsHtml = scanQueue.map((item, idx) => `
    <div class="scan-queue-row">
      <div class="scan-queue-info">
        <span class="scan-queue-id">#${item.dressId}</span>
        <span class="scan-queue-detail">${item.colorName} · Size ${item.size}</span>
      </div>
      <span class="scan-queue-delta ${item.delta > 0 ? 'add' : 'remove'}">${item.delta > 0 ? '+1' : '−1'}</span>
      <button class="scan-queue-remove" data-idx="${idx}">×</button>
    </div>
  `).join('');

  modal.innerHTML = `
    <div class="sheet-handle"></div>
    <div class="modal-header">
      <h2>Scan Queue (${scanQueue.length})</h2>
      <button class="btn-icon btn-close" id="btnScanQueueClose">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20">
          <path d="M18 6L6 18M6 6l12 12"/>
        </svg>
      </button>
    </div>
    ${scanQueue.length === 0
      ? '<p class="empty-queue-msg">Queue is empty</p>'
      : `<div class="scan-queue-list">${rowsHtml}</div>`
    }
    <div class="sheet-footer">
      ${scanQueue.length > 0 ? `<button class="btn btn-primary btn-full" id="btnApplyAll">Apply All (${scanQueue.length})</button>` : ''}
      <button class="btn btn-ghost btn-full" id="btnScanQueueDone">Done</button>
    </div>
  `;

  overlay.classList.add('active');
  modal.querySelector('#btnScanQueueClose')?.addEventListener('click', closeModal);
  modal.querySelector('#btnScanQueueDone')?.addEventListener('click', closeModal);
  modal.querySelector('#btnApplyAll')?.addEventListener('click', applyScanQueue);
  modal.querySelectorAll('.scan-queue-remove').forEach((btn) => {
    btn.addEventListener('click', () => {
      scanQueue.splice(parseInt(btn.dataset.idx), 1);
      if (scanQueue.length === 0) { closeModal(); } else { openScanQueueSheet(); }
    });
  });
}

async function applyScanQueue() {
  if (scanQueue.length === 0) return;
  const items = [...scanQueue];
  const btn = document.getElementById('btnApplyAll');
  if (btn) { btn.disabled = true; btn.textContent = 'Applying...'; }
  try {
    for (const item of items) {
      const newQty = Math.max(0, item.currentQty + item.delta);
      await setSizeQuantity(item.colorId, item.size, newQty);
      logHistory('scan', `${item.delta > 0 ? 'Added 1' : 'Removed 1'} · ${item.colorName} · Size ${item.size}`, item.dressId);
    }
    scanQueue = [];
    showToast(`Applied ${items.length} scan${items.length !== 1 ? 's' : ''} to inventory.`, 'success');
    closeModal();
    await loadDresses();
  } catch (err) {
    showToast('Apply failed: ' + err.message, 'error');
    if (btn) { btn.disabled = false; btn.textContent = `Apply All (${scanQueue.length})`; }
  }
}

// ─── DETAIL VIEW ────────────────────────────────────────────
function openDetail(dressId) {
  const dress = allDresses.find((d) => d.id === dressId);
  if (!dress) return;

  const overlay = document.getElementById('detailOverlay');
  const modal = document.getElementById('detailModal');
  const totalPieces = (dress.dress_colors || []).reduce((sum, c) =>
    sum + (c.dress_sizes || []).reduce((s, sz) => s + (sz.quantity || 0), 0), 0
  );

  modal.innerHTML = `
    <div class="sheet-handle"></div>
    <div class="detail-header">
      <div>
        <h2>Dress ${dress.id}</h2>
        <span class="detail-id">${dress.price ? 'Price: $' + Number(dress.price).toFixed(0) : ''}</span>
      </div>
      <button class="btn-icon btn-close" id="btnCloseDetail">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20">
          <path d="M18 6L6 18M6 6l12 12"/>
        </svg>
      </button>
    </div>
    ${dress.notes ? `<p class="detail-notes">${dress.notes}</p>` : ''}
    <div class="detail-stats">
      <span class="detail-stat">${dress.dress_colors?.length || 0} Colors</span>
      <span class="detail-stat">${totalPieces} Pieces</span>
    </div>
    <div class="detail-colors">
      ${(dress.dress_colors || []).map((color) => `
        <div class="detail-color-section">
          <div class="detail-color-header">
            <span class="color-dot large" style="background:${color.color_hex}"></span>
            <span class="detail-color-name">${color.color_name}</span>
          </div>
          <div class="detail-color-content">
            ${color.image_url ? `<img src="${color.image_url}" class="detail-color-img" alt="${color.color_name}" />` : ''}
            <div class="detail-sizes">
              <table class="sizes-table">
                <thead><tr><th>Size</th><th>Qty</th></tr></thead>
                <tbody>
                  ${SIZES.map((s) => {
                    const entry = (color.dress_sizes || []).find((ds) => ds.size === s);
                    const qty = entry?.quantity || 0;
                    if (qty === 0) return '';
                    return `<tr><td>${s}</td><td>${qty}</td></tr>`;
                  }).filter(Boolean).join('') || '<tr><td colspan="2" class="no-sizes">No sizes set</td></tr>'}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      `).join('')}
    </div>
  `;

  overlay.classList.add('active');
  modal.querySelector('#btnCloseDetail').addEventListener('click', closeDetail);
}

function closeDetail() {
  document.getElementById('detailOverlay').classList.remove('active');
}

// ─── AUTO-ID HELPER ─────────────────────────────────────────
function getNextDressId() {
  let maxNum = 0;
  for (const dress of allDresses) {
    const num = parseInt(dress.id, 10);
    if (!isNaN(num) && String(num).padStart(3, '0') === dress.id) {
      if (num > maxNum) maxNum = num;
    }
  }
  return String(maxNum + 1).padStart(3, '0');
}

// ─── ADD COLOR BLOCK RENDERER ───────────────────────────────
function renderColorBlock(idx) {
  return `
    <div class="add-color-block" data-color-idx="${idx}">
      <div class="add-color-block-header">
        <h4 class="add-color-block-title">Color ${idx + 1}</h4>
        ${idx > 0 ? `<button type="button" class="btn-icon btn-remove-color-block" data-color-idx="${idx}" title="Remove this color">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>` : ''}
      </div>
      <div class="color-picker-section">
        <label>Pick a color</label>
        <div class="color-swatches" data-color-idx="${idx}">
          ${FASHION_COLORS.map((c) => `
            <button type="button" class="swatch" data-name="${c.name}" data-hex="${c.hex}" data-color-idx="${idx}" style="background:${c.hex}" title="${c.name}">
              ${c.hex === '#FFFFFF' ? '<span class="swatch-border"></span>' : ''}
            </button>
          `).join('')}
        </div>
        <div class="selected-color">
          <span class="color-dot selected-dot" data-color-idx="${idx}" style="background:#000"></span>
          <span class="selected-name" data-color-idx="${idx}">Black</span>
          <input type="hidden" class="color-name-input" data-color-idx="${idx}" value="Black" />
          <input type="hidden" class="color-hex-input" data-color-idx="${idx}" value="#000000" />
        </div>
      </div>
      <div class="form-group">
        <label>Image for this color</label>
        <div class="image-upload-area" data-color-idx="${idx}">
          <input type="file" accept="image/*" class="file-input color-image-input" data-color-idx="${idx}" />
          <div class="upload-placeholder" data-color-idx="${idx}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="32" height="32">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
              <polyline points="17 8 12 3 7 8"/>
              <line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
            <span>Click or drag to upload</span>
          </div>
          <div class="upload-preview" data-color-idx="${idx}" style="display:none">
            <img class="preview-img" data-color-idx="${idx}" src="" alt="" />
            <div class="compression-info" data-color-idx="${idx}"></div>
          </div>
        </div>
      </div>
      <div class="sizes-grid" data-color-idx="${idx}">
        ${SIZES.map((s) => renderSizeStepper(s, 0, `data-color-idx="${idx}"`)).join('')}
      </div>
    </div>
  `;
}

function setupColorBlock(modal, idx) {
  const block = modal.querySelector(`.add-color-block[data-color-idx="${idx}"]`);
  if (!block) return;

  // Color swatch selection
  block.querySelectorAll('.swatch').forEach((sw) => {
    sw.addEventListener('click', () => {
      block.querySelectorAll('.swatch').forEach((s) => s.classList.remove('active'));
      sw.classList.add('active');
      block.querySelector('.color-name-input').value = sw.dataset.name;
      block.querySelector('.color-hex-input').value = sw.dataset.hex;
      block.querySelector('.selected-dot').style.background = sw.dataset.hex;
      block.querySelector('.selected-name').textContent = sw.dataset.name;
    });
  });
  block.querySelector('.swatch[data-name="Black"]')?.classList.add('active');

  // Image upload for this block
  const input = block.querySelector('.color-image-input');
  const area = block.querySelector('.image-upload-area');
  const placeholder = block.querySelector('.upload-placeholder');
  const preview = block.querySelector('.upload-preview');
  const previewImg = block.querySelector('.preview-img');
  const compressionInfo = block.querySelector('.compression-info');

  area.addEventListener('dragover', (e) => { e.preventDefault(); area.classList.add('dragover'); });
  area.addEventListener('dragleave', () => area.classList.remove('dragover'));
  area.addEventListener('drop', (e) => {
    e.preventDefault();
    area.classList.remove('dragover');
    if (e.dataTransfer.files.length) {
      input.files = e.dataTransfer.files;
      handlePreview(input.files[0]);
    }
  });
  input.addEventListener('change', () => { if (input.files[0]) handlePreview(input.files[0]); });

  async function handlePreview(file) {
    placeholder.style.display = 'none';
    preview.style.display = 'flex';
    compressionInfo.innerHTML = '<span class="spinner small"></span> Compressing...';
    try {
      const result = await compressImage(file);
      previewImg.src = result.dataUrl;
      compressionInfo.innerHTML = `<span class="compression-stat good"><strong>${formatBytes(result.originalSize)}</strong> → <strong>${formatBytes(result.compressedSize)}</strong> <span class="savings">(saved ${result.savings})</span></span>`;
    } catch (err) {
      compressionInfo.innerHTML = '<span class="compression-stat bad">Compression failed</span>';
    }
  }

  // Remove color block
  const removeBtn = block.querySelector('.btn-remove-color-block');
  if (removeBtn) {
    removeBtn.addEventListener('click', () => {
      block.remove();
      // Renumber remaining block titles
      modal.querySelectorAll('.add-color-block').forEach((b, i) => {
        b.querySelector('.add-color-block-title').textContent = `Color ${i + 1}`;
      });
    });
  }

  // Setup steppers for this block
  setupSteppers(block);
}

// ─── ADD / EDIT MODAL ───────────────────────────────────────
function openAddModal() {
  addModeColors = [];
  addColorCounter = 0;
  renderDressForm(null);
  document.getElementById('modalOverlay').classList.add('active');
}

async function openEditModal(dressId) {
  const dress = allDresses.find((d) => d.id === dressId);
  if (!dress) return;
  renderDressForm(dress);
  document.getElementById('modalOverlay').classList.add('active');
}

function closeModal() {
  document.getElementById('modalOverlay').classList.remove('active');
}

function renderDressForm(dress) {
  const isEdit = !!dress;
  const modal = document.getElementById('dressModal');

  // Auto-generate next ID for add mode
  const nextId = !isEdit ? getNextDressId() : '';

  // Build existing colors section for edit mode
  let existingColorsHTML = '';
  if (isEdit && dress.dress_colors?.length) {
    existingColorsHTML = `
      <div class="form-divider"></div>
      <h3 class="form-section-title">Color Variants</h3>
      <div class="edit-colors-list" id="editColorsList">
        ${dress.dress_colors.map((color) => `
          <div class="edit-color-section" data-color-id="${color.id}">
            <div class="edit-color-header">
              <div class="edit-color-info">
                <span class="color-dot large" style="background:${color.color_hex}"></span>
                <span class="edit-color-name" data-color-id="${color.id}">${color.color_name}</span>
                <button type="button" class="btn-icon btn-rename-color" data-color-id="${color.id}" data-color-name="${color.color_name}" title="Rename color">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                    <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
                  </svg>
                </button>
              </div>
              <button type="button" class="btn-icon btn-delete-color" data-color-id="${color.id}" title="Delete this color">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
                  <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                </svg>
              </button>
            </div>
            ${color.image_url ? `<img src="${color.image_url}" class="edit-color-thumb" alt="${color.color_name}" />` : ''}
            <div class="sizes-grid edit-sizes-grid">
              ${SIZES.map((s) => {
                const entry = (color.dress_sizes || []).find((ds) => ds.size === s);
                const qty = entry?.quantity || 0;
                return renderSizeStepper(s, qty, `data-color-id="${color.id}"`);
              }).join('')}
            </div>
          </div>
        `).join('')}
      </div>
      <button type="button" class="btn btn-ghost btn-add-color" id="btnAddColor">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="16" height="16">
          <path d="M12 5v14M5 12h14"/>
        </svg>
        Add Another Color
      </button>
    `;
  } else if (isEdit) {
    existingColorsHTML = `
      <div class="form-divider"></div>
      <p class="no-colors-msg">No colors added yet.</p>
      <button type="button" class="btn btn-ghost btn-add-color" id="btnAddColor">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="16" height="16">
          <path d="M12 5v14M5 12h14"/>
        </svg>
        Add a Color
      </button>
    `;
  }

  modal.innerHTML = `
    <div class="sheet-handle"></div>
    <div class="modal-header">
      <h2>${isEdit ? 'Edit Dress' : 'Add New Dress'}</h2>
      <button class="btn-icon btn-close" id="btnCloseModal">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20">
          <path d="M18 6L6 18M6 6l12 12"/>
        </svg>
      </button>
    </div>
    <form id="dressForm" class="dress-form">
      <div class="form-row">
        <div class="form-group">
          <label for="dressId">Dress ID *</label>
          <input type="text" id="dressId" value="${isEdit ? dress.id : nextId}" placeholder="e.g. 001" ${isEdit ? 'readonly' : 'required'} />
        </div>
        <div class="form-group">
          <label for="dressPrice">Price ($)</label>
          <input type="number" id="dressPrice" value="${dress?.price || ''}" placeholder="e.g. 105" min="0" step="1" />
        </div>
      </div>
      <div class="form-group">
        <label for="dressNotes">Notes</label>
        <textarea id="dressNotes" rows="2" placeholder="Optional notes...">${dress?.notes || ''}</textarea>
      </div>

      ${isEdit ? existingColorsHTML : `
        <div class="form-divider"></div>
        <h3 class="form-section-title">Colors</h3>
        <div id="addColorBlocks">
          ${renderColorBlock(0)}
        </div>
        <button type="button" class="btn btn-ghost btn-add-color" id="btnAddAnotherColor">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="16" height="16">
            <path d="M12 5v14M5 12h14"/>
          </svg>
          Add Another Color
        </button>
      `}

      <div class="form-actions">
        <button type="button" class="btn btn-ghost" id="btnCancel">Cancel</button>
        <button type="submit" class="btn btn-primary" id="btnSubmit">
          ${isEdit ? 'Save Changes' : 'Add Dress'}
        </button>
      </div>
    </form>
  `;

  // Event listeners
  modal.querySelector('#btnCloseModal').addEventListener('click', closeModal);
  modal.querySelector('#btnCancel').addEventListener('click', closeModal);

  if (isEdit) {
    // "Add Color" button opens the addColor modal
    const addColorBtn = modal.querySelector('#btnAddColor');
    if (addColorBtn) {
      addColorBtn.addEventListener('click', () => {
        closeModal();
        openAddColorModal(dress.id);
      });
    }

    // Delete color buttons
    modal.querySelectorAll('.btn-delete-color').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const colorId = btn.dataset.colorId;
        if (!confirm('Delete this color variant? This cannot be undone.')) return;
        btn.disabled = true;
        try {
          const colorToDelete = dress.dress_colors.find((c) => c.id === colorId);
          await deleteColor(colorId);
          for (const sizeEntry of colorToDelete?.dress_sizes || []) {
          }
          showToast('Color deleted', 'success');
          allDresses = await getDresses();
          const updatedDress = allDresses.find((d) => d.id === dress.id);
          if (updatedDress) {
            renderDressForm(updatedDress);
          } else {
            closeModal();
          }
          renderStats();
          renderGrid();
        } catch (err) {
          showToast('Error: ' + err.message, 'error');
          btn.disabled = false;
        }
      });
    });

    // Rename color buttons
    modal.querySelectorAll('.btn-rename-color').forEach((btn) => {
      btn.addEventListener('click', () => {
        const colorId = btn.dataset.colorId;
        const oldName = btn.dataset.colorName;
        const newName = prompt(`Rename "${oldName}" to:`, oldName)?.trim();
        if (!newName || newName === oldName) return;
        renameColor(colorId, newName).then(async () => {
          showToast(`Renamed to "${newName}"`, 'success');
          allDresses = await getDresses();
          const updatedDress = allDresses.find((d) => d.id === dress.id);
          if (updatedDress) renderDressForm(updatedDress);
        }).catch((err) => showToast('Rename failed: ' + err.message, 'error'));
      });
    });

    // Setup steppers for edit mode
    setupSteppers(modal);
  } else {
    // Setup first color block
    addColorCounter = 1;
    setupColorBlock(modal, 0);

    // "Add Another Color" button
    const addBtn = modal.querySelector('#btnAddAnotherColor');
    if (addBtn) {
      addBtn.addEventListener('click', () => {
        const idx = addColorCounter++;
        const container = modal.querySelector('#addColorBlocks');
        container.insertAdjacentHTML('beforeend', renderColorBlock(idx));
        setupColorBlock(modal, idx);
        // Scroll the new block into view
        const newBlock = container.querySelector(`.add-color-block[data-color-idx="${idx}"]`);
        newBlock?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    }
  }

  // Form submit
  modal.querySelector('#dressForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = modal.querySelector('#btnSubmit');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Saving...';

    try {
      if (isEdit) {
        // Update dress price/notes
        await updateDress(dress.id, {
          price: parseFloat(document.getElementById('dressPrice').value) || 0,
          notes: document.getElementById('dressNotes').value,
        });

        // Update size quantities for all colors
        const sizeUpdates = {};
        modal.querySelectorAll('.edit-sizes-grid .stepper-value').forEach((el) => {
          const colorId = el.dataset.colorId;
          const size = parseInt(el.dataset.size);
          const qty = parseInt(el.textContent) || 0;
          if (!sizeUpdates[colorId]) sizeUpdates[colorId] = {};
          sizeUpdates[colorId][size] = qty;
        });

        for (const [colorId, sizes] of Object.entries(sizeUpdates)) {
          const originalColor = dress.dress_colors.find((c) => c.id === colorId);
          const changedSizes = {};
          for (const [size, qty] of Object.entries(sizes)) {
            const original = (originalColor?.dress_sizes || []).find((ds) => ds.size === parseInt(size));
            const origQty = original?.quantity || 0;
            if (qty !== origQty) {
              changedSizes[size] = qty;
            }
          }
          if (Object.keys(changedSizes).length > 0) {
            await bulkSetSizes(colorId, changedSizes);
            for (const [size, qty] of Object.entries(changedSizes)) {
            }
          }
        }

        logHistory('edit', 'Updated dress details', dress.id);
        showToast('Dress updated!', 'success');
      } else {
        const dressId = document.getElementById('dressId').value.trim();
        const price = parseFloat(document.getElementById('dressPrice').value) || 0;
        const notes = document.getElementById('dressNotes').value.trim();

        // Create dress first
        await addDress(dressId, price, notes);

        // Loop through all color blocks and save each
        const colorBlocks = modal.querySelectorAll('.add-color-block');
        for (const block of colorBlocks) {
          const colorName = block.querySelector('.color-name-input').value;
          const colorHex = block.querySelector('.color-hex-input').value;
          const imageFile = block.querySelector('.color-image-input').files[0] || null;

          // Collect sizes for this color block
          const sizesMap = {};
          block.querySelectorAll('.stepper-value').forEach((el) => {
            const qty = parseInt(el.textContent) || 0;
            if (qty > 0) sizesMap[el.dataset.size] = qty;
          });

          const colorData = await addColorToDress(dressId, colorName, colorHex, imageFile);
          if (Object.keys(sizesMap).length > 0) {
            await bulkSetSizes(colorData.id, sizesMap);
            for (const [size, qty] of Object.entries(sizesMap)) {
            }
          }
        }

        const colorCount = colorBlocks.length;
        logHistory('add', `Added dress with ${colorCount} color${colorCount > 1 ? 's' : ''}`, dressId);
        showToast(`Dress added with ${colorCount} color${colorCount > 1 ? 's' : ''}!`, 'success');
      }

      closeModal();
      await loadDresses();
    } catch (err) {
      showToast('Error: ' + err.message, 'error');
      btn.disabled = false;
      btn.innerHTML = isEdit ? 'Save Changes' : 'Add Dress';
    }
  });
}

function setupImageUpload() {
  const input = document.getElementById('colorImage');
  const area = document.getElementById('imageUploadArea');
  const placeholder = document.getElementById('uploadPlaceholder');
  const preview = document.getElementById('uploadPreview');
  const previewImg = document.getElementById('previewImg');
  const compressionInfo = document.getElementById('compressionInfo');

  // Drag and drop
  area.addEventListener('dragover', (e) => {
    e.preventDefault();
    area.classList.add('dragover');
  });
  area.addEventListener('dragleave', () => area.classList.remove('dragover'));
  area.addEventListener('drop', (e) => {
    e.preventDefault();
    area.classList.remove('dragover');
    if (e.dataTransfer.files.length) {
      input.files = e.dataTransfer.files;
      handleImagePreview(input.files[0]);
    }
  });

  input.addEventListener('change', () => {
    if (input.files[0]) handleImagePreview(input.files[0]);
  });

  async function handleImagePreview(file) {
    placeholder.style.display = 'none';
    preview.style.display = 'flex';
    compressionInfo.innerHTML = '<span class="spinner small"></span> Compressing...';

    try {
      const result = await compressImage(file);
      previewImg.src = result.dataUrl;
      compressionInfo.innerHTML = `
        <span class="compression-stat good">
          <strong>${formatBytes(result.originalSize)}</strong> → <strong>${formatBytes(result.compressedSize)}</strong>
          <span class="savings">(saved ${result.savings})</span>
        </span>
      `;
    } catch (err) {
      compressionInfo.innerHTML = `<span class="compression-stat bad">Compression failed</span>`;
    }
  }
}

// ─── ADD COLOR TO EXISTING DRESS ────────────────────────────
export function openAddColorModal(dressId) {
  const modal = document.getElementById('dressModal');
  const overlay = document.getElementById('modalOverlay');

  modal.innerHTML = `
    <div class="sheet-handle"></div>
    <div class="modal-header">
      <h2>Add Color to ${dressId}</h2>
      <button class="btn-icon btn-close" id="btnCloseModal">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20">
          <path d="M18 6L6 18M6 6l12 12"/>
        </svg>
      </button>
    </div>
    <form id="addColorForm" class="dress-form">
      <div class="color-picker-section">
        <label>Pick a color</label>
        <div class="color-swatches" id="colorSwatches">
          ${FASHION_COLORS.map((c) => `
            <button type="button" class="swatch" data-name="${c.name}" data-hex="${c.hex}" style="background:${c.hex}" title="${c.name}">
              ${c.hex === '#FFFFFF' ? '<span class="swatch-border"></span>' : ''}
            </button>
          `).join('')}
        </div>
        <div class="selected-color" id="selectedColor">
          <span class="color-dot" id="selectedDot" style="background:#000"></span>
          <span id="selectedName">Black</span>
          <input type="hidden" id="colorName" value="Black" />
          <input type="hidden" id="colorHex" value="#000000" />
        </div>
      </div>
      <div class="form-group">
        <label for="colorImage">Image</label>
        <div class="image-upload-area" id="imageUploadArea">
          <input type="file" id="colorImage" accept="image/*" class="file-input" />
          <div class="upload-placeholder" id="uploadPlaceholder">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="40" height="40">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
              <polyline points="17 8 12 3 7 8"/>
              <line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
            <span>Click or drag to upload</span>
            <span class="upload-hint">Auto-compressed to < 200KB</span>
          </div>
          <div class="upload-preview" id="uploadPreview" style="display:none">
            <img id="previewImg" src="" alt="" />
            <div class="compression-info" id="compressionInfo"></div>
          </div>
        </div>
      </div>
      <h3 class="form-section-title">Sizes & Quantities</h3>
      <div class="sizes-grid" id="sizesGrid">
        ${SIZES.map((s) => renderSizeStepper(s, 0)).join('')}
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" id="btnCancel">Cancel</button>
        <button type="submit" class="btn btn-primary" id="btnSubmit">Add Color</button>
      </div>
    </form>
  `;

  overlay.classList.add('active');
  modal.querySelector('#btnCloseModal').addEventListener('click', closeModal);
  modal.querySelector('#btnCancel').addEventListener('click', closeModal);

  // Color swatches
  modal.querySelectorAll('.swatch').forEach((sw) => {
    sw.addEventListener('click', () => {
      modal.querySelectorAll('.swatch').forEach((s) => s.classList.remove('active'));
      sw.classList.add('active');
      document.getElementById('colorName').value = sw.dataset.name;
      document.getElementById('colorHex').value = sw.dataset.hex;
      document.getElementById('selectedDot').style.background = sw.dataset.hex;
      document.getElementById('selectedName').textContent = sw.dataset.name;
    });
  });
  modal.querySelector('.swatch[data-name="Black"]')?.classList.add('active');

  setupImageUpload();
  setupSteppers(modal);

  modal.querySelector('#addColorForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = modal.querySelector('#btnSubmit');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Saving...';

    try {
      const colorName = document.getElementById('colorName').value;
      const colorHex = document.getElementById('colorHex').value;
      const imageFile = document.getElementById('colorImage').files[0] || null;
      const sizesMap = collectStepperValues(modal);

      const colorData = await addColorToDress(dressId, colorName, colorHex, imageFile);
      if (Object.keys(sizesMap).length > 0) {
        await bulkSetSizes(colorData.id, sizesMap);
        for (const [size, qty] of Object.entries(sizesMap)) {
        }
      }

      showToast('Color added!', 'success');
      closeModal();
      await loadDresses();
    } catch (err) {
      showToast('Error: ' + err.message, 'error');
      btn.disabled = false;
      btn.innerHTML = 'Add Color';
    }
  });
}

// ─── CONFIRM DELETE ─────────────────────────────────────────
function confirmDelete(dressId) {
  const modal = document.getElementById('dressModal');
  const overlay = document.getElementById('modalOverlay');

  modal.innerHTML = `
    <div class="sheet-handle"></div>
    <div class="confirm-dialog">
      <div class="confirm-icon">⚠️</div>
      <h2>Delete Dress?</h2>
      <p>Are you sure you want to delete dress <strong>${dressId}</strong>? This will remove all its colors, sizes, and images. This action cannot be undone.</p>
      <div class="form-actions">
        <button class="btn btn-ghost" id="btnCancelDelete">Cancel</button>
        <button class="btn btn-danger" id="btnConfirmDelete">Delete</button>
      </div>
    </div>
  `;

  overlay.classList.add('active');
  modal.querySelector('#btnCancelDelete').addEventListener('click', closeModal);
  modal.querySelector('#btnConfirmDelete').addEventListener('click', async () => {
    const btn = modal.querySelector('#btnConfirmDelete');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Deleting...';
    try {
      const dressToDelete = allDresses.find((d) => d.id === dressId);
      await deleteDress(dressId);
      for (const color of dressToDelete?.dress_colors || []) {
        for (const sizeEntry of color.dress_sizes || []) {
        }
      }
      logHistory('delete', 'Deleted dress', dressId);
      showToast('Dress deleted', 'success');
      closeModal();
      await loadDresses();
    } catch (err) {
      showToast('Error: ' + err.message, 'error');
      btn.disabled = false;
      btn.innerHTML = 'Delete';
    }
  });
}

// ─── TOAST NOTIFICATIONS ────────────────────────────────────
function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  const icon = type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ';
  toast.innerHTML = `<span class="toast-icon">${icon}</span><span>${message}</span>`;
  container.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// Export for detail view color add
window.__openAddColorModal = openAddColorModal;
