const LOGO_PATTERN = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+=*$/;
const MAX_LOGO_CHARS = 400_000;

export function safeLogoDataUri(value?: string | null) {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!LOGO_PATTERN.test(trimmed)) return undefined;
  if (trimmed.length > MAX_LOGO_CHARS) return undefined;
  return trimmed;
}

export function logoBytes(value?: string | null) {
  const uri = safeLogoDataUri(value);
  if (!uri) return undefined;
  const encoded = uri.slice(uri.indexOf(",") + 1);
  const bytes = Buffer.from(encoded, "base64");
  if (!bytes.length) return undefined;
  return bytes;
}
