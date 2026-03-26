import { createClient } from '@supabase/supabase-js';

// ============================================================
// ⚠️  REPLACE THESE WITH YOUR OWN SUPABASE PROJECT CREDENTIALS
// ============================================================
const SUPABASE_URL = 'https://vcursretyrfmkgigmwss.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_HSLXAaTslgID8pEdYcbgnQ_pClqgs3j';

// Lazy-initialized client (avoids crash when placeholders are set)
let _client = null;

export function getSupabase() {
  if (!_client) {
    if (!isConfigured()) {
      throw new Error('Supabase is not configured. Update src/supabase.js with your credentials.');
    }
    _client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return _client;
}

// Backward-compatible named export (getter-backed)
// Usage in other files: import { supabase } from './supabase.js'  ←  still works
// We use a proxy-like approach: export the getter as a property on an object
// But for simplicity, we'll just export getSupabase and update imports.

/**
 * Check if Supabase is configured
 */
export function isConfigured() {
  return SUPABASE_URL !== 'YOUR_SUPABASE_URL' && SUPABASE_ANON_KEY !== 'YOUR_SUPABASE_ANON_KEY';
}
