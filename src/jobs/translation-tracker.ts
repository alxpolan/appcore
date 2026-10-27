const active = new Map<string, Set<string>>();

export function add(versionId: string, locale: string): void {
  let set = active.get(versionId);

  if (!set) {
    set = new Set();
    active.set(versionId, set);
  }

  set.add(locale);
}

export function remove(versionId: string, locale: string): void {
  const set = active.get(versionId);
  if (!set) return;
  set.delete(locale);
  if (set.size === 0) active.delete(versionId);
}

export function getLocales(versionId: string): string[] {
  return Array.from(active.get(versionId) ?? []);
}

export function isTranslating(versionId: string, locale: string): boolean {
  return active.get(versionId)?.has(locale) ?? false;
}

export function isVersionLocked(versionId: string): boolean {
  return (active.get(versionId)?.size ?? 0) > 0;
}
