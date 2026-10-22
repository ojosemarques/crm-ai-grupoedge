function safeOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function marketingFormAssetOrigins(raw: string | undefined): readonly string[] {
  return Object.freeze([...new Set((raw ?? "").split(",").map((value) => safeOrigin(value.trim())).filter((value): value is string => Boolean(value)))].sort());
}

export function isAllowedMarketingFormAssetUrl(value: string, origins: readonly string[]): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && origins.includes(url.origin);
  } catch {
    return false;
  }
}
