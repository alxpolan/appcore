import fs from "fs";

type FontCandidate = {
  test: RegExp;
  paths: string[];
};

export const STUDIO_FRAMEIT_FONTS: Record<string, string> = {
  rounded: "ArialRoundedBold.ttf",
  inter: "Inter-Bold.ttf",
  baloo: "Baloo2-Bold.ttf",
};

const WIDE_LATIN_FONTS = [
  "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
  "/System/Library/Fonts/Supplemental/Arial.ttf",
  "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
  "/Library/Fonts/Arial Bold.ttf",
  "/Library/Fonts/Arial.ttf",
  "/Library/Fonts/Arial Unicode.ttf",
  "/System/Library/Fonts/Supplemental/Tahoma Bold.ttf",
  "/System/Library/Fonts/Supplemental/Tahoma.ttf",
  "/System/Library/Fonts/Supplemental/Verdana Bold.ttf",
  "/System/Library/Fonts/Supplemental/Verdana.ttf",
  "/System/Library/Fonts/Helvetica.ttc",
  "/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf",
  "/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf",
];

const FONT_CANDIDATES: FontCandidate[] = [
  {
    test: /[\u0900-\u097F]/u,
    paths: [
      "/System/Library/Fonts/Supplemental/ITFDevanagari.ttc",
      "/System/Library/Fonts/Supplemental/DevanagariMT.ttc",
      "/System/Library/Fonts/Supplemental/Devanagari Sangam MN.ttc",
      "/System/Library/Fonts/Kohinoor.ttc",
      "/System/Library/Fonts/SFIndia.ttc",
      "/usr/share/fonts/truetype/noto/NotoSansDevanagari-Regular.ttf",
    ],
  },
  {
    test: /[\u0980-\u09FF]/u,
    paths: [
      "/System/Library/Fonts/KohinoorBangla.ttc",
      "/System/Library/Fonts/Supplemental/Bangla Sangam MN.ttc",
      "/usr/share/fonts/truetype/noto/NotoSansBengali-Regular.ttf",
    ],
  },
  {
    test: /[\u0A00-\u0A7F]/u,
    paths: [
      "/System/Library/Fonts/Supplemental/Gurmukhi MN.ttc",
      "/System/Library/Fonts/Supplemental/Gurmukhi Sangam MN.ttc",
      "/usr/share/fonts/truetype/noto/NotoSansGurmukhi-Regular.ttf",
    ],
  },
  {
    test: /[\u0A80-\u0AFF]/u,
    paths: ["/System/Library/Fonts/KohinoorGujarati.ttc", "/usr/share/fonts/truetype/noto/NotoSansGujarati-Regular.ttf"],
  },
  {
    test: /[\u0B00-\u0B7F]/u,
    paths: ["/System/Library/Fonts/NotoSansOriya.ttc", "/usr/share/fonts/truetype/noto/NotoSansOriya-Regular.ttf"],
  },
  {
    test: /[\u0B80-\u0BFF]/u,
    paths: [
      "/System/Library/Fonts/Supplemental/Tamil Sangam MN.ttc",
      "/usr/share/fonts/truetype/noto/NotoSansTamil-Regular.ttf",
    ],
  },
  {
    test: /[\u0C00-\u0C7F]/u,
    paths: ["/System/Library/Fonts/KohinoorTelugu.ttc", "/usr/share/fonts/truetype/noto/NotoSansTelugu-Regular.ttf"],
  },
  {
    test: /[\u0C80-\u0CFF]/u,
    paths: ["/System/Library/Fonts/NotoSansKannada.ttc", "/usr/share/fonts/truetype/noto/NotoSansKannada-Regular.ttf"],
  },
  {
    test: /[\u0D00-\u0D7F]/u,
    paths: [
      "/System/Library/Fonts/Supplemental/Malayalam Sangam MN.ttc",
      "/usr/share/fonts/truetype/noto/NotoSansMalayalam-Regular.ttf",
    ],
  },
  {
    test: /[\u0D80-\u0DFF]/u,
    paths: [
      "/System/Library/Fonts/Supplemental/Sinhala Sangam MN.ttc",
      "/System/Library/Fonts/Supplemental/Sinhala MN.ttc",
      "/usr/share/fonts/truetype/noto/NotoSansSinhala-Regular.ttf",
    ],
  },
  {
    test: /[\u4E00-\u9FFF\u3400-\u4DBF\u3040-\u30FF]/u,
    paths: [
      "/System/Library/Fonts/STHeiti Medium.ttc",
      "/System/Library/Fonts/Hiragino Sans GB.ttc",
      "/System/Library/Fonts/CJKSymbolsFallback.ttc",
      "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    ],
  },
  {
    test: /[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/u,
    paths: ["/System/Library/Fonts/AppleSDGothicNeo.ttc", "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"],
  },
  {
    test: /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/u,
    paths: [
      "/System/Library/Fonts/SFArabicRounded.ttf",
      "/System/Library/Fonts/SFArabic.ttf",
      "/System/Library/Fonts/GeezaPro.ttc",
      "/usr/share/fonts/truetype/noto/NotoSansArabic-Regular.ttf",
    ],
  },
  {
    test: /[\u0E00-\u0E7F]/u,
    paths: [
      "/System/Library/Fonts/Supplemental/Krungthep.ttf",
      "/usr/share/fonts/truetype/noto/NotoSansThai-Regular.ttf",
    ],
  },
  {
    test: /[\u0590-\u05FF]/u,
    paths: [
      "/System/Library/Fonts/Supplemental/Raanana.ttc",
      "/System/Library/Fonts/ArialHB.ttc",
      "/usr/share/fonts/truetype/noto/NotoSansHebrew-Regular.ttf",
    ],
  },
  {
    test: /[\u0400-\u04FF\u0500-\u052F]/u,
    paths: [
      "/System/Library/Fonts/Supplemental/PTSans.ttc",
      "/System/Library/Fonts/Supplemental/PTSerif.ttc",
      "/System/Library/Fonts/Supplemental/Arial.ttf",
      "/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf",
    ],
  },
  {
    test: /[\u0370-\u03FF\u1F00-\u1FFF]/u,
    paths: WIDE_LATIN_FONTS,
  },
  {
    test: /[\u0100-\u024F\u1E00-\u1EFF]/u,
    paths: WIDE_LATIN_FONTS,
  },
];

export function pickFrameitFont(text: string, familyFont: string): string {
  for (const candidate of FONT_CANDIDATES) {
    if (!candidate.test.test(text)) continue;
    const found = candidate.paths.find((fontPath) => fs.existsSync(fontPath));
    if (found) return found;
  }

  if (/[Ā-￿]/u.test(text)) {
    const wide = WIDE_LATIN_FONTS.find((fontPath) => fs.existsSync(fontPath));
    if (wide) return wide;
  }

  return familyFont;
}
