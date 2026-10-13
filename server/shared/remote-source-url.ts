export function remoteSourceUrl(value: string): URL | undefined {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.port === "" && !url.username && !url.password ? url : undefined;
  } catch {
    return undefined;
  }
}

export function isRemoteSourceUrl(value: string): boolean {
  return remoteSourceUrl(value) !== undefined;
}
