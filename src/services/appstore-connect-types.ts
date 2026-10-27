export interface ASCAppInfo {
  id: string;
  type: string;
  attributes: {
    name: string;
    bundleId: string;
    sku: string;
    primaryLocale: string;
  };
}

export interface ASCAppInfoLocalization {
  id: string;
  attributes: {
    locale: string;
    name: string;
    subtitle?: string;
    privacyPolicyUrl?: string;
  };
}

export interface ASCAppStoreVersion {
  id: string;
  attributes: {
    versionString: string;
    appStoreState: string;
    platform: string;
    releaseType: string;
    copyright?: string;
  };
}

export interface ASCVersionLocalization {
  id: string;
  attributes: {
    locale: string;
    description?: string;
    keywords?: string;
    whatsNew?: string;
    promotionalText?: string;
    marketingUrl?: string;
    supportUrl?: string;
  };
}

export interface ASCScreenshotSet {
  id: string;
  attributes: {
    screenshotDisplayType: string;
  };
}

export interface ASCUploadOperation {
  method: string;
  url: string;
  length: number;
  offset: number;
  requestHeaders: { name: string; value: string }[];
}

export interface ASCScreenshot {
  id: string;
  attributes: {
    uploadOperations: ASCUploadOperation[];
  };
}

export interface ASCImageAsset {
  templateUrl: string;
  width: number;
  height: number;
}

export interface ASCScreenshotWithAsset {
  id: string;
  attributes: {
    fileName?: string;
    fileSize?: number;
    sourceFileChecksum?: string;
    imageAsset?: ASCImageAsset | null;
    assetDeliveryState?: { state?: string } | null;
  };
}

export interface ASCCustomProductPage {
  id: string;
  attributes: {
    name: string;
    url?: string;
    visible?: boolean;
  };
}

export interface ASCCustomProductPageVersion {
  id: string;
  attributes: {
    version?: string;
    state?: string;
    deepLink?: string;
  };
}

export interface ASCCustomProductPageLocalization {
  id: string;
  attributes: {
    locale: string;
    promotionalText?: string;
  };
}

export interface ASCCredentials {
  issuerId: string;
  keyId: string;
  privateKey: string;
}

export interface ASCRateLimit {
  hourLimit: number;
  hourRemaining: number;
  updatedAt: Date;
}

export function parseRateLimitHeader(header: string): { limit: number; remaining: number } | null {
  const lim = header.match(/user-hour-lim:(\d+)/)?.[1];
  const rem = header.match(/user-hour-rem:(\d+)/)?.[1];
  if (!lim || !rem) return null;

  return { limit: parseInt(lim, 10), remaining: parseInt(rem, 10) };
}
