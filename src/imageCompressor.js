/**
 * Image Compressor — compresses images client-side using Canvas API + WebP
 * Target: < 200KB per image (from originals that can be 3-8MB)
 */

/**
 * Compress an image file to WebP with resizing
 * @param {File} file - The image file to compress
 * @param {number} maxWidth - Maximum width in pixels (default 800)
 * @param {number} maxHeight - Maximum height in pixels (default 800)
 * @param {number} quality - WebP quality 0-1 (default 0.65)
 * @returns {Promise<{blob: Blob, originalSize: number, compressedSize: number, savings: string, dataUrl: string}>}
 */
export async function compressImage(file, maxWidth = 800, maxHeight = 800, quality = 0.65) {
  return new Promise((resolve, reject) => {
    const originalSize = file.size;
    const reader = new FileReader();

    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        // Calculate new dimensions maintaining aspect ratio
        let { width, height } = img;
        if (width > maxWidth || height > maxHeight) {
          const ratio = Math.min(maxWidth / width, maxHeight / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }

        // Draw to canvas
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');

        // Use high-quality rendering
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, width, height);

        // Try WebP first, fallback to JPEG
        let mimeType = 'image/webp';
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              // WebP not supported, try JPEG
              mimeType = 'image/jpeg';
              canvas.toBlob(
                (jpegBlob) => {
                  if (!jpegBlob) {
                    reject(new Error('Failed to compress image'));
                    return;
                  }
                  finalize(jpegBlob);
                },
                'image/jpeg',
                quality
              );
              return;
            }
            finalize(blob);
          },
          mimeType,
          quality
        );

        function finalize(blob) {
          const compressedSize = blob.size;
          const savingsPercent = ((1 - compressedSize / originalSize) * 100).toFixed(1);
          const dataUrl = canvas.toDataURL(mimeType, quality);

          resolve({
            blob,
            mimeType,
            originalSize,
            compressedSize,
            savings: `${savingsPercent}%`,
            dataUrl,
            width,
            height,
          });
        }
      };

      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = e.target.result;
    };

    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

/**
 * Format bytes to human-readable string
 */
export function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}
