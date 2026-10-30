import { Fragment, type ReactNode } from "react";
import { Image as ImageIcon, Smartphone, Square, TriangleAlert, Type, X } from "lucide-react";
import { thumbUrl } from "../../utils/screenshotUtils";
import { borderDefault, studioCardCls, textMuted, textPrimary, textSecondary } from "../../styles";
import type { StudioItem, StudioLayer, StudioOverlay, StudioStyle } from "./studioApi";

interface Props {
  item: StudioItem | null;
  title: string;
  style: StudioStyle;
  selectedLayer: StudioLayer | null;
  onSelectLayer: (layer: StudioLayer) => void;
  items: StudioItem[];
  titles: Record<string, string>;
  selectedBasename: string | null;
  onSelectScreenshot: (basename: string) => void;
  shotOverrides: Record<string, Partial<StudioStyle>>;
  overlays: StudioOverlay[];
  selectedOverlayId: string | null;
  onSelectOverlay: (id: string | null) => void;
  onDeleteOverlay: (id: string) => void;
  frameLabel: string | null;
}

export default function StudioLayers({
  item,
  title,
  style,
  selectedLayer,
  onSelectLayer,
  items,
  titles,
  selectedBasename,
  onSelectScreenshot,
  shotOverrides,
  overlays,
  selectedOverlayId,
  onSelectOverlay,
  onDeleteOverlay,
  frameLabel,
}: Props) {
  const fmt = (value: number) => (value > 0 ? `+${value}` : `${value}`);
  const layers: Array<{ id: StudioLayer; icon: typeof Type; name: string; detail: ReactNode }> = [
    {
      id: "caption",
      icon: Type,
      name: "Caption",
      detail: (
        <span className="truncate">
          {title || <span className={textMuted}>No caption</span>}
          {(style.titleOffsetX !== 0 || style.titleOffsetY !== 0) && (
            <span className={`ml-1.5 font-mono text-[11px] ${textMuted}`}>
              {fmt(style.titleOffsetX)}/{fmt(style.titleOffsetY)}
            </span>
          )}
          {style.titleScale !== 1 && (
            <span className={`ml-1.5 font-mono text-[11px] ${textMuted}`}>{Math.round(style.titleScale * 100)}%</span>
          )}
          {style.titleBoxW > 0 && (
            <span className={`ml-1.5 font-mono text-[11px] ${textMuted}`}>
              {style.titleBoxW}×{style.titleBoxH > 0 ? style.titleBoxH : "auto"}
            </span>
          )}
        </span>
      ),
    },
    {
      id: "image",
      icon: ImageIcon,
      name: "Image",
      detail: (
        <span className="truncate">
          {item?.deviceLabel ?? "—"}
          {(style.offsetX !== 0 || style.offsetY !== 0) && (
            <span className={`ml-1.5 font-mono text-[11px] ${textMuted}`}>
              {fmt(style.offsetX)}/{fmt(style.offsetY)}
            </span>
          )}
          {style.deviceScale !== 1 && (
            <span className={`ml-1.5 font-mono text-[11px] ${textMuted}`}>{Math.round(style.deviceScale * 100)}%</span>
          )}
        </span>
      ),
    },
    {
      id: "device",
      icon: Smartphone,
      name: "Device",
      detail: <span className="truncate">{frameLabel ?? item?.deviceLabel ?? "—"}</span>,
    },
    {
      id: "background",
      icon: Square,
      name: "Background",
      detail: (
        <span
          className="w-full h-5 rounded-md border border-black/10"
          style={{ background: `linear-gradient(135deg, ${style.bgColor1}, ${style.bgColor2})` }}
        />
      ),
    },
  ];

  const renderLayerButton = (layer: (typeof layers)[number]) => (
    <button
      key={layer.id}
      type="button"
      onClick={() => onSelectLayer(layer.id)}
      className={`flex items-center gap-2.5 rounded-xl border px-2.5 py-2 text-left transition-all ${
        selectedLayer === layer.id && !selectedOverlayId
          ? "border-[#595DD2] ring-1 ring-[#595DD2] bg-[#595DD2]/5"
          : `${borderDefault} hover:border-gray-300 dark:hover:border-[#3a4050]`
      }`}
    >
      <layer.icon className="w-4 h-4 text-[#595DD2] shrink-0" />
      <span className={`text-[12px] font-medium ${textSecondary} w-[68px] shrink-0`}>{layer.name}</span>
      <span className={`flex-1 text-[12px] ${textPrimary} min-w-0 flex`}>{layer.detail}</span>
    </button>
  );

  return (
    <div className="flex flex-col gap-5">
      <div className={studioCardCls}>
        <div className={`text-[13px] font-semibold ${textPrimary} mb-2.5`}>Layers</div>
        <div className="flex flex-col gap-1.5">
          {renderLayerButton(layers[0])}
          {overlays.map((overlay, overlayIndex) => {
            const selected = selectedOverlayId === overlay.id;

            return (
              <button
                key={overlay.id}
                type="button"
                onClick={() => onSelectOverlay(overlay.id)}
                className={`flex items-center gap-2.5 rounded-xl border px-2.5 py-2 text-left transition-all ${
                  selected
                    ? "border-[#595DD2] ring-1 ring-[#595DD2] bg-[#595DD2]/5"
                    : `${borderDefault} hover:border-gray-300 dark:hover:border-[#3a4050]`
                }`}
              >
                <img
                  src={overlay.url}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="w-4 h-4 rounded object-cover shrink-0 border border-black/10"
                />
                <span className={`text-[12px] font-medium ${textSecondary} w-[68px] shrink-0`}>
                  Overlay {overlayIndex + 1}
                </span>
                <span className={`flex-1 text-[12px] font-mono ${textMuted} min-w-0 truncate`}>
                  {Math.round(overlay.scale * 100)}%
                </span>
                <span
                  role="button"
                  tabIndex={0}
                  title="Delete overlay"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteOverlay(overlay.id);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.stopPropagation();
                      onDeleteOverlay(overlay.id);
                    }
                  }}
                  className={`w-6 h-6 flex items-center justify-center rounded-md ${textMuted} hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors shrink-0`}
                >
                  <X className="w-3.5 h-3.5" />
                </span>
              </button>
            );
          })}
          {layers.slice(1).map(renderLayerButton)}
        </div>
      </div>

      <div className={studioCardCls}>
        <div className={`text-[13px] font-semibold ${textPrimary} mb-2.5`}>Screenshots</div>
        <div className="flex flex-col gap-1.5 max-h-[52vh] overflow-y-auto pr-0.5">
          {items.map((shot, index) => {
            const selected = selectedBasename === shot.basename;
            const draft = titles[shot.basename] ?? shot.title;
            const changed = draft !== shot.title;
            const noSource = !shot.hasRaw;
            const showDeviceHeader = index === 0 || items[index - 1].deviceLabel !== shot.deviceLabel;

            return (
              <Fragment key={shot.basename}>
              {showDeviceHeader && (
                <div className={`text-[11px] font-medium ${textMuted} px-1 pt-1.5`}>{shot.deviceLabel}</div>
              )}
              <button
                type="button"
                onClick={() => onSelectScreenshot(shot.basename)}
                className={`flex items-center gap-2.5 rounded-xl border px-2 py-1.5 text-left transition-all ${
                  selected
                    ? "border-[#595DD2] ring-1 ring-[#595DD2] bg-[#595DD2]/5"
                    : `${borderDefault} hover:border-gray-300 dark:hover:border-[#3a4050]`
                }`}
              >
                <img
                  src={thumbUrl(shot.url, 200)}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="h-14 w-auto rounded-md border border-[#eef0f3] object-cover shrink-0"
                />
                <span className="flex-1 min-w-0">
                  <span className={`block text-[12px] leading-tight truncate ${textPrimary}`}>
                    {changed && <span className="text-[#595DD2] font-bold mr-1">•</span>}
                    {draft || <span className={textMuted}>No caption</span>}
                  </span>
                  <span className={`block text-[11px] ${textMuted} mt-0.5`}>
                    {shot.deviceLabel}
                    {shotOverrides[shot.basename] && (
                      <span className="ml-1.5 text-[#595DD2]" title="Custom positions for this screenshot">
                        ◆
                      </span>
                    )}
                  </span>
                </span>
                {noSource && (
                  <span title="No editable source stored">
                    <TriangleAlert className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                  </span>
                )}
              </button>
              </Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
}
