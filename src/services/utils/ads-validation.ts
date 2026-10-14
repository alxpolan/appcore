export function fail(message: string): never {
  throw new Error(message);
}

export function asNonEmptyString(value: unknown, field: string, maxLen: number): string {
  if (typeof value !== "string" || value.trim().length === 0) fail(`${field} is required`);
  const trimmed = (value as string).trim();
  if (trimmed.length > maxLen) fail(`${field} must be at most ${maxLen} characters`);

  return trimmed;
}

export function asPositiveNumber(value: unknown, field: string): number {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) fail(`${field} must be a number greater than 0`);

  return n;
}
