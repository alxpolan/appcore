import fs from "fs";
import os from "os";
import path from "path";
import sharp from "sharp";

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
  const entry = resolveDeviceEntry(filename, width, height);

  return entry ? entry.device : null;
}

export function resolveDeviceEntry(filename: string, width: number, height: number): DeviceEntry | null {
  for (const entry of DEVICES_MOST_SPECIFIC_FIRST) {
    if (filename.includes(entry.match)) return entry;
  }

  for (const entry of DEVICES_MOST_SPECIFIC_FIRST) {
    const hit = entry.resolutions.some(([w, h]) => w === width && h === height);

    if (hit) return entry;
  }

  return null;
}

let bezelFileCache: Promise<string[]> | null = null;

export function listBezelFiles(): Promise<string[]> {
  if (!bezelFileCache) {
    bezelFileCache = fs.promises
      .readdir(FRAMEIT_ASSETS_DIR)
      .catch(() => [] as string[])
      .then((entries) => entries.filter((file) => file.toLowerCase().endsWith(".png")).sort());
  }

  return bezelFileCache;
}

export function bezelColorLabel(file: string, match: string): string {
  const withoutExtension = file.replace(/\.png$/i, "");
  const withoutBrand = withoutExtension.replace(/^Apple\s+/, "");

  if (withoutBrand.toLowerCase().startsWith(match.toLowerCase())) {
    const color = withoutBrand.slice(match.length).trim();

    if (color) return color;
  }

  return withoutBrand;
}

export interface BezelOption {
  file: string;
  color: string;
}

export interface BezelImageOption extends BezelOption {
  frameW: number;
  frameH: number;
}

export interface BezelDeviceInfo {
  offsetX: number;
  offsetY: number;
  width: number;
  rounded: boolean;
}

export function groupBezelFiles(files: string[]): Array<{ match: string; options: BezelOption[] }> {
  const groups = new Map<string, BezelOption[]>();
  const other: BezelOption[] = [];

  for (const file of files) {
    const entry = DEVICES_MOST_SPECIFIC_FIRST.find((candidate) =>
      file.toLowerCase().includes(candidate.match.toLowerCase()),
    );

    if (!entry) {
      other.push({ file, color: bezelColorLabel(file, "") });
      continue;
    }

    const list = groups.get(entry.match) ?? [];
    list.push({ file, color: bezelColorLabel(file, entry.match) });
    groups.set(entry.match, list);
  }

  const ordered = DEVICES_MOST_SPECIFIC_FIRST.filter((entry) => groups.has(entry.match)).map((entry) => ({
    match: entry.match,
    options: groups.get(entry.match) ?? [],
  }));

  if (other.length > 0) ordered.push({ match: "Other", options: other });

  return ordered;
}

export async function bezelsForDevice(
  filename: string,
  width: number,
  height: number,
): Promise<{ current: string | null; options: BezelImageOption[]; device: BezelDeviceInfo | null }> {
  const entry = resolveDeviceEntry(filename, width, height);
  const files = await listBezelFiles();

  if (!entry) {
    return {
      current: null,
      options: await withBezelDims(files.map((file) => ({ file, color: bezelColorLabel(file, "") }))),
      device: null,
    };
  }

  const prefix = entry.match.toLowerCase();
  const seen = new Set<string>();
  const plain: BezelOption[] = [];

  for (const file of [...files, entry.device.bezelFile]) {
    if (seen.has(file)) continue;

    seen.add(file);

    if (file !== entry.device.bezelFile && !file.toLowerCase().includes(prefix)) continue;

    plain.push({ file, color: bezelColorLabel(file, entry.match) });
  }

  return {
    current: entry.device.bezelFile,
    options: await withBezelDims(plain),
    device: {
      offsetX: entry.device.offsetX,
      offsetY: entry.device.offsetY,
      width: entry.device.width,
      rounded: entry.device.roundedScreenCorners,
    },
  };
}

async function withBezelDims(options: BezelOption[]): Promise<BezelImageOption[]> {
  const out: BezelImageOption[] = [];

  for (const option of options) {
    try {
      const meta = await sharp(path.join(FRAMEIT_ASSETS_DIR, option.file)).metadata();

      if (!meta.width || !meta.height) continue;

      out.push({ ...option, frameW: meta.width, frameH: meta.height });
    } catch {
      continue;
    }
  }

  return out;
}

const bezelCache = new Map<string, Promise<Buffer>>();

export function loadBezelImage(device: FrameitDevice): Promise<Buffer> {
  const cached = bezelCache.get(device.bezelFile);

  if (cached) return cached;

  const promise = fs.promises.readFile(path.join(FRAMEIT_ASSETS_DIR, device.bezelFile));

  bezelCache.set(device.bezelFile, promise);

  return promise;
}
