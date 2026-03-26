-- ============================================
-- Dress Inventory Tracker — Supabase SQL Setup
-- ============================================
-- Run this SQL in your Supabase SQL Editor:
-- Dashboard → SQL Editor → New Query → Paste & Run

-- 1. DRESSES TABLE
CREATE TABLE IF NOT EXISTS dresses (
  id TEXT PRIMARY KEY,
  name TEXT DEFAULT '',
  price NUMERIC DEFAULT 0,
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. DRESS COLORS TABLE
CREATE TABLE IF NOT EXISTS dress_colors (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  dress_id TEXT NOT NULL REFERENCES dresses(id) ON DELETE CASCADE,
  color_name TEXT NOT NULL,
  color_hex TEXT NOT NULL,
  image_url TEXT,
  image_path TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. DRESS SIZES TABLE
CREATE TABLE IF NOT EXISTS dress_sizes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  dress_color_id UUID NOT NULL REFERENCES dress_colors(id) ON DELETE CASCADE,
  size INTEGER NOT NULL CHECK (size >= 36 AND size <= 56),
  quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  UNIQUE(dress_color_id, size)
);

-- 4. INDEXES for fast lookups
CREATE INDEX IF NOT EXISTS idx_dress_colors_dress_id ON dress_colors(dress_id);
CREATE INDEX IF NOT EXISTS idx_dress_sizes_color_id ON dress_sizes(dress_color_id);

-- 5. ROW LEVEL SECURITY (allow all for anon key — single-user app)
ALTER TABLE dresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE dress_colors ENABLE ROW LEVEL SECURITY;
ALTER TABLE dress_sizes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all on dresses" ON dresses FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on dress_colors" ON dress_colors FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on dress_sizes" ON dress_sizes FOR ALL USING (true) WITH CHECK (true);

-- 6. STORAGE BUCKET
-- Go to Storage in dashboard and create a bucket called "dress-images"
-- Set it to PUBLIC so images can be viewed via URL
-- Or run this (if using the SQL approach):
INSERT INTO storage.buckets (id, name, public) VALUES ('dress-images', 'dress-images', true)
ON CONFLICT (id) DO NOTHING;

-- Allow public read + authenticated upload
CREATE POLICY "Public read dress-images" ON storage.objects FOR SELECT USING (bucket_id = 'dress-images');
CREATE POLICY "Allow upload dress-images" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'dress-images');
CREATE POLICY "Allow update dress-images" ON storage.objects FOR UPDATE USING (bucket_id = 'dress-images');
CREATE POLICY "Allow delete dress-images" ON storage.objects FOR DELETE USING (bucket_id = 'dress-images');
