/**
 * Turning an absolute file path into an `app://` URL the renderer can fetch.
 *
 * One function, in one place, because the encoding and the main process's
 * decoding are two ends of one format — the same reason `CACHE_KEY_SEP` exists
 * in `exiftool.ts`. `registerProtocolHandlers` in `main/protocol.ts` is the
 * other end; change one and you change both.
 *
 * This was inline in `ThumbnailCell` and was WRONG ON WINDOWS: it split on `/`
 * only, so `C:\photos\a.jpg` came out as one encoded blob glued straight onto
 * `app://file`, with no separating slash. It never mattered, because nothing
 * fetched the URL — the thumbnail path passes the file path itself and reads
 * bytes over IPC. Video is the first caller that actually needs it to resolve.
 */

/**
 * `app://file/<encoded>/<segments>`.
 *
 * Both separators are accepted and normalised to `/`, each segment is
 * percent-encoded so spaces and `#` survive — and the generated capture-time
 * filenames contain spaces by design — and the leading slash is always present
 * so a Windows drive letter is an ordinary first segment rather than the URL's
 * authority.
 */
export function appUrlFor(filePath: string): string {
  const slashed = filePath.replace(/\\/g, '/');
  const rooted = slashed.startsWith('/') ? slashed : `/${slashed}`;
  return `app://file${rooted.split('/').map(encodeURIComponent).join('/')}`;
}
