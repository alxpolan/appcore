import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  DATABASE_URL: z.string().url(),

  // Auth
  JWT_SECRET: z.string().min(32),
  WEBAUTHN_RP_ID: z.string(),
  WEBAUTHN_RP_NAME: z.string(),
  WEBAUTHN_ORIGIN: z.string(),

  // Apple Search Ads
  APPLE_ADS_CLIENT_ID: z.string().optional(),
  APPLE_ADS_KEY_PATH: z.string().default("./keys/apple_ads_private_key.pem"),
  APPLE_ADS_KEY_ID: z.string().optional(),
  APPLE_ADS_TEAM_ID: z.string().optional(),
  APPLE_ADS_ORG_ID: z.string().optional(),

  // APNs
  APNS_KEY_ID: z.string().optional(),
  APNS_TEAM_ID: z.string().optional(),
  APNS_BUNDLE_ID: z.string().default("com.fringelo.marteso.Marteso"),
  APNS_KEY_PATH: z.string().default("./keys/AuthKey.p8"),
  APNS_HOST: z.string().default("api.sandbox.push.apple.com"),

  // CORS
  CORS_ORIGIN: z.string().optional(),

  // GitHub OAuth — repo integration (Settings → connect GitHub)
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  GITHUB_WEBHOOK_BASE_URL: z.string().optional(),

  // GitHub OAuth — Sign in with GitHub (separate app, minimal scopes)
  GITHUB_AUTH_CLIENT_ID: z.string().optional(),
  GITHUB_AUTH_CLIENT_SECRET: z.string().optional(),

  // Google OAuth — Sign in with Google
  GOOGLE_AUTH_CLIENT_ID: z.string().optional(),
  GOOGLE_AUTH_CLIENT_SECRET: z.string().optional(),

  // Fastlane Worker (MacOS)
  FASTLANE_WORKER_URL: z.string().url().optional(),
  // Comma-separated list of worker base URLs; overrides FASTLANE_WORKER_URL for
  // job dispatch (each worker runs one job at a time, jobs queue FIFO).
  FASTLANE_WORKER_URLS: z.string().optional(),
  FASTLANE_WORKER_SECRET: z.string().optional(),

  // Second, background-less frameit pass. Off by default because it doubles framing cost.
  // Note: z.coerce.boolean() would turn the string "false" into true, hence the enum.
  FRAME_INCLUDE_UNFRAMED: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),

  // Transporter Worker (+ Linux proxy server)
  TRANSPORTER_WORKER_URL: z.string().url().optional(),
  FASTLANE_PATH: z.string().default("fastlane"),
  SERVER_INTERNAL_URL: z.string().url().optional(),

  // Email (Resend)
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default("noreply@marteso.com"),
  APP_URL: z.string().default("http://localhost:5173"),

  // Lemon Squeezy billing
  LEMONSQUEEZY_API_KEY: z.string().optional(),
  LEMONSQUEEZY_STORE_ID: z.string().optional(),
  LEMONSQUEEZY_VARIANT_MONTHLY: z.string().optional(),
  LEMONSQUEEZY_VARIANT_YEARLY: z.string().optional(),
  LEMONSQUEEZY_WEBHOOK_SECRET: z.string().optional(),

  // AI providers
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),

  // node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ENCRYPTION_KEY: z.string().length(64).optional(),

  WEB_PORT: z.string().optional(),

  ADMIN_WEB_PORT: z.string().optional(),

  ADMIN_URL: z.string().default("https://admin.marteso.com"),

  ADMIN_MCP_TOKEN: z.string().min(24).optional(),

  // Logging
  LOG_LEVEL: z.enum(["error", "warn", "info", "debug"]).default("info"),

  // asc@marteso.com mailbox — auto-accepting App Store Connect team invites
  ASC_MAILBOX_IMAP_HOST: z.string().optional(),
  ASC_MAILBOX_IMAP_PORT: z.coerce.number().default(993),
  ASC_MAILBOX_IMAP_USER: z.string().optional(),
  ASC_MAILBOX_IMAP_PASSWORD: z.string().optional(),
  // Persistent Chrome profile dir (not just a cookie snapshot) — Apple's invite
  // "accept" flow demands a fresh interactive sign-in from a throwaway session
  // no matter how recent, but generally trusts a continuously-used real profile.
  ASC_MAILBOX_PROFILE_DIR: z.string().default("./keys/asc-mailbox-profile"),
});

function loadEnv() {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error("❌ Invalid environment variables:");
    console.error(result.error.format());
    process.exit(1);
  }
  const data = result.data;
  if (data.NODE_ENV === "production" && !data.ENCRYPTION_KEY) {
    console.error(
      "❌ ENCRYPTION_KEY is required in production (generate with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\")",
    );
    process.exit(1);
  }
  if (
    data.NODE_ENV === "production" &&
    (data.WEBAUTHN_RP_ID === "localhost" || data.WEBAUTHN_ORIGIN.includes("localhost"))
  ) {
    console.error(
      "❌ WEBAUTHN_RP_ID and WEBAUTHN_ORIGIN must be set to your production domain (e.g. WEBAUTHN_RP_ID=marteso.com, WEBAUTHN_ORIGIN=https://marteso.com)",
    );
    process.exit(1);
  }
  return data;
}

export const env = loadEnv();
export type Env = z.infer<typeof envSchema>;
