import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, Copy, Redo2, Undo2 } from "lucide-react";
import { borderDefault, cardCls, textMuted, textPrimary, textSecondary } from "../../styles";
import { useClickOutside } from "../../hooks/useClickOutside";
import { getLocaleFlag, getLocaleName } from "../../utils/localeUtils";
import type { StudioBezels, StudioItem, StudioLayer, StudioOverlay, StudioStyle } from "./studioApi";
import {
  TITLE_BASE_SIZE,
  TITLE_LINE_HEIGHT,
  computePreviewLayout,
  drawStudioPreview,
  getPreviewFrameOverride,
  measureTitle,
  setPreviewFrameOverride,
  studioFontFamily,
  wrapTitleLines,
  type PreviewRect,
} from "./studioPreview";
import { snapOffset } from "./studioSnap";
import type { CanvasEdge, CssBox } from "./studioCanvasGeometry";
import * as canvasGeom from "./studioCanvasGeometry";

interface StudioCanvasProps {
  item: StudioItem | null;
  title: string;
  style: StudioStyle;
  layer: StudioLayer | null;
  disabled: boolean;
  onGeometryChange: (patch: Partial<StudioStyle>) => void;
  onApplyToAll: () => void;
  onSelectLayer: (layer: StudioLayer | null) => void;
  index: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
  locales: string[];
  activeLocale: string;
  onLocaleChange: (locale: string) => void;
  overlays: StudioOverlay[];
  selectedOverlayId: string | null;
  onSelectOverlay: (id: string | null) => void;
  onOverlayPatch: (id: string, patch: Partial<StudioOverlay>) => void;
  onOverlaysAdd: (overlays: StudioOverlay[]) => void;
  uploadOverlayFile: (file: File) => Promise<{ id: string; url: string } | null>;
  duplicateOverlayFile: (overlayId: string) => Promise<{ id: string; url: string } | null>;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  bezels: StudioBezels | null;
}

type DragState =
  | { mode: "move"; target: "phone" | "title"; startClientX: number; startClientY: number; origX: number; origY: number }
  | { mode: "move"; target: "overlay"; overlayId: string; startClientX: number; startClientY: number; origX: number; origY: number }
  | { mode: "scale"; target: "phone" | "title" | "overlay"; overlayId?: string; centerX: number; centerY: number; origDist: number; origScale: number; corner: number }
  | { mode: "resize"; edge: CanvasEdge; centerX: number; centerY: number; origW: number }
  | { mode: "rotate"; target: "phone" | "title" | "overlay"; overlayId?: string; centerX: number; centerY: number };

function normAngle(deg: number): number {
  const wrapped = ((((deg + 180) % 360) + 360) % 360) - 180;

  return Math.round(wrapped * 10) / 10;
}

type LayerClipboard =
  | { kind: "overlay"; overlay: StudioOverlay }
  | { kind: "image" }
  | { kind: "caption"; text: string };

interface GuideLines {
  vCenter: boolean;
  hCenter: boolean;
  smartV: number | null;
  smartH: number | null;
  box: CssBox;
  cover: { s: number; dx: number; dy: number };
  outW: number;
  outH: number;
}

const CORNER_CURSORS = ["nwse-resize", "nesw-resize", "nwse-resize", "nesw-resize"];

const EDGE_CURSORS: Record<CanvasEdge, string> = { n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize" };

function LocaleFlag({ locale }: { locale: string }) {
  return (
    <img
      src={`/country-flags/${getLocaleFlag(locale)}.svg`}
      alt=""
      width={20}
      height={15}
      className="h-[12px] w-4 object-cover shrink-0 rounded-xs"
      onError={(e) => {
        (e.currentTarget as HTMLImageElement).style.display = "none";
      }}
    />
  );
}

function LocaleDropdown({
  locales,
  value,
  onChange,
}: {
  locales: string[];
  value: string;
  onChange: (locale: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);

  useClickOutside(ref, close);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="Preview locale"
        className={`inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-[12px] font-medium bg-transparent cursor-pointer ${borderDefault} ${textSecondary}`}
      >
        <LocaleFlag locale={value} />
        <span>{getLocaleName(value)}</span>
        <ChevronDown className={`w-3.5 h-3.5 ${textMuted} transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div
          className={`absolute right-0 top-full mt-1.5 z-50 bg-white dark:bg-[#1c2028] border ${borderDefault} rounded-xl shadow-lg py-1 min-w-[200px] max-h-[320px] overflow-auto`}
        >
          {locales.map((locale) => (
            <button
              key={locale}
              type="button"
              onClick={() => {
                onChange(locale);
                setOpen(false);
              }}
              className={`w-full flex items-center gap-2.5 px-3.5 py-2 text-[13px] ${textPrimary} hover:bg-[#fafbfc] dark:hover:bg-[#252b38] transition-colors text-left ${
                value === locale ? "font-semibold" : ""
              }`}
            >
              <LocaleFlag locale={locale} />
              {getLocaleName(locale)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function clampOffset(value: number): number {
  return Math.max(-2048, Math.min(2048, Math.round(value)));
}

function clampScale(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value * 1000) / 1000));
}

function formatOffset(value: number): string {
  return value > 0 ? `+${value}` : `${value}`;
}

function clampBox(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

export default function StudioCanvas({
  item,
  title,
  style,
  layer,
  disabled,
  onGeometryChange,
  onApplyToAll,
  onSelectLayer,
  index,
  total,
  onPrev,
  onNext,
  locales,
  activeLocale,
  onLocaleChange,
  overlays,
  selectedOverlayId,
  onSelectOverlay,
  onOverlayPatch,
  onOverlaysAdd,
  uploadOverlayFile,
  duplicateOverlayFile,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  bezels,
}: StudioCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const downRef = useRef<{ x: number; y: number; hit: boolean } | null>(null);
  const overlaySizesRef = useRef(new Map<string, { w: number; h: number }>());
  const layerClipboardRef = useRef<LayerClipboard | null>(null);
  const bezelObjectUrlsRef = useRef(new Map<string, string>());
  const [drawing, setDrawing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [, setSizeTick] = useState(0);
  const [dragInfo, setDragInfo] = useState<{
    mode: "move" | "scale" | "resize" | "rotate";
    target: "phone" | "title" | "overlay";
    corner?: number;
    edge?: CanvasEdge;
    angle?: number;
  } | null>(null);

  const [guides, setGuides] = useState<GuideLines | null>(null);
  const [hoverCursor, setHoverCursor] = useState<string>("move");
  const [, setResizeTick] = useState(0);
  const rawUrl = item?.rawUrl ?? null;

  useEffect(() => {
    const onResize = () => setResizeTick((tick) => tick + 1);
    window.addEventListener("resize", onResize);

    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    let live = true;

    for (const overlay of overlays) {
      if (overlaySizesRef.current.has(overlay.url)) continue;

      const img = new Image();

      img.onload = () => {
        if (!live) return;

        overlaySizesRef.current.set(overlay.url, { w: img.naturalWidth, h: img.naturalHeight });
        setSizeTick((tick) => tick + 1);
      };
      img.src = overlay.url;
    }

    return () => {
      live = false;
    };
  }, [overlays]);

  const overlayEntries = overlays.map((overlay) => ({
    overlay,
    size: overlaySizesRef.current.get(overlay.url),
  }));
  const selectedOverlayEntry = overlayEntries.find((entry) => entry.overlay.id === selectedOverlayId) ?? null;
  const bezelFile = style.deviceFrame || bezels?.current || "";
  const bezelOption = (bezels?.options ?? []).find((option) => option.file === bezelFile) ?? null;
  const [frameTick, setFrameTick] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas || !canvas.width || !item) return;

    const layout = computePreviewLayout(canvas.width, canvas.height, style.textPosition === "top");
    const key = `${layout.workW}x${layout.workH}`;

    const wantBezel =
      bezelOption && bezels?.device && bezelOption.frameW > 0 && bezelOption.frameH > 0 ? bezelOption.file : null;

    if (!wantBezel) {
      if (getPreviewFrameOverride() !== null) {
        setPreviewFrameOverride(null);
        setFrameTick((tick) => tick + 1);
      }

      return;
    }

    const cached = bezelObjectUrlsRef.current.get(wantBezel);

    if (cached && bezelOption) {
      const next = {
        key,
        entry: {
          file: cached,
          frameW: bezelOption.frameW,
          frameH: bezelOption.frameH,
          offX: bezels?.device?.offsetX ?? 0,
          offY: bezels?.device?.offsetY ?? 0,
          shotW: bezels?.device?.width ?? layout.workW,
          triple: layout.frame?.triple ?? false,
          rounded: bezels?.device?.rounded ?? true,
        },
      };

      if (JSON.stringify(getPreviewFrameOverride()) !== JSON.stringify(next)) {
        setPreviewFrameOverride(next);
        setFrameTick((tick) => tick + 1);
      }

      return;
    }

    let live = true;

    fetch(`/api/github/screenshots/frame-bezels/image/${encodeURIComponent(wantBezel)}`, { credentials: "include" })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        return res.blob();
      })
      .then((blob) => {
        if (!live) return;

        bezelObjectUrlsRef.current.set(wantBezel, URL.createObjectURL(blob));
        setFrameTick((tick) => tick + 1);
      })
      .catch(() => {});

    return () => {
      live = false;
    };
  }, [bezels, style.deviceFrame, style.textPosition, item, rawUrl, drawing, bezelOption]);

  useEffect(
    () => () => {
      for (const url of bezelObjectUrlsRef.current.values()) URL.revokeObjectURL(url);

      bezelObjectUrlsRef.current.clear();
      setPreviewFrameOverride(null);
    },
    [],
  );

  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas || !rawUrl) return;

    let cancelled = false;
    setDrawing(true);

    drawStudioPreview(canvas, { rawUrl, title, style, overlays })
      .then(() => {
        if (!cancelled) {
          setDrawing(false);
          setError(null);
        }
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setDrawing(false);
          setError(err.message);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [rawUrl, title, style, overlays, bezelOption?.file, frameTick]);

  useEffect(() => () => setPreviewFrameOverride(null), []);

  const canvasBox = () => canvasGeom.canvasBox(canvasRef.current, wrapRef.current);
  const workToCss = (rect: PreviewRect) => canvasGeom.workToCss(canvasRef.current, wrapRef.current, rect, style);
  const cssToWork = (clientX: number, clientY: number) => canvasGeom.cssToWork(canvasRef.current, clientX, clientY, style);
  const selectedWorkRect = () =>
    canvasGeom.selectedWorkRect(canvasRef.current, layer, title, style, selectedOverlayEntry);
  const pickHandle = (clientX: number, clientY: number) =>
    canvasGeom.pickHandle(canvasRef.current, wrapRef.current, clientX, clientY, layer, title, style, selectedOverlayEntry);

  const pickTarget = (clientX: number, clientY: number) =>
    canvasGeom.pickTarget(canvasRef.current, clientX, clientY, layer, style, overlayEntries);

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled || e.button !== 0) return;

    const handle = pickHandle(e.clientX, e.clientY);

    if (handle) {
      if ("rotate" in handle) {
        const selected = selectedWorkRect();

        if (!selected) return;

        const centerX = selected.rect.x + selected.rect.w / 2;
        const centerY = selected.rect.y + selected.rect.h / 2;
        const startAngle =
          handle.target === "overlay"
            ? (selectedOverlayEntry?.overlay.rotation ?? 0)
            : handle.target === "phone"
              ? style.rotation
              : style.titleRotation;

        e.currentTarget.setPointerCapture(e.pointerId);
        dragRef.current = {
          mode: "rotate",
          target: handle.target,
          overlayId: handle.target === "overlay" ? selectedOverlayEntry?.overlay.id : undefined,
          centerX,
          centerY,
        };
        downRef.current = { x: e.clientX, y: e.clientY, hit: true };
        setDragInfo({ mode: "rotate", target: handle.target, angle: startAngle });

        return;
      }

      if ("edge" in handle) {
        const selected = selectedWorkRect();

        if (!selected) return;

        e.currentTarget.setPointerCapture(e.pointerId);
        dragRef.current = {
          mode: "resize",
          edge: handle.edge,
          centerX: selected.rect.x + selected.rect.w / 2,
          centerY: selected.rect.y + selected.rect.h / 2,
          origW: selected.rect.w,
        };
        downRef.current = { x: e.clientX, y: e.clientY, hit: true };
        setDragInfo({ mode: "resize", target: "title", edge: handle.edge });

        return;
      }

      const selected = selectedWorkRect();

      if (!selected) return;

      const centerX = selected.rect.x + selected.rect.w / 2;
      const centerY = selected.rect.y + selected.rect.h / 2;
      const corners = [
        { x: selected.rect.x, y: selected.rect.y },
        { x: selected.rect.x + selected.rect.w, y: selected.rect.y },
        { x: selected.rect.x + selected.rect.w, y: selected.rect.y + selected.rect.h },
        { x: selected.rect.x, y: selected.rect.y + selected.rect.h },
      ];
      const corner = corners[handle.corner];
      const origDist = Math.max(1, Math.hypot(corner.x - centerX, corner.y - centerY));

      e.currentTarget.setPointerCapture(e.pointerId);

      if (handle.target === "overlay") {
        const overlay = selectedOverlayEntry?.overlay;

        if (!overlay) return;

        dragRef.current = {
          mode: "scale",
          target: "overlay",
          overlayId: overlay.id,
          centerX,
          centerY,
          origDist,
          origScale: overlay.scale,
          corner: handle.corner,
        };
        downRef.current = { x: e.clientX, y: e.clientY, hit: true };
        setDragInfo({ mode: "scale", target: "overlay", corner: handle.corner });

        return;
      }

      dragRef.current = {
        mode: "scale",
        target: handle.target,
        centerX,
        centerY,
        origDist,
        origScale: handle.target === "phone" ? style.deviceScale : style.titleScale,
        corner: handle.corner,
      };
      downRef.current = { x: e.clientX, y: e.clientY, hit: true };
      setDragInfo({ mode: "scale", target: handle.target, corner: handle.corner });

      return;
    }

    const target = pickTarget(e.clientX, e.clientY);
    downRef.current = { x: e.clientX, y: e.clientY, hit: target !== null };

    if (!target) return;

    if (target.target === "overlay" && target.overlayId) {
      const overlay = overlays.find((entry) => entry.id === target.overlayId);

      if (!overlay) return;

      onSelectOverlay(overlay.id);
      e.currentTarget.setPointerCapture(e.pointerId);
      dragRef.current = {
        mode: "move",
        target: "overlay",
        overlayId: overlay.id,
        startClientX: e.clientX,
        startClientY: e.clientY,
        origX: overlay.x,
        origY: overlay.y,
      };
      setDragInfo({ mode: "move", target: "overlay" });

      return;
    }

    if (target.target === "overlay") return;

    onSelectOverlay(null);
    onSelectLayer(target.target === "phone" ? (layer === "image" ? "image" : "device") : "caption");
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      mode: "move",
      target: target.target,
      startClientX: e.clientX,
      startClientY: e.clientY,
      origX: target.target === "phone" ? style.offsetX : style.titleOffsetX,
      origY: target.target === "phone" ? style.offsetY : style.titleOffsetY,
    };
    setDragInfo({ mode: "move", target: target.target });

    const box = canvasBox();
    const canvas = canvasRef.current;

    if (box && canvas) {
      const layout = computePreviewLayout(canvas.width, canvas.height, style.textPosition === "top");
      setGuides({ vCenter: false, hCenter: false, smartV: null, smartH: null, box, cover: layout.cover, outW: layout.outW, outH: layout.outH });
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    const canvas = canvasRef.current;

    if (!canvas || !canvas.width) return;

    if (!drag) {
      if (disabled) return;

      const handle = pickHandle(e.clientX, e.clientY);

      if (handle) {
        setHoverCursor(
          "rotate" in handle ? "grab" : "corner" in handle ? CORNER_CURSORS[handle.corner] : EDGE_CURSORS[handle.edge],
        );
        return;
      }

      setHoverCursor(pickTarget(e.clientX, e.clientY) ? "move" : "default");

      return;
    }

    if (drag.mode === "rotate") {
      const point = cssToWork(e.clientX, e.clientY);

      if (!point) return;

      let angle = (Math.atan2(point.y - drag.centerY, point.x - drag.centerX) * 180) / Math.PI + 90;
      angle = normAngle(angle);

      if (e.shiftKey) {
        angle = Math.round(angle / 15) * 15;
      } else {
        for (const snap of [0, 90, 180, -90, -180]) {
          if (Math.abs(angle - snap) <= 4) {
            angle = snap;
            break;
          }
        }
      }

      if (drag.target === "overlay") {
        if (drag.overlayId) onOverlayPatch(drag.overlayId, { rotation: angle });
      } else if (drag.target === "phone") {
        onGeometryChange({ rotation: angle });
      } else {
        onGeometryChange({ titleRotation: angle });
      }

      setDragInfo({ mode: "rotate", target: drag.target, angle });

      return;
    }

    if (drag.mode === "scale") {
      const point = cssToWork(e.clientX, e.clientY);

      if (!point) return;

      const dist = Math.max(1, Math.hypot(point.x - drag.centerX, point.y - drag.centerY));
      let k = (dist / drag.origDist) * drag.origScale;

      if (Math.abs(k - 1) < 0.015) k = 1;

      if (drag.target === "overlay") {
        if (drag.overlayId) onOverlayPatch(drag.overlayId, { scale: clampScale(k, 0.1, 8) });

        return;
      }

      if (drag.target === "phone") {
        onGeometryChange({ deviceScale: clampScale(k, 0.2, 2) });
      } else {
        onGeometryChange({ titleScale: clampScale(k, 0.2, 3) });
      }

      return;
    }

    if (drag.mode === "resize") {
      const point = cssToWork(e.clientX, e.clientY);

      if (!point) return;

      const layout = computePreviewLayout(canvas.width, canvas.height, style.textPosition === "top");

      if (drag.edge === "e" || drag.edge === "w") {
        onGeometryChange({ titleBoxW: clampBox(Math.abs(point.x - drag.centerX) * 2, 120, layout.workW) });
      } else {
        const initW = style.titleBoxW > 0 ? style.titleBoxW : Math.round(drag.origW);

        onGeometryChange({
          titleBoxW: clampBox(initW, 120, layout.workW),
          titleBoxH: clampBox(Math.abs(point.y - drag.centerY) * 2, 40, layout.workH),
        });
      }

      return;
    }

    const rect = canvas.getBoundingClientRect();
    const layout = computePreviewLayout(canvas.width, canvas.height, style.textPosition === "top");
    const outPerCss = canvas.width / rect.width;
    const dx = ((e.clientX - drag.startClientX) * outPerCss) / layout.cover.s;
    const dy = ((e.clientY - drag.startClientY) * outPerCss) / layout.cover.s;

    if (drag.target === "overlay") {
      if (drag.overlayId) {
        onOverlayPatch(drag.overlayId, {
          x: Math.round(drag.origX + dx),
          y: Math.round(drag.origY + dy),
        });
      }

      return;
    }

    const threshold = (8 * (rect.width / canvas.width)) / layout.cover.s;
    const peer =
      drag.target === "phone" ? { x: style.titleOffsetX, y: style.titleOffsetY } : { x: style.offsetX, y: style.offsetY };
    const snapped = snapOffset(drag.target, drag.origX + dx, drag.origY + dy, layout, peer, threshold);
    const nextX = clampOffset(snapped.x);
    const nextY = clampOffset(snapped.y);

    if (drag.target === "phone") {
      onGeometryChange({ offsetX: nextX, offsetY: nextY });
    } else {
      onGeometryChange({ titleOffsetX: nextX, titleOffsetY: nextY });
    }

    const box = canvasBox();

    if (box) {
      setGuides({ ...snapped.guides, box, cover: layout.cover, outW: layout.outW, outH: layout.outH });
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const down = downRef.current;
    dragRef.current = null;
    downRef.current = null;
    setDragInfo(null);
    setGuides(null);

    if (down && !down.hit && !disabled && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 4) {
      onSelectLayer(null);
      onSelectOverlay(null);
    }
  };

  const endDrag = () => {
    dragRef.current = null;
    downRef.current = null;
    setDragInfo(null);
    setGuides(null);
  };

  const renderGuides = () => {
    if (!guides) return null;

    const toCssX = (workX: number) =>
      guides.box.left + (((workX * guides.cover.s + guides.cover.dx) / guides.outW) * guides.box.width);
    const toCssY = (workY: number) =>
      guides.box.top + (((workY * guides.cover.s + guides.cover.dy) / guides.outH) * guides.box.height);
    const canvas = canvasRef.current;

    if (!canvas) return null;

    const layout = computePreviewLayout(canvas.width, canvas.height, style.textPosition === "top");
    const vCenterX = toCssX(layout.workW / 2);
    const hCenterY = toCssY(layout.workH / 2);

    return (
      <>
        <div
          className={`absolute w-px pointer-events-none ${guides.vCenter ? "bg-[#fb7185]" : "bg-white/25"}`}
          style={{ left: vCenterX, top: guides.box.top, height: guides.box.height }}
        />
        <div
          className={`absolute h-px pointer-events-none ${guides.hCenter ? "bg-[#fb7185]" : "bg-white/25"}`}
          style={{ top: hCenterY, left: guides.box.left, width: guides.box.width }}
        />
        {guides.smartV !== null && (
          <div
            className="absolute w-px pointer-events-none bg-[#fb7185]"
            style={{ left: toCssX(guides.smartV), top: guides.box.top, height: guides.box.height }}
          />
        )}
        {guides.smartH !== null && (
          <div
            className="absolute h-px pointer-events-none bg-[#fb7185]"
            style={{ top: toCssY(guides.smartH), left: guides.box.left, width: guides.box.width }}
          />
        )}
      </>
    );
  };

  const renderSelection = () => {
    const selected = selectedWorkRect();

    if (!selected || !canvasRef.current) return null;

    const css = workToCss(selected.rect);

    if (!css) return null;

    const corners = [
      { x: css.left, y: css.top },
      { x: css.left + css.width, y: css.top },
      { x: css.left + css.width, y: css.top + css.height },
      { x: css.left, y: css.top + css.height },
    ];
    const midX = css.left + css.width / 2;
    const midY = css.top + css.height / 2;
    const rotX = midX;
    const rotY = css.top - 26;
    const edges = [
      { x: midX, y: css.top, cursor: "ns-resize" },
      { x: midX, y: css.top + css.height, cursor: "ns-resize" },
      { x: css.left + css.width, y: midY, cursor: "ew-resize" },
      { x: css.left, y: midY, cursor: "ew-resize" },
    ];

    return (
      <>
        <div
          className="absolute pointer-events-none border border-[#8085ff]"
          style={{ left: css.left, top: css.top, width: css.width, height: css.height }}
        />
        {!disabled && (
          <>
            <div
              className="absolute pointer-events-none w-px bg-[#8085ff]"
              style={{ left: midX, top: css.top - 26, height: 26 }}
            />
            <div
              className="absolute pointer-events-none w-[18px] h-[18px] rounded-full bg-white border-2 border-[#595DD2] flex items-center justify-center"
              style={{ left: rotX - 9, top: rotY - 9, cursor: "grab" }}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path
                  d="M8.5 5A3.5 3.5 0 1 1 5 1.5c1.2 0 2.2.6 2.8 1.5M7.6 1v2H5.6"
                  stroke="#595DD2"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
          </>
        )}
        {corners.map((corner, i) => (
          <div
            key={i}
            className="absolute pointer-events-none w-[10px] h-[10px] rounded-[2px] bg-white border-2 border-[#595DD2]"
            style={{ left: corner.x - 5, top: corner.y - 5, cursor: CORNER_CURSORS[i] }}
          />
        ))}
        {selected.target === "title" &&
          edges.map((edge, i) => (
            <div
              key={`edge-${i}`}
              className="absolute pointer-events-none w-[10px] h-[10px] rounded-full bg-white border-2 border-[#595DD2]"
              style={{ left: edge.x - 5, top: edge.y - 5, cursor: edge.cursor }}
            />
          ))}
      </>
    );
  };

  const cursorForDrag = (): string => {
    if (!dragInfo) return hoverCursor;
    if (dragInfo.mode === "move" || dragInfo.mode === "rotate") return "grabbing";
    if (dragInfo.mode === "scale") return CORNER_CURSORS[dragInfo.corner ?? 0];

    return EDGE_CURSORS[dragInfo.edge ?? "s"];
  };

  const handleFiles = async (files: File[]) => {
    const images = files.filter((file) => file.type.startsWith("image/"));

    if (images.length === 0 || disabled || !item) return;

    const canvas = canvasRef.current;

    if (!canvas || !canvas.width) return;

    const layout = computePreviewLayout(canvas.width, canvas.height, style.textPosition === "top");
    const cx = layout.frame ? layout.phone.x + layout.phone.w / 2 : layout.workW / 2;
    const cy = layout.frame ? layout.phone.y + layout.phone.h / 2 : layout.workH / 2;
    const added: StudioOverlay[] = [];

    for (const file of images) {
      const uploaded = await uploadOverlayFile(file);

      if (!uploaded) continue;

      const size = await new Promise<{ w: number; h: number } | null>((resolve) => {
        const img = new Image();

        img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
        img.onerror = () => resolve(null);
        img.src = uploaded.url;
      });

      const fit = size ? Math.min(1, (layout.workW * 0.5) / size.w, (layout.workH * 0.5) / size.h) : 1;

      added.push({ id: uploaded.id, url: uploaded.url, x: Math.round(cx), y: Math.round(cy), scale: Math.max(0.1, fit), rotation: 0 });
    }

    if (added.length > 0) onOverlaysAdd(added);
  };

  const placementCenter = (): { x: number; y: number } | null => {
    const canvas = canvasRef.current;

    if (!canvas || !canvas.width) return null;

    const layout = computePreviewLayout(canvas.width, canvas.height, style.textPosition === "top");

    return layout.frame
      ? { x: Math.round(layout.phone.x + layout.phone.w / 2), y: Math.round(layout.phone.y + layout.phone.h / 2) }
      : { x: Math.round(layout.workW / 2), y: Math.round(layout.workH / 2) };
  };

  const rasterizeCaption = async (text: string): Promise<File | null> => {
    const canvas = canvasRef.current;

    if (!canvas || !canvas.width || text.trim().length === 0) return null;

    const layout = computePreviewLayout(canvas.width, canvas.height, style.textPosition === "top");
    const family = studioFontFamily(style.font);

    try {
      await document.fonts.load(`700 100px "${family}"`);
    } catch {
      return null;
    }

    const measurer = document.createElement("canvas").getContext("2d");

    if (!measurer) return null;

    if (style.titleBoxW > 0) {
      const step = TITLE_BASE_SIZE * style.titleScale * TITLE_LINE_HEIGHT;
      const lines = wrapTitleLines(measurer, text.trim(), family, TITLE_BASE_SIZE * style.titleScale, style.titleBoxW);

      if (lines.length === 0) return null;

      const size = TITLE_BASE_SIZE * style.titleScale;
      measurer.font = `700 ${size}px "${family}", system-ui, sans-serif`;

      const widths = lines.map((line) => measurer.measureText(line).width);
      const w = Math.ceil(Math.max(...widths)) + 16;
      const h = Math.ceil(step * lines.length) + 16;
      const c = document.createElement("canvas");

      c.width = w;
      c.height = h;

      const ctx = c.getContext("2d");

      if (!ctx) return null;

      ctx.font = `700 ${size}px "${family}", system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      ctx.fillStyle = style.textColor;

      lines.forEach((line, i) => {
        ctx.fillText(line, w / 2, 8 + step * i + size * 0.8);
      });

      const blob = await new Promise<Blob | null>((resolve) => c.toBlob(resolve, "image/png"));

      if (!blob) return null;

      return new File([blob], "caption.png", { type: "image/png" });
    }

    const tm = measureTitle(measurer, text.trim(), family, layout.workW, layout.pad, layout.space, style.titleScale);
    const padPx = Math.ceil(tm.size * 0.3) + 4;
    const c = document.createElement("canvas");

    c.width = Math.ceil(tm.w) + padPx * 2;
    c.height = Math.ceil(tm.h) + padPx * 2;

    const ctx = c.getContext("2d");

    if (!ctx) return null;

    ctx.font = `700 ${tm.size}px "${family}", system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = style.textColor;
    ctx.fillText(text.trim(), c.width / 2, padPx + tm.ascent);

    const blob = await new Promise<Blob | null>((resolve) => c.toBlob(resolve, "image/png"));

    if (!blob) return null;

    return new File([blob], "caption.png", { type: "image/png" });
  };

  useEffect(() => {
    const onCopy = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "c") return;

      const target = e.target as HTMLElement | null;

      if (target && target.closest("input, textarea, select, [contenteditable]")) return;
      if (disabled || !item) return;

      const overlay = overlays.find((entry) => entry.id === selectedOverlayId);

      if (overlay) {
        e.preventDefault();
        layerClipboardRef.current = { kind: "overlay", overlay: { ...overlay } };

        return;
      }

      if (layer === "image" || layer === "device") {
        e.preventDefault();
        layerClipboardRef.current = { kind: "image" };

        return;
      }

      if (layer === "caption" && title.trim().length > 0) {
        e.preventDefault();
        layerClipboardRef.current = { kind: "caption", text: title.trim() };
      }
    };

    window.addEventListener("keydown", onCopy);

    return () => window.removeEventListener("keydown", onCopy);
  });

  useEffect(() => {
    const onPaste = async (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;

      if (target && target.closest("input, textarea, select, [contenteditable]")) return;

      const files: File[] = [];

      for (const entry of Array.from(e.clipboardData?.items ?? [])) {
        if (entry.kind === "file" && entry.type.startsWith("image/")) {
          const file = entry.getAsFile();

          if (file) files.push(file);
        }
      }

      if (files.length > 0) {
        e.preventDefault();
        void handleFiles(files);

        return;
      }

      const snapshot = layerClipboardRef.current;

      if (!snapshot || disabled || !item) return;

      e.preventDefault();

      if (snapshot.kind === "overlay") {
        const duplicated = await duplicateOverlayFile(snapshot.overlay.id);

        if (duplicated) {
          onOverlaysAdd([
            {
              ...snapshot.overlay,
              id: duplicated.id,
              url: duplicated.url,
              x: snapshot.overlay.x + 32,
              y: snapshot.overlay.y + 32,
            },
          ]);
        }

        return;
      }

      if (snapshot.kind === "image") {
        if (!item.rawUrl) return;

        try {
          const res = await fetch(item.rawUrl, { credentials: "include" });

          if (!res.ok) return;

          const blob = await res.blob();
          const uploaded = await uploadOverlayFile(new File([blob], "paste.png", { type: blob.type || "image/png" }));
          const center = placementCenter();

          if (uploaded && center) {
            const size = await new Promise<{ w: number; h: number } | null>((resolve) => {
              const img = new Image();

              img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
              img.onerror = () => resolve(null);
              img.src = uploaded.url;
            });
            const canvas = canvasRef.current;
            const layout = canvas?.width
              ? computePreviewLayout(canvas.width, canvas.height, style.textPosition === "top")
              : null;
            const fit =
              size && layout
                ? Math.min(1, (layout.workW * 0.5) / size.w, (layout.workH * 0.5) / size.h)
                : 1;

            onOverlaysAdd([
              { id: uploaded.id, url: uploaded.url, x: center.x, y: center.y, scale: Math.max(0.1, fit), rotation: 0 },
            ]);
          }
        } catch {
          return;
        }

        return;
      }

      const captionFile = await rasterizeCaption(snapshot.text);

      if (!captionFile) return;

      const uploaded = await uploadOverlayFile(captionFile);

      if (!uploaded) return;

      const canvas = canvasRef.current;

      if (!canvas || !canvas.width) return;

      const layout = computePreviewLayout(canvas.width, canvas.height, style.textPosition === "top");

      onOverlaysAdd([
        {
          id: uploaded.id,
          url: uploaded.url,
          x: Math.round(layout.band.x + layout.band.w / 2 + style.titleOffsetX),
          y: Math.round(layout.band.y + layout.band.h / 2 + style.titleOffsetY),
          scale: 1,
          rotation: style.titleRotation || 0,
        },
      ]);
    };

    window.addEventListener("paste", onPaste);

    return () => window.removeEventListener("paste", onPaste);
  });

  return (
    <div className={cardCls}>
      <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onPrev}
            disabled={total < 2}
            title="Previous screenshot"
            className={`w-8 h-8 flex items-center justify-center rounded-lg border ${borderDefault} ${textSecondary} hover:text-[#595DD2] transition-colors disabled:opacity-40`}
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onNext}
            disabled={total < 2}
            title="Next screenshot"
            className={`w-8 h-8 flex items-center justify-center rounded-lg border ${borderDefault} ${textSecondary} hover:text-[#595DD2] transition-colors disabled:opacity-40`}
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          <span className={`text-[12px] ${textMuted} ml-1 font-mono`}>
            {total === 0 ? "0 / 0" : `${index + 1} / ${total}`}
          </span>
          <button
            type="button"
            onClick={onApplyToAll}
            disabled={disabled || total < 2}
            title="Apply this screenshot's positions and sizes to all screenshots of this set"
            className={`ml-2 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[12px] font-medium ${borderDefault} ${textSecondary} hover:text-[#595DD2] transition-colors disabled:opacity-40`}
          >
            <Copy className="w-3.5 h-3.5" />
            Apply to all
          </button>
          <button
            type="button"
            onClick={onUndo}
            disabled={disabled || !canUndo}
            title="Undo change (Cmd+Z)"
            className={`w-8 h-8 flex items-center justify-center rounded-lg border ${borderDefault} ${textSecondary} hover:text-[#595DD2] transition-colors disabled:opacity-40`}
          >
            <Undo2 className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onRedo}
            disabled={disabled || !canRedo}
            title="Redo change (Cmd+Shift+Z)"
            className={`w-8 h-8 flex items-center justify-center rounded-lg border ${borderDefault} ${textSecondary} hover:text-[#595DD2] transition-colors disabled:opacity-40`}
          >
            <Redo2 className="w-4 h-4" />
          </button>
        </div>
        <div className="flex items-center gap-1.5">
          <LocaleDropdown locales={locales} value={activeLocale} onChange={onLocaleChange} />
        </div>
      </div>

      {!item ? (
        <div className="flex h-96 items-center justify-center rounded-xl border border-dashed border-zinc-700 text-sm text-zinc-500">
          Select a screenshot to preview
        </div>
      ) : !item.rawUrl ? (
        <div className="flex h-96 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-zinc-700 text-center px-6">
          <p className={`text-sm ${textPrimary}`}>No stored source for this screenshot</p>
          <p className={`text-xs ${textMuted}`}>
            Older runs did not keep the raw device shot, caption editing needs a rerun
          </p>
        </div>
      ) : (
        <div
          ref={wrapRef}
          onDragOver={(e) => {
            if (disabled) return;

            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragActive(false);

            if (disabled) return;

            void handleFiles(Array.from(e.dataTransfer?.files ?? []));
          }}
          className={`relative flex items-center justify-center rounded-xl bg-zinc-950 p-4 min-h-[420px] ${
            dragActive ? "ring-2 ring-[#595DD2]" : ""
          }`}
        >
          <canvas
            ref={canvasRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={endDrag}
            style={{ touchAction: "none", cursor: disabled ? "default" : cursorForDrag() }}
            className="max-h-[62vh] max-w-full rounded object-contain shadow-lg"
          />
          {renderSelection()}
          {renderGuides()}
          {drawing && !dragInfo && (
            <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-zinc-950/60">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-600 border-t-white" />
            </div>
          )}
          {error && (
            <div className="absolute inset-x-4 top-4 rounded bg-red-950/90 px-3 py-2 text-xs text-red-200">
              Preview failed: {error}
            </div>
          )}
          {dragInfo && (
            <div className="absolute left-3 top-3 rounded bg-zinc-900/90 px-2 py-1 font-mono text-[11px] text-zinc-200">
              {dragInfo.target === "phone" ? "Phone" : dragInfo.target === "overlay" ? "Overlay" : "Title"}{" "}
              {dragInfo.mode === "move"
                ? `${formatOffset(dragInfo.target === "phone" ? style.offsetX : style.titleOffsetX)} / ${formatOffset(dragInfo.target === "phone" ? style.offsetY : style.titleOffsetY)}`
                : dragInfo.mode === "scale"
                  ? `${Math.round((dragInfo.target === "phone" ? style.deviceScale : style.titleScale) * 100)}%`
                  : dragInfo.mode === "rotate"
                    ? `${Math.round(dragInfo.angle ?? 0)}°`
                    : `${style.titleBoxW} × ${style.titleBoxH}`}
            </div>
          )}
          <div className="absolute bottom-2 right-3 rounded bg-zinc-900/80 px-2 py-0.5 text-[11px] text-zinc-400">
            Local preview
          </div>
        </div>
      )}
    </div>
  );
}
