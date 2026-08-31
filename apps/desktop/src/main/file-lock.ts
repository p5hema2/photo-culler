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
 * The lock's key: the path, case-folded.
 *
 * Because "per path" has to mean per FILE, and since the renamer lower-cases
 * extensions there are routinely two live spellings of one file — the pre-rename
 * `IMG_1.JPG` a thumbnail read is still holding, and the `IMG_1.jpg` the next
 * operation asks for. On NTFS and on APFS those are one file, and two separate
 * chains over it would let a read run straight into exiftool's
 * rename-over-the-original, which is the exact collision this module exists to
 * prevent.
 *
 * On a case-SENSITIVE volume two different files then share a chain. That costs
 * a little parallelism between those two files and nothing else — the safe
 * direction, and the only one available without a `stat` per lock acquisition.
 */
function lockKey(filePath: string): string {
  return filePath.toLowerCase();
}

/**
 * Run `fn` with exclusive access to `filePath`.
 *
 * The chain is per path and self-cleaning: the map entry is dropped once the
 * last waiter settles, so culling 20 000 images does not leave 20 000 resolved
 * promises behind.
 */
export function withFileLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
  const key = lockKey(filePath);
  const previous = chains.get(key) ?? Promise.resolve();
  // `.then(fn, fn)`: a failed predecessor must not cancel the queue behind it.
  const result = previous.then(fn, fn);
  const chain = result.catch(() => undefined);
  chains.set(key, chain);
  void chain.then(() => {
    if (chains.get(key) === chain) chains.delete(key);
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
