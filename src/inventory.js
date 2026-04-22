import { getSupabase } from './supabase.js';
import { compressImage } from './imageCompressor.js';

const BUCKET = 'dress-images';

// Helper to get the Supabase client (lazy init)
const db = () => getSupabase();

// ─── DRESSES ────────────────────────────────────────────────

export async function addDress(id, price = 0, notes = '') {
  const { data, error } = await db()
    .from('dresses')
    .insert({ id, price, notes })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateDress(id, updates) {
  const { data, error } = await db()
    .from('dresses')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteDress(id) {
  // First delete all color images from storage
  const { data: colors } = await db()
    .from('dress_colors')
    .select('id, image_path')
    .eq('dress_id', id);

  if (colors?.length) {
    const paths = colors.map((c) => c.image_path).filter(Boolean);
    if (paths.length) {
      await db().storage.from(BUCKET).remove(paths);
    }
    // Delete sizes for all colors
    const colorIds = colors.map((c) => c.id);
    await db().from('dress_sizes').delete().in('dress_color_id', colorIds);
    // Delete colors
    await db().from('dress_colors').delete().eq('dress_id', id);
  }

  const { error } = await db().from('dresses').delete().eq('id', id);
  if (error) throw error;
}

export async function getDresses() {
  const { data, error } = await db()
    .from('dresses')
    .select(`
      *,
      dress_colors (
        id, color_name, color_hex, image_url, image_path,
        dress_sizes ( id, size, quantity )
      )
    `)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function getDressById(id) {
  const { data, error } = await db()
    .from('dresses')
    .select(`
      *,
      dress_colors (
        id, color_name, color_hex, image_url, image_path,
        dress_sizes ( id, size, quantity )
      )
    `)
    .eq('id', id)
    .single();
  if (error) throw error;
  return data;
}

export async function searchDresses(query) {
  const q = `%${query}%`;
  const { data, error } = await db()
    .from('dresses')
    .select(`
      *,
      dress_colors (
        id, color_name, color_hex, image_url, image_path,
        dress_sizes ( id, size, quantity )
      )
    `)
    .or(`id.ilike.${q},name.ilike.${q}`)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

// ─── COLORS ─────────────────────────────────────────────────

export async function addColorToDress(dressId, colorName, colorHex, imageFile) {
  let imageUrl = null;
  let imagePath = null;

  if (imageFile) {
    const compressed = await compressImage(imageFile);
    const ext = compressed.mimeType === 'image/webp' ? 'webp' : 'jpg';
    imagePath = `${dressId}/${colorName.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}.${ext}`;

    const { error: uploadErr } = await db().storage
      .from(BUCKET)
      .upload(imagePath, compressed.blob, {
        contentType: compressed.mimeType,
        cacheControl: '31536000',
      });
    if (uploadErr) throw uploadErr;

    const { data: urlData } = db().storage.from(BUCKET).getPublicUrl(imagePath);
    imageUrl = urlData.publicUrl;
  }

  const { data, error } = await db()
    .from('dress_colors')
    .insert({ dress_id: dressId, color_name: colorName, color_hex: colorHex, image_url: imageUrl, image_path: imagePath })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateColorImage(colorId, dressId, colorName, imageFile) {
  // Get old image path for cleanup
  const { data: existing } = await db()
    .from('dress_colors')
    .select('image_path')
    .eq('id', colorId)
    .single();

  if (existing?.image_path) {
    await db().storage.from(BUCKET).remove([existing.image_path]);
  }

  const compressed = await compressImage(imageFile);
  const ext = compressed.mimeType === 'image/webp' ? 'webp' : 'jpg';
  const imagePath = `${dressId}/${colorName.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}.${ext}`;

  const { error: uploadErr } = await db().storage
    .from(BUCKET)
    .upload(imagePath, compressed.blob, {
      contentType: compressed.mimeType,
      cacheControl: '31536000',
    });
  if (uploadErr) throw uploadErr;

  const { data: urlData } = db().storage.from(BUCKET).getPublicUrl(imagePath);

  const { data, error } = await db()
    .from('dress_colors')
    .update({ image_url: urlData.publicUrl, image_path: imagePath })
    .eq('id', colorId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteColor(colorId) {
  const { data: color } = await db()
    .from('dress_colors')
    .select('image_path')
    .eq('id', colorId)
    .single();

  if (color?.image_path) {
    await db().storage.from(BUCKET).remove([color.image_path]);
  }

  await db().from('dress_sizes').delete().eq('dress_color_id', colorId);
  const { error } = await db().from('dress_colors').delete().eq('id', colorId);
  if (error) throw error;
}

// ─── SIZES ──────────────────────────────────────────────────

export async function setSizeQuantity(dressColorId, size, quantity) {
  // Upsert: insert or update
  const { data: existing } = await db()
    .from('dress_sizes')
    .select('id')
    .eq('dress_color_id', dressColorId)
    .eq('size', size)
    .maybeSingle();

  if (existing) {
    const { data, error } = await db()
      .from('dress_sizes')
      .update({ quantity })
      .eq('id', existing.id)
      .select()
      .single();
    if (error) throw error;
    return data;
  } else {
    const { data, error } = await db()
      .from('dress_sizes')
      .insert({ dress_color_id: dressColorId, size, quantity })
      .select()
      .single();
    if (error) throw error;
    return data;
  }
}

export async function bulkSetSizes(dressColorId, sizesMap) {
  // sizesMap: { 36: 2, 38: 5, 40: 1, ... }
  const promises = Object.entries(sizesMap).map(([size, qty]) =>
    setSizeQuantity(dressColorId, parseInt(size), parseInt(qty))
  );
  return Promise.all(promises);
}

export async function resetDressQuantities(dressId) {
  const { data: colors } = await db()
    .from('dress_colors')
    .select('id')
    .eq('dress_id', dressId);
  if (!colors?.length) return [];
  const colorIds = colors.map((c) => c.id);
  const { data: sizes } = await db()
    .from('dress_sizes')
    .select('id, dress_color_id, size, quantity')
    .in('dress_color_id', colorIds);
  if (sizes?.length) {
    await db().from('dress_sizes').update({ quantity: 0 }).in('dress_color_id', colorIds);
  }
  return sizes || [];
}

// ─── STATS ──────────────────────────────────────────────────

export function computeStats(dresses) {
  let totalDresses = dresses.length;
  let totalColors = 0;
  let totalPieces = 0;
  const sizeBreakdown = {};

  for (const dress of dresses) {
    for (const color of dress.dress_colors || []) {
      totalColors++;
      for (const sizeEntry of color.dress_sizes || []) {
        const qty = sizeEntry.quantity || 0;
        totalPieces += qty;
        sizeBreakdown[sizeEntry.size] = (sizeBreakdown[sizeEntry.size] || 0) + qty;
      }
    }
  }

  return { totalDresses, totalColors, totalPieces, sizeBreakdown };
}
