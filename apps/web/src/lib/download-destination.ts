// Restrict passwordless return URLs to this one same-origin endpoint.
export function downloadDestination(value: string | null | undefined) {
  if (!value || !value.startsWith("/api/files/content?")) return "/";
  try {
    const url = new URL(value, "https://boundless.invalid");
    if (
      url.origin !== "https://boundless.invalid" ||
      url.pathname !== "/api/files/content" ||
      url.hash ||
      !/^[a-z0-9]{10}$/.test(url.searchParams.get("instance") || "") ||
      !url.searchParams.get("path")
    )
      return "/";
    return url.pathname + url.search;
  } catch {
    return "/";
  }
}
export const DOWNLOAD_RETURN_KEY = "boundless-download-return";
