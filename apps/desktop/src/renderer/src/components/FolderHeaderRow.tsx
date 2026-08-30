import type { FolderCounts, FolderNode } from '@photo-culler/image-utils/tree';

/**
 * One folder in the tree: the disclosure row the grid draws for every node.
 *
 * ## The one hard constraint
 *
 * Its height is FIXED at `FOLDER_HEADER_HEIGHT` and must stay so at every
 * depth. `cellOffsetInGrid` re-derives every row's offset by summing heights —
 * that is how it can say where an image sits when its row is not rendered,
 * which is what re-centres the grid on return from the loupe — and it charges a
 * folder row a flat 40 px with no depth term. So the indentation is padding
 * INSIDE the row, never a taller row, never a margin around it.
 *
 * ## Why the counters live here
 *
 * Up to 1.8.0 the thumbnail and scoring readouts sat in the toolbar, as one
 * pair for the whole scan. With a tree that number cannot be split back up, and
 * the question a user actually has — "is this shoot done?" — is per folder. The
 * counts are subtree totals: a collapsed shoot reporting only the handful of
 * images loose in its own directory would be worse than no number.
 */

/** Pixels of indent per level of depth. */
export const FOLDER_INDENT = 14;

interface FolderHeaderRowProps {
  node: FolderNode;
  collapsed: boolean;
  /** Subtree tallies. Absent while the tree is being rebuilt. */
  counts: FolderCounts | undefined;
  /** True while a dragged selection is hovering this row. */
  dropTarget: boolean;
  onToggle: (folderPath: string) => void;
  onContextMenu: (node: FolderNode, at: { x: number; y: number }) => void;
  onDragOver: (node: FolderNode) => void;
  onDragLeave: (node: FolderNode) => void;
  onDrop: (node: FolderNode) => void;
}

/** `done/total`, or nothing at all when there is nothing to report. */
function Counter({
  label,
  done,
  total,
  testId,
}: {
  label: string;
  done: number;
  total: number;
  testId: string;
}): React.JSX.Element | null {
  if (total === 0) return null;
  const complete = done >= total;
  return (
    <span
      className={`text-[10px] font-mono whitespace-nowrap ${
        complete ? 'text-gray-600' : 'text-gray-400'
      }`}
      data-testid={testId}
      title={`${label}: ${done} of ${total}`}
    >
      {label} {done}/{total}
    </span>
  );
}

export function FolderHeaderRow({
  node,
  collapsed,
  counts,
  dropTarget,
  onToggle,
  onContextMenu,
  onDragOver,
  onDragLeave,
  onDrop,
}: FolderHeaderRowProps): React.JSX.Element {
  const total = counts?.images ?? node.totalCount;
  const hasChildren = node.children.length > 0;

  return (
    <button
      onClick={() => onToggle(node.path)}
      onContextMenu={(event) => {
        // Not routed through the cell click path, unlike a photo's right click:
        // there is no image under the pointer, so there is nothing to focus and
        // nothing to select — and a right click here must leave the batch
        // exactly as it was.
        event.preventDefault();
        onContextMenu(node, { x: event.clientX, y: event.clientY });
      }}
      onDragOver={(event) => {
        // preventDefault is what marks this a valid drop target; without it the
        // browser refuses the drop and the cursor never changes.
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        onDragOver(node);
      }}
      onDragLeave={() => onDragLeave(node)}
      onDrop={(event) => {
        event.preventDefault();
        onDrop(node);
      }}
      className={`flex h-full w-full items-center gap-2 border-b border-gray-700 pr-3 text-left transition-colors ${
        dropTarget ? 'bg-blue-900/50 outline outline-1 outline-blue-400' : 'hover:bg-gray-800'
      }`}
      // Indent as PADDING inside a fixed-height row. See the note at the top of
      // this file: the row model charges every folder row the same 40 px.
      style={{
        backgroundColor: dropTarget ? undefined : '#1a1d23',
        paddingLeft: 12 + node.depth * FOLDER_INDENT,
      }}
      data-testid="folder-header"
      data-folder-path={node.path}
      data-folder-depth={node.depth}
      aria-expanded={!collapsed}
    >
      <span className="w-3 flex-shrink-0 text-gray-500">
        {/* A leaf still gets the column, so names line up down a level. */}
        {hasChildren || node.ownCount > 0 ? (collapsed ? '▸' : '▾') : '·'}
      </span>
      <span
        className={`truncate ${node.depth === 0 ? 'text-sm font-semibold text-gray-100' : 'text-sm font-medium text-gray-200'}`}
        title={node.path}
      >
        {node.name}
      </span>
      <span className="flex-shrink-0 text-xs text-gray-500" data-testid="folder-count">
        {total}
        {/* Only worth saying when the two differ — otherwise it is the same
            number printed twice. */}
        {node.ownCount !== total && node.ownCount > 0 && (
          <span className="text-gray-600"> ({node.ownCount} hier)</span>
        )}
      </span>

      <span className="flex-1" />

      <Counter
        label="Thumbs"
        done={counts?.thumbs ?? 0}
        total={counts?.thumbable ?? 0}
        testId="folder-thumb-count"
      />
      <Counter
        label="Score"
        done={counts?.scored ?? 0}
        total={counts?.scoreable ?? 0}
        testId="folder-score-count"
      />
    </button>
  );
}
