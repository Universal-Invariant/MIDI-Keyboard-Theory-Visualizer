/**
 * KeyboardPanel — wraps the keyboard in a dedicated panel whose *height* the
 * user controls by dragging the resize bar at its bottom edge.
 *
 * Why not just scale with the window? The piano's usability depends on key
 * height (touch target + how readable the highlights are), so it gets its own
 * persisted pixel height instead of being tied to browser-window size.
 *
 * Mechanics:
 *  - The panel body (`#keyboard-scroll`) has an explicit `--kb-height` and
 *    scrolls horizontally when the keys need more width than the viewport.
 *  - Strips inside the panel use `flex-grow` proportional to their natural
 *    height, so resizing the panel grows/shrinks every row evenly (a taller
 *    panel = taller keys, not extra empty space).
 *  - The chosen height is stored via the supplied persist callback so it
 *    survives reloads.
 */

export interface KeyboardPanelDeps {
  panel: HTMLElement;        // #keyboard-panel (outer card)
  scrollEl: HTMLElement;     // #keyboard-scroll (clipped/scrolling area)
  handle: HTMLElement;       // drag bar at the bottom of the panel
  minPx?: number;
  maxPx?: number;
  defaultPx?: number;
  loadHeight: () => number | null;
  saveHeight: (px: number) => void;
}

const DEFAULT_MIN = 90;
const DEFAULT_MAX = 720;

export class KeyboardPanel {
  private deps: KeyboardPanelDeps;
  private minPx: number;
  private maxPx: number;
  private height: number;
  private dragging = false;
  private startY = 0;
  private startH = 0;

  constructor(deps: KeyboardPanelDeps) {
    this.deps = deps;
    this.minPx = deps.minPx ?? DEFAULT_MIN;
    this.maxPx = deps.maxPx ?? DEFAULT_MAX;
    const stored = deps.loadHeight();
    this.height = clamp(stored ?? (deps.defaultPx ?? 180), this.minPx, this.maxPx);

    this.applyHeight();
    // Let keyboard rows fill the panel height instead of using fixed CSS px.
    this.observeStrips();

    deps.handle.addEventListener('pointerdown', (e) => this.beginDrag(e));
    window.addEventListener('pointermove', (e) => this.moveDrag(e));
    window.addEventListener('pointerup', () => this.endDrag());
    window.addEventListener('pointercancel', () => this.endDrag());
    // Double-click the bar to restore the default height.
    deps.handle.addEventListener('dblclick', () => {
      this.setHeight(deps.defaultPx ?? 180, true);
    });
  }

  get currentHeight(): number { return this.height; }

  /** Programmatic resize (also used by tests / future settings UI). */
  setHeight(px: number, persist = true): void {
    this.setHeightInternal(px, persist);
  }

  private setHeightInternal(px: number, persist: boolean): void {
    const next = clamp(Math.round(px), this.minPx, this.maxPx);
    if (next === this.height) return;
    this.height = next;
    this.applyHeight();
    if (persist) this.deps.saveHeight(this.height);
  }

  private applyHeight(): void {
    this.deps.panel.style.setProperty('--kb-height', `${this.height}px`);
    this.deps.handle.setAttribute('aria-valuenow', String(this.height));
  }

  /** Keep flex-grow in sync with each strip's natural height as rows rebuild. */
  private observeStrips(): void {
    const apply = () => {
      for (const strip of this.deps.scrollEl.querySelectorAll<HTMLElement>('.kb')) {
        const natural = strip.offsetHeight || strip.getBoundingClientRect().height;
        strip.style.flexGrow = String(Math.max(1, Math.round(natural)));
      }
    };
    apply();
    const mo = new MutationObserver(() => requestAnimationFrame(apply));
    mo.observe(this.deps.scrollEl, { childList: true, subtree: false });
    // Height changes alone don't retrigger childList; also refresh on resize.
    window.addEventListener('resize', () => requestAnimationFrame(apply));
  }

  private beginDrag(e: PointerEvent): void {
    this.dragging = true;
    this.startY = e.clientY;
    this.startH = this.height;
    this.deps.handle.classList.add('dragging');
    this.deps.panel.classList.add('resizing');
    this.deps.handle.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  }

  private moveDrag(e: PointerEvent): void {
    if (!this.dragging) return;
    const dy = e.clientY - this.startY;
    this.setHeightInternal(this.startH + dy, false);
  }

  private endDrag(): void {
    if (!this.dragging) return;
    this.dragging = false;
    this.deps.handle.classList.remove('dragging');
    this.deps.panel.classList.remove('resizing');
    this.deps.saveHeight(this.height);
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
