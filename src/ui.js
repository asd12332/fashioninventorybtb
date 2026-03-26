import { FASHION_COLORS, SIZES } from './colors.js';
import { isConfigured } from './supabase.js';
import { compressImage, formatBytes } from './imageCompressor.js';
import {
  addDress, updateDress, deleteDress, getDresses,
  addColorToDress, updateColorImage, deleteColor,
  bulkSetSizes, computeStats, searchDresses,
} from './inventory.js';

// ─── STATE ──────────────────────────────────────────────────
let allDresses = [];
let currentView = 'grid'; // 'grid' | 'detail'
let currentDressId = null;
let searchTimeout = null;
let addModeColors = []; // tracks color entries when adding a new dress
let addColorCounter = 0; // unique ID for each color entry in add mode

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
    <header class="app-header">
      <div class="header-left">
        <h1 class="logo">
          <span class="logo-icon">👗</span>
          <span>Dress Inventory</span>
        </h1>
      </div>
      <div class="header-center">
        <div class="search-box">
          <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
          </svg>
          <input type="text" id="searchInput" placeholder="Search by ID or name..." autocomplete="off" />
        </div>
      </div>
      <div class="header-right">
        <button id="btnAdd" class="btn btn-primary">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="18" height="18">
            <path d="M12 5v14M5 12h14"/>
          </svg>
          <span>Add Dress</span>
        </button>
      </div>
    </header>

    <div class="stats-bar" id="statsBar"></div>

    <main class="main-content">
      <div class="dress-grid" id="dressGrid"></div>
    </main>

    <!-- Add/Edit Dress Modal -->
    <div class="modal-overlay" id="modalOverlay">
      <div class="modal" id="dressModal"></div>
    </div>

    <!-- Detail View Modal -->
    <div class="modal-overlay" id="detailOverlay">
      <div class="modal modal-detail" id="detailModal"></div>
    </div>

    <!-- Toast -->
    <div class="toast-container" id="toastContainer"></div>
  `;

  // Event listeners
  document.getElementById('btnAdd').addEventListener('click', () => openAddModal());
  document.getElementById('searchInput').addEventListener('input', handleSearch);
  document.getElementById('modalOverlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeModal();
  });
  document.getElementById('detailOverlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeDetail();
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

  if (allDresses.length === 0) {
    grid.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">👗</div>
        <h2>No dresses yet</h2>
        <p>Click "Add Dress" to start tracking your inventory</p>
      </div>
    `;
    return;
  }

  grid.innerHTML = allDresses.map((dress) => {
    const firstColor = dress.dress_colors?.[0];
    const totalPieces = (dress.dress_colors || []).reduce((sum, c) =>
      sum + (c.dress_sizes || []).reduce((s, sz) => s + (sz.quantity || 0), 0), 0
    );
    const colorCount = dress.dress_colors?.length || 0;

    return `
      <div class="dress-card" data-id="${dress.id}">
        <div class="card-image" style="${firstColor?.image_url ? `background-image:url(${firstColor.image_url})` : ''}">
          ${!firstColor?.image_url ? '<div class="no-image">👗</div>' : ''}
          <div class="card-badge">${dress.id}</div>
        </div>
        <div class="card-body">
          <h3 class="card-title">${dress.id}</h3>
          <div class="card-price">${dress.price ? '$' + Number(dress.price).toFixed(0) : ''}</div>
          <div class="card-meta">
            <div class="meta-colors-breakdown">
              ${(dress.dress_colors || []).map(c => {
                const colorPieces = (c.dress_sizes || []).reduce((s, sz) => s + (sz.quantity || 0), 0);
                return `<span class="color-pieces-chip" title="${c.color_name}: ${colorPieces} piece${colorPieces !== 1 ? 's' : ''}">
                  <span class="color-dot" style="background:${c.color_hex}"></span>
                  <span class="color-pieces-count">${colorPieces}</span>
                </span>`;
              }).join('')}
              ${colorCount === 0 ? '<span class="meta-count">No colors</span>' : ''}
            </div>
          </div>
          <div class="card-footer">
            <span class="pieces-badge">${totalPieces} piece${totalPieces !== 1 ? 's' : ''}</span>
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
                <span class="edit-color-name">${color.color_name}</span>
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
          await deleteColor(colorId);
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
          }
        }

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
          }
        }

        const colorCount = colorBlocks.length;
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
      await deleteDress(dressId);
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
