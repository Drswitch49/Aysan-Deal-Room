export function getDriveViewUrl(url: string): string {
  if (!url) return "";
  return url;
}

export function getDriveDownloadUrl(url: string): string {
  if (!url) return "";

  // Return the Google Drive file preview/view URL which allows the user to
  // view the document and download it using the built-in Drive download button.
  // This avoids HTTP 403 / cookie blocking issues associated with direct /uc download URLs.
  const fileMatch = url.match(/\/file\/d\/([^/]+)/);
  if (fileMatch?.[1]) {
    return `https://drive.google.com/file/d/${fileMatch[1]}/view`;
  }

  const openMatch = url.match(/[?&]id=([^&]+)/);
  if (openMatch?.[1]) {
    return `https://drive.google.com/file/d/${openMatch[1]}/view`;
  }

  return url;
}
