import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { zoomCanvasAtPoint, type CanvasViewport } from "../web/src/components/screenshots/studioCanvasGeometry";

const viewport = { left: 264, top: 64, width: 800, height: 600 };
const center = { x: 664, y: 364 };
const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

function screenPoint(view: CanvasViewport, point: { x: number; y: number }) {
  return {
    x: center.x + view.pan.x + point.x * view.zoom,
    y: center.y + view.pan.y + point.y * view.zoom,
  };
}

describe("Studio cursor-centered zoom", () => {
  it("keeps the center fixed instead of drifting toward the sidebar", () => {
    const result = zoomCanvasAtPoint({ pan: { x: 0, y: 0 }, zoom: 1 }, viewport, center, 2);
    assert.deepEqual(result, { zoom: 2, pan: { x: 0, y: 0 } });
  });

  it("anchors off-center points despite the viewport's page offset", () => {
    const view = { pan: { x: 0, y: 0 }, zoom: 1 };
    const point = { x: 100, y: -80 };
    const pointer = screenPoint(view, point);
    const result = zoomCanvasAtPoint(view, viewport, pointer, 2);
    assert.deepEqual(result.pan, { x: -100, y: 80 });
    assert.deepEqual(screenPoint(result, point), pointer);
  });

  it("keeps the hovered point fixed after panning and zooming already", () => {
    const view = { pan: { x: 130, y: -75 }, zoom: 1.5 };
    const point = { x: -170, y: 95 };
    const pointer = screenPoint(view, point);
    const result = zoomCanvasAtPoint(view, viewport, pointer, 0.75);
    close(screenPoint(result, point).x, pointer.x);
    close(screenPoint(result, point).y, pointer.y);
    const restored = zoomCanvasAtPoint(result, viewport, pointer, view.zoom);
    close(restored.pan.x, view.pan.x);
    close(restored.pan.y, view.pan.y);
  });

  it("uses the clamped zoom when anchoring and stays still at the limits", () => {
    const view = { pan: { x: 40, y: -20 }, zoom: 1 };
    const point = { x: 75, y: 100 };
    const pointer = screenPoint(view, point);
    for (const [requested, expected] of [[100, 4], [0, 0.25]]) {
      const result = zoomCanvasAtPoint(view, viewport, pointer, requested);
      assert.equal(result.zoom, expected);
      close(screenPoint(result, point).x, pointer.x);
      close(screenPoint(result, point).y, pointer.y);
      assert.strictEqual(zoomCanvasAtPoint(result, viewport, pointer, requested), result);
    }
  });

  it("preserves the anchor across a sequence of small pinch updates", () => {
    let view: CanvasViewport = { pan: { x: 30, y: 40 }, zoom: 1 };
    const point = { x: 90, y: -40 };
    const pointer = screenPoint(view, point);
    for (let i = 0; i < 100; i++) {
      view = zoomCanvasAtPoint(view, viewport, pointer, view.zoom * Math.exp(-0.005));
      close(screenPoint(view, point).x, pointer.x);
      close(screenPoint(view, point).y, pointer.y);
    }
  });
});
