/**
 * Svelte action for Blender/Photoshop-style click-and-drag horizontal scrubbing on number fields/labels.
 *
 * Modifiers:
 * - Shift: Fine precision (0.2x speed)
 * - Ctrl / Meta: Fast coarse (3.0x speed)
 */

export interface ScrubbableOptions {
  value: () => number;
  min: number;
  max: number;
  step?: number;
  decimals?: number;
  sensitivity?: number;
  onchange: (value: number) => void;
  onstart?: () => void;
  onend?: (value: number) => void;
  disabled?: () => boolean;
}

export function scrubbable(node: HTMLElement, options: ScrubbableOptions) {
  let opts = options;

  function onMouseDown(e: MouseEvent) {
    if (e.button !== 0) return;
    if (opts.disabled?.()) return;

    // Allow clicks on nested interactive elements (like InfoTip or child buttons)
    const target = e.target as HTMLElement | null;
    const interactive = target?.closest("button, input, select, textarea, a");
    if (interactive && interactive !== node) return;

    const startX = e.clientX;
    const startVal = opts.value();
    let isDragging = false;
    let prevBodyCursor = "";
    let prevBodyUserSelect = "";

    function onMouseMove(moveEvent: MouseEvent) {
      const dx = moveEvent.clientX - startX;

      if (!isDragging) {
        if (Math.abs(dx) > 3) {
          isDragging = true;
          prevBodyCursor = document.body.style.cursor;
          prevBodyUserSelect = document.body.style.userSelect;
          document.body.style.cursor = "ew-resize";
          document.body.style.userSelect = "none";
          opts.onstart?.();
        } else {
          return;
        }
      }

      moveEvent.preventDefault();

      const speed = moveEvent.shiftKey ? 0.2 : moveEvent.ctrlKey || moveEvent.metaKey ? 3.0 : 1.0;
      const step = opts.step ?? 1;
      const sensitivity = opts.sensitivity ?? 3;
      const deltaSteps = (dx / sensitivity) * speed;

      let nextVal = startVal + deltaSteps * step;
      nextVal = Math.min(opts.max, Math.max(opts.min, nextVal));
      nextVal = Math.round(nextVal / step) * step;

      if (opts.decimals !== undefined && opts.decimals > 0) {
        nextVal = parseFloat(nextVal.toFixed(opts.decimals));
      } else {
        nextVal = Math.round(nextVal);
      }

      opts.onchange(nextVal);
    }

    function onMouseUp(upEvent: MouseEvent) {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);

      if (isDragging) {
        upEvent.preventDefault();
        upEvent.stopPropagation();
        document.body.style.cursor = prevBodyCursor;
        document.body.style.userSelect = prevBodyUserSelect;
        opts.onend?.(opts.value());
      }
    }

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }

  node.addEventListener("mousedown", onMouseDown);

  return {
    update(newOptions: ScrubbableOptions) {
      opts = newOptions;
    },
    destroy() {
      node.removeEventListener("mousedown", onMouseDown);
    },
  };
}
