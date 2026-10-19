import type { PreviewLayout } from "./studioPreview";

export interface SnapGuides {
  vCenter: boolean;
  hCenter: boolean;
  smartV: number | null;
  smartH: number | null;
}

export interface SnapResult {
  x: number;
  y: number;
  guides: SnapGuides;
}

interface Candidate {
  t: number;
  rank: number;
  center: boolean;
}

function snapAxis(home: number, raw: number, candidates: Candidate[], threshold: number): { value: number; winner: Candidate | null } {
  const ordered = [...candidates].sort(
    (a, b) => Math.abs(home + raw - a.t) - Math.abs(home + raw - b.t) || a.rank - b.rank,
  );

  for (const candidate of ordered) {
    if (Math.abs(home + raw - candidate.t) <= threshold) {
      return { value: candidate.t - home, winner: candidate };
    }
  }

  return { value: raw, winner: null };
}

export function snapOffset(
  target: "phone" | "title",
  rawX: number,
  rawY: number,
  layout: PreviewLayout,
  peer: { x: number; y: number },
  threshold: number,
): SnapResult {
  const canvasCX = layout.workW / 2;
  const canvasCY = layout.workH / 2;
  const phoneCX = layout.phone.x + layout.phone.w / 2;
  const phoneCY = layout.phone.y + layout.phone.h / 2;
  const titleCX = layout.workW / 2;
  const titleCY = layout.band.y + layout.band.h / 2;
  const peerCX = (target === "phone" ? titleCX : phoneCX) + peer.x;
  const peerCY = (target === "phone" ? titleCY : phoneCY) + peer.y;
  const homeX = target === "phone" ? phoneCX : titleCX;
  const homeY = target === "phone" ? phoneCY : titleCY;

  const snappedX = snapAxis(
    homeX,
    rawX,
    [
      { t: canvasCX, rank: 0, center: true },
      { t: peerCX, rank: 1, center: false },
      { t: homeX, rank: 2, center: false },
    ],
    threshold,
  );
  const snappedY = snapAxis(
    homeY,
    rawY,
    [
      { t: canvasCY, rank: 0, center: true },
      { t: peerCY, rank: 1, center: false },
      { t: homeY, rank: 2, center: false },
    ],
    threshold,
  );

  return {
    x: snappedX.value,
    y: snappedY.value,
    guides: {
      vCenter: snappedX.winner?.center ?? false,
      hCenter: snappedY.winner?.center ?? false,
      smartV: snappedX.winner && !snappedX.winner.center ? snappedX.winner.t : null,
      smartH: snappedY.winner && !snappedY.winner.center ? snappedY.winner.t : null,
    },
  };
}
