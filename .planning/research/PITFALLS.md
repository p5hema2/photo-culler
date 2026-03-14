# Domain Pitfalls

**Domain:** Electron desktop photo culling app (cross-platform, zero native deps)
**Researched:** 2026-03-14

## Critical Pitfalls

Mistakes that cause rewrites, crashes, or unusable products.

### Pitfall 1: Renderer Process Memory Explosion with Large Image Sets

**What goes wrong:** Loading 1,000+ full-resolution images into memory (even as `<img>` elements with `src` attributes) causes Chromium's renderer process to consume 4-8+ GB of RAM. The process eventually crashes or the OS kills it. Electron inherits Chromium's per-renderer memory limits, and since Electron 14+ there are documented memory limitation regressions.

**Why it happens:** Each decoded image bitmap lives in GPU or renderer memory. A single 24MP JPEG decodes to ~72MB of uncompressed pixel data. Even 100 images = 7.2GB. Developers test with 20-50 images and never see the problem.

**Consequences:** App crashes with no error message on folders with 500+ photos. Users lose trust immediately.

**Prevention:**
- Virtualize the grid (only render visible thumbnails + small buffer). Use `@tanstack/react-virtual` (successor to react-window, actively maintained, smaller).
- Generate thumbnails at display resolution (e.g., 300px wide for grid), not full resolution. Use Canvas API to downsample, then use `canvas.toBlob()` to create small thumbnail blobs.
- Revoke object URLs (`URL.revokeObjectURL()`) for images scrolled out of view. This is the single most forgotten cleanup step.
- Set explicit `width`/`height` on `<img>` elements so the browser can release decoded bitmaps for off-screen images.
- Monitor `performance.memory` (Chromium-specific API available in Electron) during development.

**Detection:** Memory usage climbs monotonically during scrolling. Test with 1,500+ images from a real camera (8-24MP JPEGs, not tiny test images).

**Phase relevance:** Must be addressed in the thumbnail grid phase (Phase 1/2). Retrofitting virtualization into a non-virtualized grid is painful.

**Confidence:** HIGH -- well-documented Electron issue, multiple GitHub issues confirm.

---

### Pitfall 2: Canvas getImageData Memory Leaks in Quality Scoring

**What goes wrong:** The quality scoring feature uses Canvas `getImageData()` to analyze pixel data for sharpness/exposure/noise. When processing many images in sequence, each `getImageData()` call allocates a large `ImageData` buffer. If the Canvas element or context is reused without proper cleanup, or if references to `ImageData` objects are held, memory leaks accumulate rapidly -- documented cases show GB-scale leaks within seconds on large canvases.

**Why it happens:** `getImageData()` on a 4000x3000 image allocates 48MB (w * h * 4 bytes). Processing 500 images serially without releasing references means 24GB of allocations that GC may not collect promptly, especially inside Web Workers where GC behavior differs.

**Consequences:** Quality scoring crashes the renderer or Web Worker halfway through a batch. Users see "Aw, Snap!" or the worker silently dies.

**Prevention:**
- Downsample images before analysis. A 500x375 canvas is sufficient for sharpness/exposure scoring and uses only 750KB per `getImageData()` call.
- Process images one at a time in the Web Worker. Null out `ImageData` references explicitly after each image.
- Use `OffscreenCanvas` in the Web Worker (available in Chromium/Electron) to avoid transferring image data across threads.
- Use `createImageBitmap()` with `resizeWidth`/`resizeHeight` options to downsample during decode, before ever touching Canvas.
- Batch processing with explicit GC pauses: process 20-50 images, then yield to the event loop.

**Detection:** Monitor Web Worker memory during batch scoring. If it grows linearly with image count rather than staying flat, you have a leak.

**Phase relevance:** Quality scoring phase. Must be designed correctly from the start -- the analysis pipeline architecture is hard to change later.

**Confidence:** HIGH -- Canvas memory issues are well-documented in Chromium bug trackers.

---

### Pitfall 3: shell.trashItem Cross-Platform Failures

**What goes wrong:** Electron's `shell.trashItem()` has documented bugs on both platforms:
- **Windows:** Fails with "Failed to create FileOperation instance" on some Windows 10 configurations. Fails with "Failed to parse path" if the path uses forward slashes (POSIX-style) instead of backslashes. Files in OneDrive-synced folders get moved to OneDrive root instead of Recycle Bin.
- **macOS:** Documented cases of process crashes immediately after trashing.

**Why it happens:** `shell.trashItem()` delegates to platform-specific APIs (NSFileManager on macOS, IFileOperation on Windows) which have edge cases Electron doesn't fully handle.

**Consequences:** The core feature of the app (deleting photos) silently fails or crashes. Users think photos were deleted but they weren't, or the app crashes mid-batch.

**Prevention:**
- Always normalize paths with `path.normalize()` before passing to `shell.trashItem()`. On Windows, ensure backslash separators.
- Wrap `shell.trashItem()` in a try/catch with per-file error handling. Never batch-trash without individual error capture.
- Build a retry mechanism: if trash fails, offer the user a "permanent delete" fallback with `fs.unlink()` (with clear warning).
- Test on OneDrive/iCloud-synced folders explicitly -- these are common photographer folder locations.
- Test on network drives / external drives (common for photographers storing RAW exports).

**Detection:** Error handling that swallows `shell.trashItem()` rejections. Test on real Windows machines (not just macOS dev machines).

**Phase relevance:** File operations / delete phase. Must have robust error handling from day one.

**Confidence:** HIGH -- documented in Electron GitHub issues #29598, #38541, #28029, #28831.

---

### Pitfall 4: HEIC Decoding is Fragile and Slow Without Native Codecs

**What goes wrong:** HEIC/HEIF is not supported by any browser engine natively (including Chromium in Electron). The project plans to use `heic2any` (bundled WASM decoder), but WASM-based HEIC decoding is 10-50x slower than native decoding and can take 2-5 seconds per image. For a folder of 500 HEIC files from an iPhone, this means 15-40 minutes just to generate thumbnails.

**Why it happens:** HEIC uses the HEVC codec which is patent-encumbered. No browser ships native support. WASM decoders work but are inherently slower than native implementations. Windows doesn't include HEVC codecs by default either.

**Consequences:** App appears frozen or unusably slow when opening iPhone photo folders (which default to HEIC). This is a primary use case for event photographers.

**Prevention:**
- Detect HEIC files separately and decode them with lower priority / in background.
- Cache decoded JPEG versions of HEIC files in a temp directory. Only decode once per file.
- Show a progress indicator specifically for HEIC decoding ("Converting iPhone photos...").
- Consider `libheif-js` as an alternative to `heic2any` -- benchmark both. `libheif-js` may offer better performance for batch operations.
- Set user expectations: document that HEIC folders take longer on first open.
- Generate very small thumbnails (200px) for HEIC files initially, decode full resolution only on preview.

**Detection:** Test with 200+ HEIC files from a real iPhone. If grid population takes more than 30 seconds, the UX is broken.

**Phase relevance:** Image loading / thumbnail generation phase. Must be designed as an async pipeline from the start, not bolted on.

**Confidence:** HIGH -- HEIC browser support status confirmed via caniuse.com; heic2any performance is well-documented.

---

### Pitfall 5: IPC Serialization Bottleneck Between Main and Renderer

**What goes wrong:** All Electron IPC uses JSON serialization. Sending file metadata for 1,000+ images (paths, sizes, dates, EXIF data) as a single IPC message can take hundreds of milliseconds to serialize/deserialize. Worse: if image data (thumbnails, pixel buffers) is sent through IPC, the main process blocks during serialization.

**Why it happens:** Electron IPC is ~80,000 nanoseconds per call (vs ~1.7ns for a local function call). JSON serialization of large payloads is CPU-bound on the main process. `sendSync()` blocks the renderer entirely.

**Consequences:** UI freezes during folder scanning. Noticeable lag between selecting a folder and seeing results. Main process becomes unresponsive during large data transfers.

**Prevention:**
- Never use `ipcRenderer.sendSync()`. Use `ipcRenderer.invoke()` (async) exclusively.
- Stream file metadata in batches (50-100 files per IPC message) rather than sending all 1,000+ at once. This allows the renderer to start showing results immediately.
- Keep image data (thumbnails, pixel buffers) in the renderer process. Read files via IPC but decode/resize in the renderer using Web Workers.
- For the file listing, send only minimal metadata via IPC (path, size, mtime). Let the renderer handle EXIF parsing, thumbnail generation, etc.
- Consider using `MessagePort` (Electron's `MessageChannelMain`) for high-throughput data channels that bypass the main process serialization bottleneck.

**Detection:** Profile IPC message timing. If any single IPC call takes >50ms, it needs to be chunked.

**Phase relevance:** Folder scanning / file discovery phase. The IPC architecture must be streaming-first from the beginning.

**Confidence:** HIGH -- Electron docs explicitly warn about this; IPC benchmarks are published.

---

## Moderate Pitfalls

### Pitfall 6: electron-builder Monorepo Packaging Misery

**What goes wrong:** electron-builder struggles with monorepo layouts (Turborepo + pnpm workspaces). Common issues: it bundles the entire monorepo's node_modules into the asar; it can't resolve pnpm's symlinked dependency structure; the asar grows to 300+ MB with duplicate dependencies; build times balloon to 20-30 minutes.

**Why it happens:** electron-builder was designed for single-package projects. pnpm's content-addressable store and symlink structure confuses its file collection logic. Turborepo's workspace layout means source files are scattered across packages.

**Prevention:**
- Use `electron-vite` or a custom Vite/webpack config that bundles the renderer app into a single directory before electron-builder sees it. electron-builder should package a pre-bundled output, not raw source.
- Configure `files` in electron-builder config to explicitly include only the built output, not the entire workspace.
- Set `"npmRebuild": false` in electron-builder config (no native deps to rebuild anyway).
- Use `asarUnpack` only for files that truly need filesystem access.
- Test packaging early (Phase 1). Do not defer packaging to the end -- monorepo packaging issues compound with every added dependency.
- Reference working examples: `t3dotgg/yerba` (Turborepo + Electron + Vite) and `buqiyuan/electron-vite-monorepo`.

**Detection:** asar file larger than 50MB is a red flag. Build time over 2 minutes for a JS-only app is a red flag.

**Phase relevance:** Project scaffolding / Phase 0. Get packaging working before writing features.

**Confidence:** MEDIUM -- based on community reports and GitHub issue patterns; specifics vary by electron-builder version.

---

### Pitfall 7: Cross-Platform Path Handling Breaks File Operations

**What goes wrong:** Paths constructed with string concatenation (`folder + '/' + file`) work on macOS but fail on Windows. Paths with special characters (spaces, unicode, accents) break. Paths from `dialog.showOpenDialog()` may use different separators than paths from `fs.readdir()`.

**Why it happens:** macOS uses `/`, Windows uses `\`. Developers build on macOS, test on macOS, ship to Windows. Node's `path` module handles this but only if you actually use it everywhere.

**Consequences:** Every file operation (read, trash, thumbnail generation) can fail silently on Windows. Photos in "My Pictures" or paths with spaces/unicode don't load.

**Prevention:**
- Use `path.join()` and `path.resolve()` for ALL path construction. Never concatenate with `/`.
- Use `path.normalize()` before passing paths to `shell.trashItem()` (see Pitfall 3).
- Test with paths containing: spaces, unicode characters, very long paths (260+ chars on Windows), and drive letters (D:\).
- Use `app.getPath('temp')` and `app.getPath('pictures')` instead of hardcoded paths.
- Set up a Windows CI/testing environment early.

**Detection:** Any string concatenation involving file paths in the codebase. Grep for `+ '/'` or template literals with `/` in path contexts.

**Phase relevance:** All phases. Establish path handling utilities in a shared package from Phase 0.

**Confidence:** HIGH -- this is a universal cross-platform Node.js issue, extensively documented.

---

### Pitfall 8: macOS Code Signing and Notarization Blocking Distribution

**What goes wrong:** Unsigned macOS apps trigger Gatekeeper warnings ("app is damaged" or "cannot be opened because the developer cannot be verified"). Since macOS Ventura, unsigned apps are even harder to open. Users can't figure out the right-click > Open workaround. Windows SmartScreen also warns on unsigned .exe files.

**Why it happens:** Apple requires notarization for all distributed apps. Without an Apple Developer account ($99/year) and proper signing setup, the app is effectively uninstallable for normal users.

**Consequences:** Users can't install the app. Support burden is enormous. App looks like malware.

**Prevention:**
- Budget for an Apple Developer account ($99/year) and a Windows code signing certificate.
- Integrate signing into the CI/CD pipeline from the start. Retroactive signing setup is frustrating.
- For early testing/beta, document the exact steps to bypass Gatekeeper (xattr -d com.apple.quarantine) and include them in release notes.
- Use electron-builder's built-in signing support; configure `mac.identity` and `win.certificateFile`.

**Detection:** If the build pipeline doesn't include a signing step, distribution will be painful.

**Phase relevance:** Packaging / distribution phase. Plan for it early even if you defer actual signing.

**Confidence:** HIGH -- standard Electron distribution requirement.

---

### Pitfall 9: Web Worker Lifecycle Mismanagement

**What goes wrong:** Web Workers created for image processing (thumbnail generation, quality scoring, EXIF parsing) are not terminated when no longer needed. Each Worker consumes a thread and memory. Creating a new Worker per image (instead of reusing a pool) causes thread exhaustion. Workers that crash silently leave processing stuck with no error feedback.

**Why it happens:** Web Worker creation is easy (`new Worker()`), but lifecycle management (pooling, error handling, termination) requires deliberate design. The Worker API has no built-in pool concept.

**Consequences:** System becomes sluggish as dozens of zombie Workers consume CPU/memory. Processing appears to hang when a Worker crashes without error propagation.

**Prevention:**
- Implement a Worker pool (2-4 Workers, matching `navigator.hardwareConcurrency`). Reuse Workers across tasks.
- Add `worker.onerror` and `worker.onmessageerror` handlers. Restart crashed Workers automatically.
- Implement task timeouts. If a Worker doesn't respond within N seconds (e.g., stuck on a corrupted image), kill and restart it.
- Terminate Workers when the user navigates away from a folder or closes the app.
- Use `Comlink` library for cleaner Worker communication (wraps postMessage in a Promise-based RPC interface).

**Detection:** Check `navigator.hardwareConcurrency` vs actual thread count during processing. If threads exceed cores * 2, you have a leak.

**Phase relevance:** Image processing pipeline phase. Design the pool architecture before implementing individual processing tasks.

**Confidence:** MEDIUM -- based on common Web Worker patterns; specific to this app's architecture.

---

## Minor Pitfalls

### Pitfall 10: Thumbnail Cache Invalidation Nightmare

**What goes wrong:** Thumbnails are cached for performance, but if a user modifies/replaces a photo outside the app (common in photographer workflows), the app shows stale thumbnails. If thumbnails are cached by filename only, moving files between folders shows wrong thumbnails.

**Prevention:**
- Cache key = `filepath + mtime + filesize`. Any change invalidates the cache.
- Use the OS temp directory (`app.getPath('temp')`) for cache storage. Don't pollute the user's photo folders.
- Set a cache size limit (e.g., 500MB) with LRU eviction.
- On folder re-open, do a quick mtime scan to invalidate stale entries.

**Phase relevance:** Thumbnail generation phase.

---

### Pitfall 11: Sorting by Date Taken Requires EXIF, Not File mtime

**What goes wrong:** Developers sort by `fs.stat().mtime` thinking it's "date taken." It's actually "date modified" -- which changes when files are copied, moved, or edited. Photos copied from a camera card all get the same mtime (the copy timestamp).

**Prevention:**
- Extract EXIF `DateTimeOriginal` via `exifr` for "date taken" sorting. Fall back to mtime only if EXIF is missing.
- Parse EXIF dates in batch upfront during folder scanning (exifr averages 2.5ms per file, so 1,000 files = 2.5 seconds).
- Display which date field is being used (EXIF vs file date) so users understand the sort.

**Phase relevance:** Sorting / metadata phase.

**Confidence:** HIGH -- universal photography app issue.

---

### Pitfall 12: Electron Security Defaults Block File Access

**What goes wrong:** Electron's security best practices (contextIsolation, sandbox, no nodeIntegration in renderer) block direct filesystem access from the renderer. Developers either disable security features (bad) or struggle to architect proper IPC for file operations.

**Prevention:**
- Keep `contextIsolation: true` and `nodeIntegration: false` (the defaults since Electron 12+).
- Define a clean preload script that exposes only the needed file operations via `contextBridge.exposeInMainWorld()`.
- All filesystem operations (`readdir`, `stat`, `readFile`, `trashItem`) go through IPC handlers in the main process.
- The renderer should never see raw `fs` or `path` modules.

**Phase relevance:** Project scaffolding / Phase 0. Security architecture must be correct from the start.

**Confidence:** HIGH -- Electron official documentation is explicit about this.

---

## "Looks Done But Isn't" Checklist

| Feature | Looks Done When... | Actually Done When... |
|---------|-------------------|----------------------|
| Thumbnail grid | Shows 50 images in dev | Handles 2,000 24MP JPEGs without exceeding 1GB RAM |
| HEIC support | Opens one .heic file | Opens a folder of 500 iPhone HEIC files in under 30 seconds (with progress) |
| Delete to trash | Works on dev machine | Works on Windows with OneDrive, paths with spaces, external drives |
| Quality scoring | Scores one image correctly | Scores 1,000 images without memory leak or Worker crash |
| Sort by date | Sorts test images by date | Uses EXIF DateTimeOriginal, not mtime; handles missing EXIF gracefully |
| Cross-platform build | Builds .dmg on macOS | Produces signed .dmg AND signed .exe from CI, both install cleanly |
| Folder scanning | Lists files in test folder | Handles 5,000+ files, nested subdirectories (optional), and special characters in paths |
| Full-size preview | Shows one image at full resolution | Loads/unloads full-res images during navigation without memory accumulation |

## Recovery Strategies

### When Memory Issues Surface Late
1. Profile with Chrome DevTools Memory tab (Electron supports this natively).
2. Take heap snapshots before/after scrolling through 500 images. Look for detached DOM nodes and unreleased ImageBitmap/Blob references.
3. Most common fix: add `URL.revokeObjectURL()` cleanup and virtualization. These two changes alone typically solve 80% of memory growth.

### When Packaging Breaks
1. Check asar contents: `npx asar list app.asar | wc -l`. If >1,000 files, you're bundling too much.
2. Run `npx asar list app.asar | grep node_modules` to check for duplicate/unnecessary dependencies.
3. Switch to bundling renderer with Vite first, then packaging the bundle -- not raw source.

### When Windows Builds Fail
1. Test on actual Windows hardware (VMs miss some edge cases with GPU acceleration and file locking).
2. Check path separators first -- this is the #1 Windows-specific failure cause.
3. Check for case-sensitivity assumptions (macOS is case-insensitive by default, but differently than Windows).

## Pitfall-to-Phase Mapping

| Phase Topic | Likely Pitfall | Severity | Mitigation |
|-------------|---------------|----------|------------|
| Project scaffolding (Phase 0) | #6 Monorepo packaging, #12 Security defaults | High | Get electron-builder + Turborepo working with a hello-world before adding features. Set up preload/contextBridge correctly. |
| Folder scanning & file listing | #5 IPC bottleneck, #7 Path handling | High | Stream file metadata in batches. Use path.join() everywhere. Test on Windows early. |
| Thumbnail grid | #1 Memory explosion | Critical | Virtualize from day one. Generate small thumbnails. Revoke object URLs. |
| Image loading (HEIC) | #4 HEIC decoding perf | High | Async pipeline with progress UI. Cache decoded JPEGs. Benchmark decoders. |
| Full-size preview | #1 Memory explosion (variant) | High | Load one full-res image at a time. Preload adjacent 2 images max. Release on navigation. |
| Quality scoring | #2 Canvas memory leaks, #9 Worker lifecycle | Critical | Downsample before analysis. Worker pool with error handling and timeouts. |
| Delete / trash | #3 shell.trashItem failures | High | Per-file error handling. Path normalization. Fallback to permanent delete with warning. |
| Sorting & filtering | #11 Date sorting via mtime | Medium | Use EXIF DateTimeOriginal. Batch parse during scan. |
| Packaging & distribution | #6 Monorepo packaging, #8 Code signing | High | Bundle before packaging. Budget for signing certificates. CI/CD pipeline. |

## Sources

- [Electron Performance Documentation](https://www.electronjs.org/docs/latest/tutorial/performance)
- [Electron IPC: Large Array Transfer - Issue #1948](https://github.com/electron/electron/issues/1948)
- [Electron Memory Limitations - Issue #31330](https://github.com/electron/electron/issues/31330)
- [shell.trashItem FileOperation Failure - Issue #29598](https://github.com/electron/electron/issues/29598)
- [shell.trashItem OneDrive Bug - Issue #38541](https://github.com/electron/electron/issues/38541)
- [shell.trashItem POSIX Separator - Issue #28831](https://github.com/electron/electron/issues/28831)
- [shell.trashItem Process Crash - Issue #28029](https://github.com/electron/electron/issues/28029)
- [Canvas getImageData Memory Leak - WebKit Bug #20315](https://bugs.webkit.org/show_bug.cgi?id=20315)
- [Canvas getImageData Memory Leak - Mozilla Bug #1012386](https://bugzilla.mozilla.org/show_bug.cgi?id=1012386)
- [HEIC Browser Support Status - caniuse.com](https://caniuse.com/heif)
- [Cross-Platform Node.js Guide - File Paths](https://github.com/ehmicky/cross-platform-node-guide/blob/main/docs/3_filesystem/file_paths.md)
- [Writing Cross-Platform Node.js - George Ornbo](https://shapeshed.com/writing-cross-platform-node/)
- [Electron ASAR Archives Documentation](https://www.electronjs.org/docs/latest/tutorial/asar-archives)
- [exifr - Performance Benchmarks](https://github.com/MikeKovarik/exifr)
- [Seena Burns - Debugging Electron Memory Usage](https://seenaburns.com/debugging-electron-memory-usage/)
- [IPC Benchmark - webContents.send Slow for Large Objects - Issue #7286](https://github.com/electron/electron/issues/7286)
- [electron-builder Monorepo Examples - yerba](https://github.com/t3dotgg/yerba)
- [Virtualizing Long Lists with react-window - web.dev](https://web.dev/virtualize-long-lists-react-window/)
