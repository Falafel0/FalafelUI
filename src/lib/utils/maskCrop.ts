/**
 * Mask crop utilities — ported from Forge's modules/masking.py.
 * getCropRegionV2: find bounding box of non-transparent pixels.
 * expandCropRegion: expand bbox to match target aspect ratio.
 */

export interface CropRegion {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** Compute the bounding box of all non-transparent pixels in the mask canvas.
 *  Returns null if the mask is empty (no visible pixels). */
export function getCropRegionV2(
  maskCtx: CanvasRenderingContext2D,
  pad: number = 0
): CropRegion | null {
  const w = maskCtx.canvas.width;
  const h = maskCtx.canvas.height;
  const data = maskCtx.getImageData(0, 0, w, h).data;

  let x1 = w;
  let y1 = h;
  let x2 = 0;
  let y2 = 0;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const alpha = data[(y * w + x) * 4 + 3];
      if (alpha > 0) {
        if (x < x1) x1 = x;
        if (y < y1) y1 = y;
        if (x > x2) x2 = x;
        if (y > y2) y2 = y;
      }
    }
  }

  if (x1 > x2 || y1 > y2) return null; // empty mask

  // Apply padding
  x1 = Math.max(0, x1 - pad);
  y1 = Math.max(0, y1 - pad);
  x2 = Math.min(w, x2 + pad);
  y2 = Math.min(h, y2 + pad);

  return { x1, y1, x2, y2 };
}

/**
 * Expand a crop region so its aspect ratio matches the target processing dimensions.
 * This ensures the crop, when upscaled, exactly fills the generation resolution
 * without distortion. Ported from Forge's masking.expand_crop_region.
 */
export function expandCropRegion(
  crop: CropRegion,
  processingWidth: number,
  processingHeight: number,
  imageWidth: number,
  imageHeight: number
): CropRegion {
  let { x1, y1, x2, y2 } = crop;
  const cropW = x2 - x1;
  const cropH = y2 - y1;

  if (cropW <= 0 || cropH <= 0) return crop;

  const ratioCrop = cropW / cropH;
  const ratioProcessing = processingWidth / processingHeight;

  if (ratioCrop > ratioProcessing) {
    // Crop is too wide — increase height
    const desiredH = cropW / ratioProcessing;
    const diff = Math.floor(desiredH - cropH);
    y1 -= Math.floor(diff / 2);
    y2 += diff - Math.floor(diff / 2);

    // Clamp to image bounds, bias toward top
    if (y2 > imageHeight) {
      const overflow = y2 - imageHeight;
      y2 = imageHeight;
      y1 = Math.max(0, y1 - overflow);
    }
    if (y1 < 0) {
      const overflow = -y1;
      y1 = 0;
      y2 = Math.min(imageHeight, y2 + overflow);
    }
  } else {
    // Crop is too tall — increase width
    const desiredW = cropH * ratioProcessing;
    const diff = Math.floor(desiredW - cropW);
    x1 -= Math.floor(diff / 2);
    x2 += diff - Math.floor(diff / 2);

    // Clamp to image bounds, bias toward left
    if (x2 > imageWidth) {
      const overflow = x2 - imageWidth;
      x2 = imageWidth;
      x1 = Math.max(0, x1 - overflow);
    }
    if (x1 < 0) {
      const overflow = -x1;
      x1 = 0;
      x2 = Math.min(imageWidth, x2 + overflow);
    }
  }

  // Ensure 8-pixel alignment for latent dimensions
  let finalW = Math.max(64, Math.round((x2 - x1) / 8) * 8);
  let finalH = Math.max(64, Math.round((y2 - y1) / 8) * 8);

  // If final dimensions exceed image bounds, clamp them to image bounds aligned to 8
  if (finalW > imageWidth) {
    finalW = Math.max(8, Math.floor(imageWidth / 8) * 8);
  }
  if (finalH > imageHeight) {
    finalH = Math.max(8, Math.floor(imageHeight / 8) * 8);
  }

  x2 = x1 + finalW;
  y2 = y1 + finalH;

  // Shift-back boundary clamping to preserve finalW and finalH
  if (x2 > imageWidth) {
    const overflow = x2 - imageWidth;
    x1 -= overflow;
    x2 = imageWidth;
  }
  if (x1 < 0) {
    const underflow = -x1;
    x1 = 0;
    x2 = Math.min(imageWidth, x2 + underflow);
  }

  if (y2 > imageHeight) {
    const overflow = y2 - imageHeight;
    y1 -= overflow;
    y2 = imageHeight;
  }
  if (y1 < 0) {
    const underflow = -y1;
    y1 = 0;
    y2 = Math.min(imageHeight, y2 + underflow);
  }

  return { x1, y1, x2, y2 };
}

/**
 * Crop a source canvas to the given region and return a new canvas.
 */
export function cropCanvas(
  src: HTMLCanvasElement,
  region: CropRegion
): HTMLCanvasElement {
  const w = region.x2 - region.x1;
  const h = region.y2 - region.y1;
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const ctx = out.getContext("2d")!;
  ctx.drawImage(src, region.x1, region.y1, w, h, 0, 0, w, h);
  return out;
}
