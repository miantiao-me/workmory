export function contentDispositionFilename(value: string | null): string | undefined {
  if (!value) return undefined;
  const utf8 = /(?:^|;)\s*filename\*=UTF-8''([^;]+)/i.exec(value)?.[1];
  if (utf8) {
    try {
      return decodeURIComponent(utf8.trim());
    } catch {}
  }
  return /(?:^|;)\s*filename="([^"]+)"/i.exec(value)?.[1]
    ?? /(?:^|;)\s*filename=([^;]+)/i.exec(value)?.[1]?.trim();
}
