import { protocol, net } from 'electron';
import path from 'node:path';

/**
 * Register custom app:// scheme as privileged.
 * MUST be called BEFORE app.whenReady().
 */
export function registerSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'app', privileges: { standard: true, secure: true, stream: true } },
  ]);
}

/**
 * Register the app:// protocol handler to serve local files securely.
 * MUST be called AFTER app.whenReady().
 */
export function registerProtocolHandlers(): void {
  protocol.handle('app', (request) => {
    const url = new URL(request.url);
    // URL format: app://file/path/to/image.jpg
    // pathname gives /path/to/image.jpg with each segment percent-encoded
    const filePath = decodeURIComponent(url.pathname);
    const normalized = path.normalize(filePath);
    return net.fetch(`file://${normalized}`);
  });
}
