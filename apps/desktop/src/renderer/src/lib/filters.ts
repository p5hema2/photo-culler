/**
 * Which classifications the grid is showing.
 *
 * A set rather than one value: culling wants two buckets at once often enough —
 * "everything I have not decided on, plus the maybes" — and a single-choice
 * filter forces two passes over the shoot to see that. An empty set means no
 * filter at all, the same convention the file-type chips already use.
 */
export type ClassificationFilter = 'keep' | 'review' | 'delete' | 'unclassified';

/** Display order of the chips, and the closed set of filterable values. */
export const CLASSIFICATION_FILTERS: readonly ClassificationFilter[] = [
  'unclassified',
  'keep',
  'review',
  'delete',
];

/**
 * Whether an image's classification passes the selection.
 *
 * An unclassified image simply has no entry in the classifications map, so both
 * null and undefined fold into the 'unclassified' bucket.
 */
export function matchesClassificationFilter(
  classification: 'keep' | 'review' | 'delete' | null | undefined,
  selected: ReadonlySet<ClassificationFilter>,
): boolean {
  if (selected.size === 0) return true;
  return selected.has(classification ?? 'unclassified');
}

/** Add or remove one value, as a new set — state here is replaced, never mutated. */
export function toggleClassificationFilter(
  selected: ReadonlySet<ClassificationFilter>,
  value: ClassificationFilter,
): Set<ClassificationFilter> {
  const next = new Set(selected);
  if (next.has(value)) {
    next.delete(value);
  } else {
    next.add(value);
  }
  return next;
}
