/**
 * Mask blur utility — ported from Forge's mask_blur processing.
 * Applies Gaussian blur to a canvas, matching Forge's kernel formula:
 *   kernelSize = 2 * floor(2.5 * blur + 0.5) + 1
 */

/**
 * Apply Gaussian blur to a canvas. Mutates the canvas in place.
 * @param blur Radius in pixels (0-64, default 4). 0 = no blur.
 */
export function gaussianBlurCanvas(
  canvas: HTMLCanvasElement,
  blur: number
): void {
  if (blur <= 0) return;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  // Use CSS filter for efficient GPU-accelerated blur.
  // Convert Forge radius to approximate CSS blur px:
  // Forge kernel = 2*floor(2.5*blur+0.5)+1, CSS filter blur ≈ kernel / 3
  const kernelSize = 2 * Math.floor(2.5 * blur + 0.5) + 1;
  const cssBlur = Math.max(1, Math.round(kernelSize / 3));

  // Draw to temp canvas first — self-draw with "copy" avoids
  // sharp original pixels showing through the blurred result.
  const temp = document.createElement("canvas");
  temp.width = canvas.width;
  temp.height = canvas.height;
  const tempCtx = temp.getContext("2d");
  if (!tempCtx) return;

  tempCtx.filter = `blur(${cssBlur}px)`;
  tempCtx.drawImage(canvas, 0, 0);

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(temp, 0, 0);
}

/**
 * Create a blurred copy of a canvas. Original is not modified.
 */
export function blurredClone(
  src: HTMLCanvasElement,
  blur: number
): HTMLCanvasElement {
  const clone = document.createElement("canvas");
  clone.width = src.width;
  clone.height = src.height;
  const ctx = clone.getContext("2d");
  if (ctx) {
    ctx.drawImage(src, 0, 0);
  }
  gaussianBlurCanvas(clone, blur);
  return clone;
}
