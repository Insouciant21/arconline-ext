const MIN_FILL_PX = 32;
const MIN_FILL_RATIO_FLOOR = 0.08;
const MIN_FILL_RATIO_CEIL = 0.22;
const SCROLLABLE_EPSILON_PX = 1;

export interface ProgressMetricsInput {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  trackHeight: number;
}

export interface ProgressMetrics {
  maxScroll: number;
  scrollable: boolean;
  scrollFraction: number;
  minFillRatio: number;
  fillFraction: number;
}

export interface PointerOffsetInput {
  offsetY: number;
  trackHeight: number;
  maxScroll: number;
}

export interface BindGradientScrollbarOptions {
  target: "root" | HTMLElement;
  track: HTMLElement;
  fill: HTMLElement;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/**
 * Compute the resting top-edge fill ratio so scrollable containers always show
 * an initial ~32px gradient indicator at scrollTop === 0.
 */
export function computeMinFillRatio(trackHeight: number): number {
  if (!Number.isFinite(trackHeight) || trackHeight <= 0) {
    return MIN_FILL_RATIO_FLOOR;
  }
  return clamp(MIN_FILL_PX / trackHeight, MIN_FILL_RATIO_FLOOR, MIN_FILL_RATIO_CEIL);
}

/**
 * Compute normalized scroll progress and the resulting top-down fill fraction.
 */
export function computeProgressMetrics(input: ProgressMetricsInput): ProgressMetrics {
  const maxScroll = Math.max(0, input.scrollHeight - input.clientHeight);
  const scrollable = maxScroll > SCROLLABLE_EPSILON_PX;
  const scrollFraction = scrollable ? clamp(input.scrollTop / maxScroll, 0, 1) : 0;
  const minFillRatio = computeMinFillRatio(input.trackHeight);
  const fillFraction = scrollable ? minFillRatio + (1 - minFillRatio) * scrollFraction : 0;

  return {
    maxScroll,
    scrollable,
    scrollFraction,
    minFillRatio,
    fillFraction,
  };
}

/**
 * Map a pointer Y offset inside the track onto a target scrollTop such that
 * dragging from the resting fill tip to the bottom edge stays 1:1 with the cursor.
 */
export function pointerOffsetToScrollTop(input: PointerOffsetInput): number {
  if (
    !Number.isFinite(input.trackHeight) ||
    !Number.isFinite(input.maxScroll) ||
    input.trackHeight <= 0 ||
    input.maxScroll <= 0
  ) {
    return 0;
  }
  const minPx = computeMinFillRatio(input.trackHeight) * input.trackHeight;
  const usable = Math.max(1, input.trackHeight - minPx);
  const fraction = clamp((input.offsetY - minPx) / usable, 0, 1);
  return fraction * input.maxScroll;
}

function readScrollDimensions(target: "root" | HTMLElement) {
  if (target === "root") {
    const docEl = document.documentElement;
    const scrollHeight = Math.max(docEl.scrollHeight, document.body?.scrollHeight ?? 0);
    const clientHeight = docEl.clientHeight || window.innerHeight;
    const scrollTop = window.scrollY || docEl.scrollTop || 0;
    return { scrollTop, scrollHeight, clientHeight };
  }
  return {
    scrollTop: target.scrollTop,
    scrollHeight: target.scrollHeight,
    clientHeight: target.clientHeight,
  };
}

function readTrackHeight(track: HTMLElement): number {
  return track.getBoundingClientRect().height || track.clientHeight;
}

/**
 * Bind scroll, resize, mutation, and pointer-drag synchronization between a
 * native scroll container (or root viewport) and a custom gradient progress track.
 */
export function bindGradientScrollbar(options: BindGradientScrollbarOptions): () => void {
  const { target, track, fill } = options;
  let rafId: number | null = null;
  let activePointerId: number | null = null;

  const sync = () => {
    const { scrollTop, scrollHeight, clientHeight } = readScrollDimensions(target);
    const trackHeight = readTrackHeight(track);
    const metrics = computeProgressMetrics({ scrollTop, scrollHeight, clientHeight, trackHeight });

    track.dataset.visible = metrics.scrollable ? "true" : "false";
    fill.style.transform = `scaleY(${metrics.fillFraction.toFixed(4)})`;
  };

  const scheduleSync = () => {
    if (rafId !== null) return;
    rafId = window.requestAnimationFrame(() => {
      rafId = null;
      sync();
    });
  };

  const scrollToClientY = (clientY: number) => {
    const rect = track.getBoundingClientRect();
    const trackHeight = rect.height || track.clientHeight;
    const { scrollHeight, clientHeight } = readScrollDimensions(target);
    const maxScroll = Math.max(0, scrollHeight - clientHeight);
    if (maxScroll <= SCROLLABLE_EPSILON_PX) return;

    const nextTop = pointerOffsetToScrollTop({
      offsetY: clientY - rect.top,
      trackHeight,
      maxScroll,
    });

    if (target === "root") {
      window.scrollTo({ top: nextTop, behavior: "instant" as ScrollBehavior });
    } else {
      target.scrollTop = nextTop;
    }
    sync();
  };

  const endDrag = (event?: PointerEvent) => {
    if (activePointerId === null) return;
    if (event && event.pointerId !== activePointerId) return;

    const pointerId = activePointerId;
    activePointerId = null;
    try {
      if (track.hasPointerCapture?.(pointerId)) {
        track.releasePointerCapture?.(pointerId);
      }
    } catch {
      // Ignore already-released pointer captures.
    }
    delete track.dataset.dragging;
    delete document.documentElement.dataset.gradientScrollbarDragging;
  };

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || event.pointerType === "touch") return;
    const { scrollHeight, clientHeight } = readScrollDimensions(target);
    if (scrollHeight - clientHeight <= SCROLLABLE_EPSILON_PX) return;

    event.preventDefault();
    activePointerId = event.pointerId;
    try {
      track.setPointerCapture?.(event.pointerId);
    } catch {
      // Synthetic or uncapturable pointers still work via move/up listeners.
    }
    track.dataset.dragging = "true";
    document.documentElement.dataset.gradientScrollbarDragging = "true";
    scrollToClientY(event.clientY);
  };

  const onPointerMove = (event: PointerEvent) => {
    if (activePointerId === null || event.pointerId !== activePointerId) return;
    scrollToClientY(event.clientY);
  };

  track.addEventListener("pointerdown", onPointerDown);
  track.addEventListener("pointermove", onPointerMove);
  track.addEventListener("pointerup", endDrag);
  track.addEventListener("pointercancel", endDrag);
  track.addEventListener("lostpointercapture", endDrag);

  let resizeObserver: ResizeObserver | null = null;
  let mutationObserver: MutationObserver | null = null;

  if (target === "root") {
    window.addEventListener("scroll", scheduleSync, { passive: true });
    window.addEventListener("resize", scheduleSync, { passive: true });
    window.addEventListener("load", scheduleSync, { passive: true });
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(scheduleSync);
      resizeObserver.observe(document.documentElement);
      if (document.body) resizeObserver.observe(document.body);
      resizeObserver.observe(track);
    }
  } else {
    target.addEventListener("scroll", scheduleSync, { passive: true });
    window.addEventListener("resize", scheduleSync, { passive: true });
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(scheduleSync);
      resizeObserver.observe(target);
      resizeObserver.observe(track);
    }
    if (typeof MutationObserver !== "undefined") {
      mutationObserver = new MutationObserver(scheduleSync);
      mutationObserver.observe(target, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["class", "style", "hidden"],
      });
    }
  }

  sync();
  scheduleSync();

  return () => {
    if (rafId !== null) {
      window.cancelAnimationFrame(rafId);
      rafId = null;
    }
    endDrag();

    track.removeEventListener("pointerdown", onPointerDown);
    track.removeEventListener("pointermove", onPointerMove);
    track.removeEventListener("pointerup", endDrag);
    track.removeEventListener("pointercancel", endDrag);
    track.removeEventListener("lostpointercapture", endDrag);

    if (target === "root") {
      window.removeEventListener("scroll", scheduleSync);
      window.removeEventListener("resize", scheduleSync);
      window.removeEventListener("load", scheduleSync);
    } else {
      target.removeEventListener("scroll", scheduleSync);
      window.removeEventListener("resize", scheduleSync);
    }

    resizeObserver?.disconnect();
    mutationObserver?.disconnect();
  };
}

/**
 * Mount a single fixed right-edge gradient progress scrollbar for the page viewport.
 */
export function initRootGradientScrollbar(): () => void {
  if (typeof document === "undefined" || !document.body) return () => {};
  if (document.querySelector(".gradient-scrollbar-root")) return () => {};

  const track = document.createElement("div");
  track.className = "gradient-scrollbar gradient-scrollbar-root";
  track.dataset.visible = "false";
  track.setAttribute("aria-hidden", "true");

  const fill = document.createElement("div");
  fill.className = "gradient-scrollbar-fill";
  track.appendChild(fill);
  document.body.appendChild(track);

  const unbind = bindGradientScrollbar({ target: "root", track, fill });

  return () => {
    unbind();
    track.remove();
  };
}
