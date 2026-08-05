const configuredApiUrl = import.meta.env.VITE_API_URL?.trim().replace(/\/+$/, "");

/** Public API origin. Override with VITE_API_URL for a local or staging backend. */
export const API_ORIGIN = configuredApiUrl || "https://api.tixhub.fit";

export function apiUrl(path: string): string {
  return `${API_ORIGIN}${path.startsWith("/") ? path : `/${path}`}`;
}

/** API responses store uploaded assets as root-relative paths. */
export function apiAssetUrl(url: string | null): string | null {
  return url?.startsWith("/") ? apiUrl(url) : url;
}
