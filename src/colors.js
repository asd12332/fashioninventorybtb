// Pre-defined fashion colors for dress inventory
export const FASHION_COLORS = [
  { name: 'Black', hex: '#000000' },
  { name: 'Burgundy', hex: '#800020' },
  { name: 'Red', hex: '#DC2626' },
  { name: 'Navy Blue', hex: '#182d48ff' },
  { name: 'Royal Blue', hex: '#2563EB' },
  { name: 'Light Pink', hex: '#ff98fdff' },
  { name: 'Pink', hex: '#EC4899' },
  { name: 'Purple', hex: '#7C3AED' },
  { name: 'Turqoise', hex: '#0D9488' },
  { name: 'Green', hex: '#059629ff' },
  { name: 'Olive', hex: '#4d8000df' },
  { name: 'Gold', hex: '#D4AF37' },
  { name: 'Beige', hex: '#D4C5A9' },
  { name: 'Silver', hex: '#909090ce' },
  { name: 'White', hex: '#FFFFFF' },
];

// Sizes: 36, 38, 40, 42, 44, 46, 48, 50, 52, 54, 56
export const SIZES = Array.from({ length: 11 }, (_, i) => 36 + i * 2);
