/**
 * Mask fill utility — ported from Forge's masking.fill().
 *
 * Forge approach:
 * 1. Create image_masked — original image with alpha=0 inside the masked area,
 *    opaque outside (so colours can "bleed" into transparent areas when blurred).
 * 2. Iteratively Gaussian-blur image_masked and alpha-composite onto an
 *    accumulator canvas with decreasing radii.
 *
 * Used when inpainting_fill === 0 ("fill" mode).
 */

/**
 * Fill the masked region with surrounding colours using iterative
 * blur compositing (Forge algorithm).
 *
 * @param imageCanvas  Source image (RGB or RGBA).
 * @param maskCanvas   Mask at same resolution — non-transparent pixels define
 *                     the region to fill (white = inpaint area).
 * @returns Filled image as a new canvas.
 */
export function fillMaskedRegion(
  imageCanvas: HTMLCanvasElement,
  maskCanvas: HTMLCanvasElement
): HTMLCanvasElement {
  const w = imageCanvas.width;
  const h = imageCanvas.height;

  // 1. Build image_masked: copy of source, but transparent inside the mask.
  const imageMasked = document.createElement("canvas");
  imageMasked.width = w;
  imageMasked.height = h;
  const imCtx = imageMasked.getContext("2d");
  if (!imCtx) return imageCanvas;

  imCtx.drawImage(imageCanvas, 0, 0);

  const maskCtx = maskCanvas.getContext("2d");
  if (!maskCtx) return imageCanvas;

  const maskData = maskCtx.getImageData(0, 0, w, h);
  const imData = imCtx.getImageData(0, 0, w, h);
  const imPx = imData.data;
  const mkPx = maskData.data;

  for (let i = 0; i < imPx.length; i += 4) {
    // Where mask alpha > 0 → inpaint region → make image transparent
    if (mkPx[i + 3] > 0) {
      imPx[i + 3] = 0;
    }
  }
  imCtx.putImageData(imData, 0, 0);

  // 2. Accumulator — starts transparent.
  const acc = document.createElement("canvas");
  acc.width = w;
  acc.height = h;
  const accCtx = acc.getContext("2d");
  if (!accCtx) return imageCanvas;

  // Blur passes (Forge's radii and repeat counts).
  const passes: Array<{ radius: number; repeats: number }> = [
    { radius: 256, repeats: 1 },
    { radius: 64, repeats: 1 },
    { radius: 16, repeats: 2 },
    { radius: 4, repeats: 4 },
    { radius: 2, repeats: 2 },
    { radius: 0, repeats: 1 },
  ];

  for (const pass of passes) {
    // Blur image_masked once per pass.
    const blurred = document.createElement("canvas");
    blurred.width = w;
    blurred.height = h;
    const bCtx = blurred.getContext("2d");
    if (!bCtx) continue;

    if (pass.radius > 0) {
      bCtx.filter = `blur(${pass.radius}px)`;
    }
    bCtx.drawImage(imageMasked, 0, 0);
    bCtx.filter = "none";

    for (let r = 0; r < pass.repeats; r++) {
      // Canvas "source-over" = Porter-Duff source-over = PIL alpha_composite.
      accCtx.globalCompositeOperation = "source-over";
      accCtx.drawImage(blurred, 0, 0);
    }
  }

  return acc;
}

/**
 * Check if an RGBA canvas has any non-transparent pixels.
 */
export function hasVisiblePixels(canvas: HTMLCanvasElement): boolean {
  const ctx = canvas.getContext("2d");
  if (!ctx) return false;
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] > 0) return true;
  }
  return false;
}
