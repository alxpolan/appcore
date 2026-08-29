function jsonReplacer(_key: string, value: unknown) {
  return typeof value === "bigint" ? Number(value) : value;
}

export function ok(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, jsonReplacer, 2) }],
  };
}

export function fail(message: string) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ ok: false, error: message }) }],
    isError: true as const,
  };
}

const SECRET_KEYS = new Set([
  "passwordHash",
  "ascPrivateKey",
  "ascAutoPrivateKey",
  "githubAccessToken",
  "githubWebhookSecret",
  "signingCertP12",
  "signingCertPassword",
  "signingProvisioningProfile",
  "signingProvisioningProfiles",
  "snapshotEnvVars",
  "reviewerDemoPassword",
  "clientSecret",
]);

export function redactSecrets<T>(value: T): T {
  if (Array.isArray(value)) return value.map(redactSecrets) as unknown as T;
  if (value && typeof value === "object" && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};

    for (const [k, v] of Object.entries(value)) {
      out[k] = SECRET_KEYS.has(k) ? (v == null ? null : "•••••• (set)") : redactSecrets(v);
    }
    
    return out as T;
  }
  return value;
}
