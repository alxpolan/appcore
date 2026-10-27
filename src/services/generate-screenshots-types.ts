import type { Prisma } from "@prisma/client";

export type ScreenshotJobWithApp = Prisma.ScreenshotJobGetPayload<{ include: { app: true } }>;

export type VersionLocale = {
  locale: string;
  name?: string;
  subtitle?: string;
  keywords?: string;
};
