import { useCallback, useEffect, useRef, useState, type MouseEvent, type PointerEvent, type RefObject } from "react";
import type { PreviewImage } from "./AttachmentPreview";

export function nextImageIndex(index: number, step: -1 | 1, count: number): number {
  if (count <= 0) return 0;
  return Math.max(0, Math.min(count - 1, index + step));
}

export type PreviewKeyAction = "close" | "previous" | "next" | null;

export function previewKeyAction(key: string, count: number): PreviewKeyAction {
  if (key === "Escape") return "close";
  if (count > 1 && key === "ArrowLeft") return "previous";
  if (count > 1 && key === "ArrowRight") return "next";
  return null;
}

const transcriptImages = new WeakMap<Element, PreviewImage[]>();

export function registerPreviewThumbnail(element: HTMLElement | null, images: PreviewImage[]) {
  if (element) transcriptImages.set(element, images);
}

export function conversationImages(trigger: HTMLElement, localImages: PreviewImage[]): PreviewImage[] {
  const transcript = trigger.closest('[role="log"]');
  if (!transcript) return localImages;
  const groups = new Set<PreviewImage[]>();
  const images = new Map<string, PreviewImage>();
  for (const thumbnail of transcript.querySelectorAll("[data-preview-thumbnail]")) {
    if (thumbnail.closest('[role="log"]') !== transcript) continue;
    const group = transcriptImages.get(thumbnail);
    if (!group || groups.has(group)) continue;
    groups.add(group);
    for (const image of group) {
      if (!images.has(image.src)) images.set(image.src, image);
    }
  }
  return [...images.values()];
}

type Point = { x: number; y: number };
type Zoom = Point & { scale: number };
const FIT: Zoom = { x: 0, y: 0, scale: 1 };
const TAP_DELAY_MS = 280;
const WHEEL_IDLE_MS = 120;
const SWIPE_SLOP = 10;
const SWIPE_THRESHOLD = 48;

type SafariPinchEvent = globalThis.MouseEvent & { scale: number };

function pinchBetween([first, second]: Point[]) {
  return {
    x: (first.x + second.x) / 2,
    y: (first.y + second.y) / 2,
    distance: Math.hypot(second.x - first.x, second.y - first.y),
  };
}

function boundedZoom(view: HTMLDivElement, zoom: Zoom): Zoom {
  const image = view.querySelector<HTMLImageElement>("[data-preview-active-image]");
  const limitX = Math.max(0, ((image?.offsetWidth || view.clientWidth) * zoom.scale - view.clientWidth) / 2);
  const limitY = Math.max(0, ((image?.offsetHeight || view.clientHeight) * zoom.scale - view.clientHeight) / 2);
  return {
    scale: zoom.scale,
    x: Math.max(-limitX, Math.min(limitX, zoom.x)),
    y: Math.max(-limitY, Math.min(limitY, zoom.y)),
  };
}

function zoomAt(view: HTMLDivElement, base: Zoom, from: Point, to: Point, scale: number): Zoom {
  const bounds = view.getBoundingClientRect();
  const centerX = bounds.left + bounds.width / 2;
  const centerY = bounds.top + bounds.height / 2;
  return boundedZoom(view, {
    scale,
    x: to.x - centerX - (from.x - centerX - base.x) * scale / base.scale,
    y: to.y - centerY - (from.y - centerY - base.y) * scale / base.scale,
  });
}

export function usePreviewGestures(
  dialogRef: RefObject<HTMLDivElement | null>,
  index: number,
  count: number,
  navigate: (step: -1 | 1) => void,
  dismiss: () => void,
  cancelPress: () => void,
) {
  const points = useRef(new Map<number, Point>());
  const start = useRef<Point | null>(null);
  const mode = useRef<"horizontal" | "vertical" | "pan" | "pinch" | null>(null);
  const origin = useRef(FIT);
  const pinch = useRef<ReturnType<typeof pinchBetween> | null>(null);
  const ignoreClick = useRef(false);
  const tap = useRef<ReturnType<typeof setTimeout> | null>(null);
  const zoomRef = useRef(FIT);
  const [zoom, setZoom] = useState(FIT);
  const [animateZoom, setAnimateZoom] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);
  const setDrag = useCallback((offset: Point | null) => {
    const track = trackRef.current;
    if (!track) return;
    track.toggleAttribute("data-preview-dragging", offset !== null);
    if (offset) {
      track.style.setProperty("--preview-drag-x", `${offset.x}px`);
      track.style.setProperty("--preview-drag-y", `${offset.y}px`);
    } else {
      track.style.removeProperty("--preview-drag-x");
      track.style.removeProperty("--preview-drag-y");
    }
  }, []);
  const slide = useCallback((dx: number) => {
    const atEdge = dx > 0 ? index === 0 : index === count - 1;
    setDrag({ x: atEdge ? dx * 0.2 : dx, y: 0 });
  }, [count, index, setDrag]);
  const updateZoom = useCallback((next: Zoom, animate = false) => {
    zoomRef.current = next;
    setZoom(next);
    setAnimateZoom(animate);
  }, []);
  const clearTap = useCallback(() => {
    if (tap.current !== null) clearTimeout(tap.current);
    tap.current = null;
  }, []);

  useEffect(() => clearTap, [clearTap]);
  useEffect(() => { clearTap(); updateZoom(FIT); }, [index, clearTap, updateZoom]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const view = dialog;
    let idle: ReturnType<typeof setTimeout> | undefined;
    let swipe = { x: 0, horizontal: false };
    let safariPinch: { zoom: Zoom; point: Point } | null = null;

    function zoomWith(base: Zoom, point: Point, factor: number) {
      const scale = Math.max(1, Math.min(4, base.scale * factor));
      updateZoom(scale === 1 ? FIT : zoomAt(view, base, point, point, scale));
    }

    function finishSwipe(commit: boolean) {
      clearTimeout(idle);
      const { x, horizontal } = swipe;
      swipe = { x: 0, horizontal: false };
      if (!horizontal) return;
      setDrag(null);
      if (commit && Math.abs(x) >= SWIPE_THRESHOLD) navigate(x < 0 ? 1 : -1);
    }

    function wheel(event: WheelEvent) {
      if (event.target instanceof Element && event.target.closest("[role=group]")) return;
      const { deltaMode, ctrlKey, clientX, clientY } = event;
      const unit = deltaMode === 1 ? 16 : deltaMode === 2 ? view.clientHeight : 1;
      const x = event.deltaX * unit, y = event.deltaY * unit;
      if (ctrlKey) {
        event.preventDefault();
        finishSwipe(false);
        clearTap();
        if (!safariPinch && points.current.size === 0) {
          zoomWith(zoomRef.current, { x: clientX, y: clientY }, Math.exp(-y / 100));
        }
        return;
      }
      const current = zoomRef.current;
      if (current.scale > 1) {
        event.preventDefault();
        updateZoom(boundedZoom(view, { ...current, x: current.x - x, y: current.y - y }));
        return;
      }
      if (count < 2 || points.current.size > 0 || safariPinch) return;
      if (!swipe.horizontal && Math.abs(x) <= Math.abs(y)) {
        swipe.x = 0;
        return;
      }
      event.preventDefault();
      const limit = Math.max(view.clientWidth, SWIPE_THRESHOLD);
      swipe.x = Math.max(-limit, Math.min(limit, swipe.x - x));
      if (swipe.horizontal || Math.abs(swipe.x) > SWIPE_SLOP) {
        swipe.horizontal = true;
        clearTap();
        slide(swipe.x);
      }
      clearTimeout(idle);
      // Wheel events have no end signal. Settle once the stream, including momentum, stops.
      idle = setTimeout(() => finishSwipe(true), WHEEL_IDLE_MS);
    }

    function gesture(event: Event) {
      event.preventDefault();
      if (event.type === "gestureend") { safariPinch = null; return; }
      if (points.current.size > 0) return;
      const { clientX: x, clientY: y, scale } = event as SafariPinchEvent;
      if (event.type === "gesturestart") {
        finishSwipe(false);
        clearTap();
        safariPinch = { zoom: zoomRef.current, point: { x, y } };
      } else if (safariPinch) {
        zoomWith(safariPinch.zoom, safariPinch.point, scale);
      }
    }

    view.addEventListener("wheel", wheel, { passive: false });
    const gestures = ["gesturestart", "gesturechange", "gestureend"];
    for (const name of gestures) view.addEventListener(name, gesture, { passive: false });
    return () => {
      finishSwipe(false);
      view.removeEventListener("wheel", wheel);
      for (const name of gestures) view.removeEventListener(name, gesture);
    };
  }, [dialogRef, count, navigate, clearTap, updateZoom, setDrag, slide]);

  const finish = (event: PointerEvent<HTMLDivElement>, cancelled = false) => {
    if (!points.current.delete(event.pointerId) || points.current.size > 0) return;
    const initial = start.current;
    const gesture = mode.current;
    start.current = null;
    mode.current = null;
    pinch.current = null;
    cancelPress();
    if (!cancelled && initial && gesture === "vertical" && event.clientY - initial.y >= 96) {
      dismiss();
      return;
    }
    setDrag(null);
    if (!cancelled && initial && gesture === "horizontal") {
      const dx = event.clientX - initial.x;
      if (Math.abs(dx) >= SWIPE_THRESHOLD) navigate(dx < 0 ? 1 : -1);
    }
  };

  const handlers = {
    onPointerDown(event: PointerEvent<HTMLDivElement>) {
      if (event.button !== 0 || (event.target instanceof Element && event.target.closest("button, a, [role=group]"))) return;
      const point = { x: event.clientX, y: event.clientY };
      points.current.set(event.pointerId, point);
      if (points.current.size === 1) {
        ignoreClick.current = false;
        start.current = point;
        origin.current = zoomRef.current;
      } else if (points.current.size === 2) {
        ignoreClick.current = true;
        clearTap();
        cancelPress();
        setDrag(null);
        mode.current = "pinch";
        pinch.current = pinchBetween([...points.current.values()]);
        origin.current = zoomRef.current;
        for (const id of points.current.keys()) event.currentTarget.setPointerCapture(id);
      }
    },
    onPointerMove(event: PointerEvent<HTMLDivElement>) {
      if (!points.current.has(event.pointerId)) return;
      const point = { x: event.clientX, y: event.clientY };
      points.current.set(event.pointerId, point);
      const initial = start.current;
      if (!initial) return;
      if (mode.current === "pinch") {
        if (points.current.size === 2 && pinch.current) {
          const next = pinchBetween([...points.current.values()]);
          const scale = Math.min(4, Math.max(1, origin.current.scale * next.distance / Math.max(1, pinch.current.distance)));
          updateZoom(zoomAt(event.currentTarget, origin.current, pinch.current, next, scale));
        }
        return;
      }
      const dx = point.x - initial.x;
      const dy = point.y - initial.y;
      if (!mode.current) {
        if (Math.hypot(dx, dy) <= SWIPE_SLOP) return;
        mode.current = origin.current.scale > 1 ? "pan" : Math.abs(dx) > Math.abs(dy) ? "horizontal" : "vertical";
        ignoreClick.current = true;
        clearTap();
        cancelPress();
        event.currentTarget.setPointerCapture(event.pointerId);
      }
      if (mode.current === "pan") {
        updateZoom(boundedZoom(event.currentTarget, { scale: origin.current.scale, x: origin.current.x + dx, y: origin.current.y + dy }));
      } else if (mode.current === "horizontal") {
        slide(dx);
      } else {
        setDrag({ x: 0, y: Math.max(0, dy) });
      }
    },
    onPointerUp: (event: PointerEvent<HTMLDivElement>) => finish(event),
    onPointerCancel: (event: PointerEvent<HTMLDivElement>) => finish(event, true),
    onPointerLeave(event: PointerEvent<HTMLDivElement>) {
      if (!mode.current) finish(event, true);
    },
    onLostPointerCapture(event: PointerEvent<HTMLDivElement>) {
      if (event.target === event.currentTarget) finish(event, true);
    },
    onClickCapture(event: MouseEvent<HTMLDivElement>) {
      if (!ignoreClick.current || event.detail === 0) return;
      ignoreClick.current = false;
      event.preventDefault();
      event.stopPropagation();
    },
  };

  function tapSurface(event: MouseEvent<HTMLDivElement>) {
    if (event.target instanceof Element && event.target.closest("button, a, [role=group]")) return;
    if (event.detail === 0) { clearTap(); dismiss(); return; }
    if (tap.current !== null) {
      clearTap();
      const point = { x: event.clientX, y: event.clientY };
      updateZoom(zoomRef.current.scale > 1 ? FIT : zoomAt(event.currentTarget, FIT, point, point, 2.5), true);
      return;
    }
    tap.current = setTimeout(() => { tap.current = null; dismiss(); }, TAP_DELAY_MS);
  }

  return { trackRef, zoom, animateZoom, handlers, tapSurface, clearTap };
}
