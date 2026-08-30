import { useEffect, useMemo, useRef, useState } from 'react';
import type { FolderStats } from '@photo-culler/types';
import { allNodes, isAtOrBelow } from '@photo-culler/image-utils/tree';
import type { FolderNode } from '@photo-culler/image-utils/tree';

/**
 * The three folder dialogs: pick one, create one, delete one.
 *
 * Together in one file because they are one feature — the folder operations the
 * tree made possible — and because they share the escape-key handling and the
 * modal shell. Each is small; three files would be three copies of the shell.
 */

/** Shared modal shell: backdrop, Escape, click-outside. */
function Modal({
  label,
  onClose,
  busy,
  children,
  width = 'w-[520px]',
}: {
  label: string;
  onClose: () => void;
  busy?: boolean;
  children: React.ReactNode;
  width?: string;
}): React.JSX.Element {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      if (!busy) onClose();
    };
    // Capture, like the context menu: the grid takes focus back on mouseenter,
    // so a handler bound to this element would stop hearing Escape.
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [busy, onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      role="dialog"
      aria-modal="true"
      aria-label={label}
      onClick={() => {
        if (!busy) onClose();
      }}
    >
      <div
        className={`bg-gray-800 rounded-lg shadow-xl p-6 max-w-[92vw] ${width}`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- picker -- */

interface FolderPickerProps {
  /** Null closes it. */
  open: boolean;
  tree: FolderNode[];
  /**
   * Folders the files already sit in.
   *
   * Shown but not selectable: moving a file onto itself is not an error worth a
   * dialog, it is simply nothing, and offering it invites the click.
   */
  disabledFolders: ReadonlySet<string>;
  onPick: (folder: string) => void;
  onClose: () => void;
}

export function FolderPicker({
  open,
  tree,
  disabledFolders,
  onPick,
  onClose,
}: FolderPickerProps): React.JSX.Element | null {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      inputRef.current?.focus();
    }
  }, [open]);

  const nodes = useMemo(() => {
    const all = allNodes(tree);
    const needle = query.trim().toLowerCase();
    if (!needle) return all;
    // Matching on the whole PATH, not just the name: with a tree the useful
    // query is often "DCIM" under one particular shoot.
    return all.filter((n) => n.path.toLowerCase().includes(needle));
  }, [tree, query]);

  if (!open) return null;

  return (
    <Modal label="Zielordner wählen" onClose={onClose}>
      <h2 className="mb-1 text-lg font-semibold">Verschieben nach</h2>
      <p className="mb-3 text-xs text-gray-500">
        Die Namen bleiben. Nur wenn im Zielordner schon eine gleichnamige Datei liegt, kommt ein
        Inhalts-Suffix dazu — überschrieben wird nie.
      </p>

      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Ordner suchen…"
        className="mb-3 w-full rounded bg-gray-900 px-2 py-1.5 text-sm outline-none ring-1 ring-gray-700 focus:ring-blue-500"
        data-testid="folder-picker-search"
      />

      <div className="mb-4 max-h-72 overflow-y-auto rounded border border-gray-700">
        {nodes.length === 0 ? (
          <p className="p-3 text-sm text-gray-500">Kein Ordner passt.</p>
        ) : (
          nodes.map((node) => {
            const disabled = disabledFolders.has(node.path);
            return (
              <button
                key={node.path}
                type="button"
                disabled={disabled}
                onClick={() => onPick(node.path)}
                title={node.path}
                data-testid="folder-picker-item"
                data-folder-path={node.path}
                className={`flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm ${
                  disabled ? 'cursor-default text-gray-600' : 'text-gray-200 hover:bg-gray-700'
                }`}
                style={{ paddingLeft: 8 + node.depth * 14 }}
              >
                <span className="truncate">{node.name}</span>
                <span className="ml-auto flex-shrink-0 text-[10px] text-gray-500">
                  {disabled ? 'liegt schon hier' : node.totalCount || ''}
                </span>
              </button>
            );
          })
        )}
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={onClose}
          className="rounded bg-gray-600 px-4 py-2 text-sm font-medium transition-colors hover:bg-gray-500"
        >
          Abbrechen
        </button>
      </div>
    </Modal>
  );
}

/* --------------------------------------------------------------- create -- */

export function CreateFolderDialog({
  parent,
  onCreate,
  onClose,
}: {
  /** Absolute path of the folder the new one goes into, or null when closed. */
  parent: { path: string; label: string } | null;
  onCreate: (name: string) => Promise<{ ok: boolean; error?: string }>;
  onClose: () => void;
}): React.JSX.Element | null {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (parent) {
      setName('');
      setError(null);
      setBusy(false);
      inputRef.current?.focus();
    }
  }, [parent]);

  if (!parent) return null;

  const submit = async (): Promise<void> => {
    if (!name.trim() || busy) return;
    setBusy(true);
    const result = await onCreate(name);
    setBusy(false);
    if (result.ok) onClose();
    else setError(result.error ?? 'Der Ordner konnte nicht angelegt werden.');
  };

  return (
    <Modal label="Unterordner erstellen" onClose={onClose} busy={busy} width="w-[420px]">
      <h2 className="mb-1 text-lg font-semibold">Unterordner erstellen</h2>
      <p className="mb-4 truncate text-xs text-gray-500" title={parent.path}>
        in {parent.label}
      </p>

      <input
        ref={inputRef}
        type="text"
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          setError(null);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void submit();
        }}
        placeholder="Name"
        className="mb-2 w-full rounded bg-gray-900 px-2 py-1.5 text-sm outline-none ring-1 ring-gray-700 focus:ring-blue-500"
        data-testid="create-folder-name"
      />
      {error && (
        <p className="mb-2 text-xs text-red-400" data-testid="create-folder-error">
          {error}
        </p>
      )}

      <div className="mt-4 flex justify-end gap-3">
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className="rounded bg-gray-600 px-4 py-2 text-sm font-medium transition-colors hover:bg-gray-500 disabled:opacity-50"
        >
          Abbrechen
        </button>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy || name.trim().length === 0}
          data-testid="create-folder-submit"
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium transition-colors hover:bg-blue-700 disabled:opacity-50"
        >
          Erstellen
        </button>
      </div>
    </Modal>
  );
}

/* --------------------------------------------------------------- delete -- */

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * The confirmation for the most destructive thing this app can do.
 *
 * It quotes numbers the MAIN PROCESS walked, not ones derived from the photos
 * on screen: a folder showing 40 JPEGs may hold 40 RAW files, 40 sidecars and a
 * thumbnail cache besides, and every one of them goes. Ratings live in the
 * files, so they go too. There is no trash step and no undo.
 *
 * The stats are loaded while the dialog is up rather than before it opens, so
 * the click that asks for it is answered immediately — but the confirm button
 * stays disabled until they arrive, because a confirmation with no number in it
 * is not a confirmation.
 */
export function DeleteFolderDialog({
  folder,
  stats,
  onConfirm,
  onClose,
}: {
  folder: { path: string; label: string } | null;
  stats: FolderStats | null;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}): React.JSX.Element | null {
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (folder) setBusy(false);
  }, [folder]);

  if (!folder) return null;

  return (
    <Modal label="Ordner löschen" onClose={onClose} busy={busy} width="w-[460px]">
      <h2 className="mb-3 text-lg font-semibold text-yellow-400">Ordner löschen</h2>

      <p className="mb-3 break-all text-sm">
        <span className="font-mono text-gray-300">{folder.label}</span>
      </p>

      {stats === null ? (
        <p className="mb-6 text-sm text-gray-400" data-testid="delete-folder-counting">
          Inhalt wird gezählt…
        </p>
      ) : (
        <div className="mb-6 space-y-2 text-sm" data-testid="delete-folder-stats">
          <p className="text-red-400">
            {stats.files} Datei{stats.files === 1 ? '' : 'en'}
            {stats.directories > 0 &&
              ` in ${stats.directories} Unterordner${stats.directories === 1 ? '' : 'n'}`}
            , {formatBytes(stats.bytes)} — endgültig.
          </p>
          {stats.files > stats.mediaFiles && (
            <p className="text-xs text-gray-400">
              Davon zeigt die App nur {stats.mediaFiles}. Der Rest sind RAW-Dateien, Sidecars und
              der Thumbnail-Cache — sie gehen mit.
            </p>
          )}
          <p className="text-xs text-gray-400">
            Kein Papierkorb, kein Rückgängig. Bewertungen liegen in den Dateien und sind mit weg.
          </p>
        </div>
      )}

      <div className="flex justify-end gap-3">
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className="rounded bg-gray-600 px-4 py-2 text-sm font-medium transition-colors hover:bg-gray-500 disabled:opacity-50"
        >
          Abbrechen
        </button>
        <button
          type="button"
          onClick={() => {
            setBusy(true);
            void onConfirm();
          }}
          disabled={busy || stats === null}
          data-testid="delete-folder-confirm"
          className="rounded bg-red-700 px-4 py-2 text-sm font-medium transition-colors hover:bg-red-600 disabled:opacity-50"
        >
          {busy ? 'Wird gelöscht…' : 'Endgültig löschen'}
        </button>
      </div>
    </Modal>
  );
}

/** Folders a move must not offer: the ones the files already sit in. */
export function foldersOfPaths(paths: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const p of paths) {
    const cut = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
    if (cut > 0) out.add(p.slice(0, cut));
  }
  return out;
}

/** Re-exported so App can keep its containment checks in one vocabulary. */
export { isAtOrBelow };
