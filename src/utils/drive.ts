export function getDriveViewUrl(url: string): string {
  if (!url) return "";
  return url;
}

export function getDriveDownloadUrl(url: string): string {
  if (!url) return "";

  const fileMatch = url.match(/\/file\/d\/([^/]+)/);
  if (fileMatch?.[1]) {
    return `https://drive.google.com/uc?export=download&id=${fileMatch[1]}`;
  }

  const openMatch = url.match(/[?&]id=([^&]+)/);
  if (openMatch?.[1]) {
    return `https://drive.google.com/uc?export=download&id=${openMatch[1]}`;
  }

  return url;
}
