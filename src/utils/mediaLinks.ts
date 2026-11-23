/**
 * Extracts a Google Drive File ID from common Drive sharing URLs or returns a valid raw ID.
 */
export function extractDriveFileId(rawInput: string): string {
  const trimmed = rawInput.trim();
  if (!trimmed) return '';

  // Direct File ID (Google Drive IDs are typically 25-44 chars of [a-zA-Z0-9_-])
  if (/^[a-zA-Z0-9_-]{15,128}$/.test(trimmed)) {
    return trimmed;
  }

  try {
    const parsed = new URL(trimmed);
    const hostname = parsed.hostname.toLowerCase();
    if (!hostname.includes('google.com') && !hostname.includes('googleusercontent.com')) {
      return '';
    }

    // Format: /file/d/<FILE_ID>/view or /d/<FILE_ID>/...
    const pathMatch = parsed.pathname.match(/\/d\/([a-zA-Z0-9_-]{10,128})/);
    if (pathMatch?.[1]) {
      return pathMatch[1];
    }

    // Format: ?id=<FILE_ID>
    const queryId = parsed.searchParams.get('id');
    if (queryId && /^[a-zA-Z0-9_-]{10,128}$/.test(queryId)) {
      return queryId;
    }
  } catch {
    return '';
  }

  return '';
}

/**
 * Blocks unsafe URL schemes like javascript: or data: on dynamic image/media fields.
 */
export function sanitizeSafeUrl(rawUrl: string, maxLength = 1000): string {
  const trimmed = rawUrl.trim().slice(0, maxLength);
  if (!trimmed) return '';
  if (trimmed.startsWith('/')) return trimmed;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return trimmed;
    }
    return '';
  } catch {
    return '';
  }
}

/**
 * Extracts a safe YouTube video ID from youtube.com, youtu.be, or youtube-nocookie.com URLs.
 */
export function extractYouTubeVideoId(rawInput: string): string {
  const trimmed = rawInput.trim();
  if (!trimmed) return '';
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
    return trimmed;
  }
  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.toLowerCase();
    if (host === 'youtu.be' || host === 'www.youtu.be') {
      const id = parsed.pathname.replace(/^\/+/, '').split('/')[0];
      return id && /^[a-zA-Z0-9_-]{6,20}$/.test(id) ? id : '';
    }
    if (
      host.endsWith('youtube.com') ||
      host.endsWith('youtube-nocookie.com')
    ) {
      const v = parsed.searchParams.get('v');
      if (v && /^[a-zA-Z0-9_-]{6,20}$/.test(v)) return v;
      const pathMatch = parsed.pathname.match(/^\/(?:embed|shorts|live)\/([a-zA-Z0-9_-]{6,20})/);
      if (pathMatch?.[1]) return pathMatch[1];
    }
  } catch {
    return '';
  }
  return '';
}

export function slugifyCategory(name: string): string {
  const normalized = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

  return normalized.length >= 2 ? normalized : `cat-${Date.now().toString(36)}`;
}
