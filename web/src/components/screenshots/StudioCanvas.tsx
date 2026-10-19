import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Copy } from "lucide-react";
import { borderDefault, cardCls, textMuted, textPrimary, textSecondary } from "../../styles";
import { getLocaleName } from "../../utils/localeUtils";
import type { StudioItem, StudioLayer, StudioStyle } from "./studioApi";
import { computePreviewLayout, drawStudioPreview, type PreviewRect } from "./studioPreview";
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
}

type DragState =
  | { mode: "move"; target: "phone" | "title"; startClientX: number; startClientY: number; origX: number; origY: number }
  | { mode: "scale"; target: "phone" | "title"; centerX: number; centerY: number; origDist: number; origScale: number; corner: number }
  | { mode: "resize"; edge: CanvasEdge; centerX: number; centerY: number; origW: number };

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
}: StudioCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const downRef = useRef<{ x: number; y: number; hit: boolean } | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragInfo, setDragInfo] = useState<{
    mode: "move" | "scale" | "resize";
    target: "phone" | "title";
    corner?: number;
    edge?: CanvasEdge;
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
    const canvas = canvasRef.current;

    if (!canvas || !rawUrl) return;

    let cancelled = false;
    setDrawing(true);

    drawStudioPreview(canvas, { rawUrl, title, style })
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
  }, [rawUrl, title, style]);

  const canvasBox = () => canvasGeom.canvasBox(canvasRef.current, wrapRef.current);
  const workToCss = (rect: PreviewRect) => canvasGeom.workToCss(canvasRef.current, wrapRef.current, rect, style);
  const cssToWork = (clientX: number, clientY: number) => canvasGeom.cssToWork(canvasRef.current, clientX, clientY, style);
  const selectedWorkRect = () => canvasGeom.selectedWorkRect(canvasRef.current, layer, title, style);
  const pickHandle = (clientX: number, clientY: number) =>
    canvasGeom.pickHandle(canvasRef.current, wrapRef.current, clientX, clientY, layer, title, style);

  const pickTarget = (clientX: number, clientY: number) =>
    canvasGeom.pickTarget(canvasRef.current, clientX, clientY, layer, style);

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled || e.button !== 0) return;

    const handle = pickHandle(e.clientX, e.clientY);

    if (handle) {
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

    onSelectLayer(target === "phone" ? "device" : "caption");
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      mode: "move",
      target,
      startClientX: e.clientX,
      startClientY: e.clientY,
      origX: target === "phone" ? style.offsetX : style.titleOffsetX,
      origY: target === "phone" ? style.offsetY : style.titleOffsetY,
    };
    setDragInfo({ mode: "move", target });

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
        setHoverCursor("corner" in handle ? CORNER_CURSORS[handle.corner] : EDGE_CURSORS[handle.edge]);
        return;
      }

      setHoverCursor(pickTarget(e.clientX, e.clientY) ? "move" : "default");

      return;
    }

    if (drag.mode === "scale") {
      const point = cssToWork(e.clientX, e.clientY);

      if (!point) return;

      const dist = Math.max(1, Math.hypot(point.x - drag.centerX, point.y - drag.centerY));
      let k = (dist / drag.origDist) * drag.origScale;

      if (Math.abs(k - 1) < 0.015) k = 1;

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
    if (dragInfo.mode === "move") return "grabbing";
    if (dragInfo.mode === "scale") return CORNER_CURSORS[dragInfo.corner ?? 0];

    return EDGE_CURSORS[dragInfo.edge ?? "s"];
  };

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
        </div>
        <div className="flex items-center gap-1.5">
          <select
            value={activeLocale}
            onChange={(e) => onLocaleChange(e.target.value)}
            title="Preview locale"
            className={`px-2.5 py-1.5 rounded-lg text-[12px] font-medium border bg-transparent cursor-pointer ${borderDefault} ${textSecondary}`}
          >
            {locales.map((locale) => (
              <option key={locale} value={locale} title={locale}>
                {getLocaleName(locale)}
              </option>
            ))}
          </select>
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
        <div ref={wrapRef} className="relative flex items-center justify-center rounded-xl bg-zinc-950 p-4 min-h-[420px]">
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
              {dragInfo.target === "phone" ? "Phone" : "Title"}{" "}
              {dragInfo.mode === "move"
                ? `${formatOffset(dragInfo.target === "phone" ? style.offsetX : style.titleOffsetX)} / ${formatOffset(dragInfo.target === "phone" ? style.offsetY : style.titleOffsetY)}`
                : dragInfo.mode === "scale"
                  ? `${Math.round((dragInfo.target === "phone" ? style.deviceScale : style.titleScale) * 100)}%`
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
