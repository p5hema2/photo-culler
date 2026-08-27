/**
 * Per-path serialisation for operations that touch an image file.
 *
 * exiftool writes by renaming a temp file over the original. On Windows an open
 * handle makes that rename fail, and the app opens the same file from a dozen
 * places at once: one READ_FILE per thumbnail worker (there are
 * hardwareConcurrency of them), plus the scoring worker, the detail viewer and
 * its neighbour preload. Nothing coordinated them, because until ratings landed
 * nothing wrote to an original outside a confirmed Execute.
 *
 * Keyed by path, so reads of DIFFERENT images stay fully parallel — the
 * thumbnail burst is unaffected. Only same-file operations queue, which is
 * exactly the set that can collide.
 */

const chains = new Map<string, Promise<unknown>>();

/**
 * Run `fn` with exclusive access to `filePath`.
 *
 * The chain is per path and self-cleaning: the map entry is dropped once the
 * last waiter settles, so culling 20 000 images does not leave 20 000 resolved
 * promises behind.
 */
export function withFileLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
  const previous = chains.get(filePath) ?? Promise.resolve();
  // `.then(fn, fn)`: a failed predecessor must not cancel the queue behind it.
  const result = previous.then(fn, fn);
  const chain = result.catch(() => undefined);
  chains.set(filePath, chain);
  void chain.then(() => {
    if (chains.get(filePath) === chain) chains.delete(filePath);
  });
  return result;
}

/**
 * Wait for every queued file operation to finish.
 *
 * Called on quit: a rating typed a moment before the window closes is only in
 * the file once its write has landed, and the file is the authority for it.
 * Bounded by the caller, because a wedged write must not stop the app exiting.
 */
export async function settleFileLocks(): Promise<void> {
  // Snapshot: chains created while draining belong to the next round, and a
  // quit path must terminate.
  await Promise.allSettled([...chains.values()]);
}
