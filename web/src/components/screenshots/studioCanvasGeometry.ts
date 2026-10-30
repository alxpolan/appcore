import type { StudioLayer, StudioOverlay, StudioStyle } from "./studioApi";
import { computePreviewLayout, measureTitleBlock, toOutRect, type PreviewRect } from "./studioPreview";

export interface CssBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export type CanvasTarget = "phone" | "title" | "overlay";

export type CanvasEdge = "n" | "s" | "e" | "w";

export type CanvasHandle =
  | { target: CanvasTarget; corner: number }
  | { target: "title"; edge: CanvasEdge }
  | { target: CanvasTarget; rotate: boolean };

export interface OverlaySize {
  w: number;
  h: number;
}

export function overlayWorkRect(overlay: StudioOverlay, size: OverlaySize | undefined): PreviewRect | null {
  if (!size || !(size.w > 0) || !(size.h > 0)) return null;

  const w = size.w * overlay.scale;
  const h = size.h * overlay.scale;

  return { x: overlay.x - w / 2, y: overlay.y - h / 2, w, h };
}

export function canvasBox(
  canvas: HTMLCanvasElement | null,
  wrap: HTMLDivElement | null,
): (CssBox & { canvas: HTMLCanvasElement }) | null {
  if (!canvas || !wrap || !canvas.width) return null;

  const rect = canvas.getBoundingClientRect();
  const wrapRect = wrap.getBoundingClientRect();

  return { canvas, left: rect.left - wrapRect.left, top: rect.top - wrapRect.top, width: rect.width, height: rect.height };
}

export function phoneWorkRect(canvas: HTMLCanvasElement | null, style: StudioStyle): PreviewRect | null {
  if (!canvas || !canvas.width) return null;

  const layout = computePreviewLayout(canvas.width, canvas.height, style.textPosition === "top");

  if (!layout.frame) return null;

  const k = style.deviceScale;

  return {
    x: layout.phone.x + ((layout.phone.w - layout.phone.w * k) / 2 + style.offsetX),
    y: layout.phone.y + ((layout.phone.h - layout.phone.h * k) / 2 + style.offsetY),
    w: layout.phone.w * k,
    h: layout.phone.h * k,
  };
}

export function titleWorkRect(
  canvas: HTMLCanvasElement | null,
  title: string,
  style: StudioStyle,
): PreviewRect | null {
  if (!canvas || !canvas.width || title.trim().length === 0) return null;

  const layout = computePreviewLayout(canvas.width, canvas.height, style.textPosition === "top");

  if (!layout.frame) return null;

  const tm = measureTitleBlock(
    title,
    style.font,
    layout.workW,
    layout.pad,
    layout.space,
    style.titleScale,
    style.titleBoxW,
    style.titleBoxH,
  );

  if (tm.w === 0) return null;

  return {
    x: layout.workW / 2 - tm.w / 2 + style.titleOffsetX,
    y: layout.band.y + layout.band.h / 2 - tm.h / 2 + style.titleOffsetY,
    w: tm.w,
    h: tm.h,
  };
}

export function workToCss(
  canvas: HTMLCanvasElement | null,
  wrap: HTMLDivElement | null,
  rect: PreviewRect,
  style: StudioStyle,
): CssBox | null {
  const box = canvasBox(canvas, wrap);

  if (!canvas || !box) return null;

  const layout = computePreviewLayout(canvas.width, canvas.height, style.textPosition === "top");
  const out = toOutRect(rect, layout.cover);

  return {
    left: box.left + (out.x / layout.outW) * box.width,
    top: box.top + (out.y / layout.outH) * box.height,
    width: (out.w / layout.outW) * box.width,
    height: (out.h / layout.outH) * box.height,
  };
}

export function cssToWork(
  canvas: HTMLCanvasElement | null,
  clientX: number,
  clientY: number,
  style: StudioStyle,
): { x: number; y: number } | null {
  if (!canvas || !canvas.width) return null;

  const rect = canvas.getBoundingClientRect();
  const layout = computePreviewLayout(canvas.width, canvas.height, style.textPosition === "top");
  const outX = ((clientX - rect.left) / rect.width) * canvas.width;
  const outY = ((clientY - rect.top) / rect.height) * canvas.height;

  return { x: (outX - layout.cover.dx) / layout.cover.s, y: (outY - layout.cover.dy) / layout.cover.s };
}

export function selectedWorkRect(
  canvas: HTMLCanvasElement | null,
  layer: StudioLayer | null,
  title: string,
  style: StudioStyle,
  overlay?: { overlay: StudioOverlay; size: OverlaySize | undefined } | null,
): { target: CanvasTarget; rect: PreviewRect } | null {
  if (overlay) {
    const rect = overlayWorkRect(overlay.overlay, overlay.size);

    return rect ? { target: "overlay", rect } : null;
  }

  if (layer === "device" || layer === "image") {
    const rect = phoneWorkRect(canvas, style);

    return rect ? { target: "phone", rect } : null;
  }

  if (layer === "caption") {
    const rect = titleWorkRect(canvas, title, style);

    return rect ? { target: "title", rect } : null;
  }

  return null;
}

export function pickHandle(
  canvas: HTMLCanvasElement | null,
  wrap: HTMLDivElement | null,
  clientX: number,
  clientY: number,
  layer: StudioLayer | null,
  title: string,
  style: StudioStyle,
  overlay?: { overlay: StudioOverlay; size: OverlaySize | undefined } | null,
): CanvasHandle | null {
  const box = canvasBox(canvas, wrap);
  const selected = selectedWorkRect(canvas, layer, title, style, overlay);

  if (!box || !selected || !wrap) return null;

  const css = workToCss(canvas, wrap, selected.rect, style);

  if (!css) return null;

  const rotateX = css.left + css.width / 2;
  const rotateY = css.top - 26;
  const wrapRect = wrap.getBoundingClientRect();

  if (Math.hypot(clientX - wrapRect.left - rotateX, clientY - wrapRect.top - rotateY) <= 12) {
    return { target: selected.target, rotate: true };
  }

  const corners = [
    { x: css.left, y: css.top },
    { x: css.left + css.width, y: css.top },
    { x: css.left + css.width, y: css.top + css.height },
    { x: css.left, y: css.top + css.height },
  ];

  const px = clientX - wrapRect.left;
  const py = clientY - wrapRect.top;

  for (let i = 0; i < corners.length; i++) {
    if (Math.abs(px - corners[i].x) <= 10 && Math.abs(py - corners[i].y) <= 10) {
      return { target: selected.target, corner: i };
    }
  }

  if (selected.target !== "title") return null;

  const midX = css.left + css.width / 2;
  const midY = css.top + css.height / 2;
  const edges: Array<{ edge: CanvasEdge; x: number; y: number }> = [
    { edge: "n", x: midX, y: css.top },
    { edge: "s", x: midX, y: css.top + css.height },
    { edge: "e", x: css.left + css.width, y: midY },
    { edge: "w", x: css.left, y: midY },
  ];

  for (const { edge, x, y } of edges) {
    if (Math.abs(px - x) <= 10 && Math.abs(py - y) <= 10) {
      return { target: "title", edge };
    }
  }

  return null;
}

export interface PickedTarget {
  target: CanvasTarget;
  overlayId: string | null;
}

export function pickTarget(
  canvas: HTMLCanvasElement | null,
  clientX: number,
  clientY: number,
  layer: StudioLayer | null,
  style: StudioStyle,
  overlays?: Array<{ overlay: StudioOverlay; size: OverlaySize | undefined }> | null,
): PickedTarget | null {
  if (!canvas || !canvas.width) return null;

  const rect = canvas.getBoundingClientRect();
  const px = ((clientX - rect.left) / rect.width) * canvas.width;
  const py = ((clientY - rect.top) / rect.height) * canvas.height;
  const layout = computePreviewLayout(canvas.width, canvas.height, style.textPosition === "top");

  if (!layout.frame) return null;

  const toOut = (r: PreviewRect) => toOutRect(r, layout.cover);

  if (overlays) {
    for (let i = overlays.length - 1; i >= 0; i--) {
      const hit = overlayWorkRect(overlays[i].overlay, overlays[i].size);

      if (!hit) continue;

      const out = toOut(hit);

      if (px >= out.x && px <= out.x + out.w && py >= out.y && py <= out.y + out.h) {
        return { target: "overlay", overlayId: overlays[i].overlay.id };
      }
    }
  }

  const phone = toOutRect(layout.phone, layout.cover);
  phone.x += style.offsetX * layout.cover.s;
  phone.y += style.offsetY * layout.cover.s;

  if (px >= phone.x && px <= phone.x + phone.w && py >= phone.y && py <= phone.y + phone.h) {
    return { target: "phone", overlayId: null };
  }

  const band = toOutRect(layout.band, layout.cover);
  band.x += style.titleOffsetX * layout.cover.s;
  band.y += style.titleOffsetY * layout.cover.s;

  if (px >= band.x && px <= band.x + band.w && py >= band.y && py <= band.y + band.h) {
    return { target: "title", overlayId: null };
  }

  if (layer === "caption") return { target: "title", overlayId: null };
  if (layer === "device" || layer === "image") return { target: "phone", overlayId: null };

  return null;
}
