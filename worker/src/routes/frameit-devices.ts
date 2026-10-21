import fs from "fs";
import os from "os";
import path from "path";

export interface FrameitDevice {
  bezelFile: string;
  offsetX: number;
  offsetY: number;
  width: number;
  roundedScreenCorners: boolean;
}

export const FRAMEIT_ASSETS_DIR = path.join(os.homedir(), ".fastlane", "frameit", "latest");

interface DeviceEntry {
  match: string;
  resolutions: Array<[number, number]>;
  device: FrameitDevice;
}

const DEVICES_MOST_SPECIFIC_FIRST: DeviceEntry[] = [
  {
    match: "iPhone 16 Pro Max",
    resolutions: [
      [1320, 2868],
      [2868, 1320],
    ],
    device: {
      bezelFile: "Apple iPhone 16 Pro Max Natural Titanium.png",
      offsetX: 75,
      offsetY: 66,
      width: 1320,
      roundedScreenCorners: true,
    },
  },
  {
    match: "iPhone 16",
    resolutions: [
      [1179, 2556],
      [2556, 1179],
    ],
    device: {
      bezelFile: "Apple iPhone 16 Black.png",
      offsetX: 90,
      offsetY: 90,
      width: 1179,
      roundedScreenCorners: true,
    },
  },
  {
    match: "iPhone SE",
    resolutions: [
      [750, 1334],
      [1334, 750],
    ],
    device: {
      bezelFile: "Apple iPhone 8 Space Gray.png",
      offsetX: 61,
      offsetY: 219,
      width: 750,
      roundedScreenCorners: false,
    },
  },
  {
    match: "iPad Pro (12.9-inch) (4th generation)",
    resolutions: [
      [2048, 2732],
      [2732, 2048],
    ],
    device: {
      bezelFile: "Apple iPad Pro (12.9-inch) (4th generation) Space Gray.png",
      offsetX: 96,
      offsetY: 102,
      width: 2048,
      roundedScreenCorners: false,
    },
  },
];

export function resolveDevice(filename: string, width: number, height: number): FrameitDevice | null {
  for (const entry of DEVICES_MOST_SPECIFIC_FIRST) {
    if (filename.includes(entry.match)) return entry.device;
  }

  for (const entry of DEVICES_MOST_SPECIFIC_FIRST) {
    const hit = entry.resolutions.some(([w, h]) => w === width && h === height);

    if (hit) return entry.device;
  }

  return null;
}

const bezelCache = new Map<string, Promise<Buffer>>();

export function loadBezelImage(device: FrameitDevice): Promise<Buffer> {
  const cached = bezelCache.get(device.bezelFile);

  if (cached) return cached;

  const promise = fs.promises.readFile(path.join(FRAMEIT_ASSETS_DIR, device.bezelFile));
  bezelCache.set(device.bezelFile, promise);

  return promise;
}
