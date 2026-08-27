/** Same media eligibility on the sales endpoint and the public video element. */
export function playableTrailer(url: string | null | undefined): string | null {
  const value = url?.trim();
  if (!value || !/^https?:\/\//i.test(value)) return null;
  return /\.(mp4|webm|ogv|ogg|mov|m4v)(?:[?#]|$)/i.test(value) ||
    /res\.cloudinary\.com\/.+\/video\/upload\//i.test(value)
    ? value
    : null;
}
