export interface FramedJob {
  id: string;
  commitSha: string;
  commitMessage: string | null;
  branch: string | null;
  createdAt: string;
  framedByLocale: Record<string, string[]>;
}

export const DEVICES: [RegExp, string][] = [
  [/iphone[_-]?6\.9/i, 'iPhone 6.9"'],
  [/iphone[_-]?6\.7/i, 'iPhone 6.7"'],
  [/iphone[_-]?6\.5/i, 'iPhone 6.5"'],
  [/iphone[_-]?6\.3/i, 'iPhone 6.3"'],
  [/iphone[_-]?5\.5/i, 'iPhone 5.5"'],
  [/iphone[_-]?4\.7/i, 'iPhone 4.7"'],
  [/ipad[_-]?13/i, 'iPad 13"'],
  [/ipad[_-]?12\.9/i, 'iPad 12.9"'],
  [/ipad[_-]?11/i, 'iPad 11"'],
  [/ipad/i, "iPad"],
];

export function getDeviceLabel(url: string): string {
  const filename = decodeURIComponent(url.split("/").pop() ?? url);

  for (const [re, label] of DEVICES) {
    if (re.test(filename)) return label;
  }
  return "Other";
}

export function thumbUrl(url: string, width: 200 | 300 | 400 | 600 | 800): string {
  const rel = url.replace(/^\/screenshots\//, "");
  if (rel === url) return url;
  return `/screenshots-thumb/${width}/${rel}`;
}
