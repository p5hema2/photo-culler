import { useEffect, useRef, useState } from 'react';
// The bindings themselves, from the hook that implements them. This panel and
// the context menu were both carrying their own copies of these labels, which is
// two places for them to drift from the keys actually being listened for.
import { SHORTCUTS } from '../hooks/useKeyboardNav';

interface ShortcutsTutorialProps {
  isOpen: boolean;
  onClose: () => void;
}

interface ShortcutEntry {
  keys: string;
  description: string;
}

interface ShortcutSection {
  title: string;
  shortcuts: ShortcutEntry[];
}

const SECTIONS: ShortcutSection[] = [
  {
    title: 'Rating',
    shortcuts: [
      { keys: '1 \u2013 5', description: 'Rate the selection' },
      { keys: '0', description: 'Clear the rating' },
      { keys: 'Click a star', description: 'Rate that one image that many stars' },
      { keys: 'Click the lit star', description: 'Clear that image’s rating' },
    ],
  },
  {
    title: 'Selection',
    shortcuts: [
      { keys: 'Click', description: 'Select one image' },
      { keys: 'Shift + click', description: 'Select everything in between' },
      { keys: '\u2318/Ctrl + click', description: 'Add or remove one image' },
      { keys: 'Right click', description: 'Menu: rating, rotate, delete' },
      { keys: 'Arrow keys', description: 'Move the cursor — collapses the selection' },
    ],
  },
  {
    title: 'Navigation',
    shortcuts: [
      { keys: '\u2190 \u2192 \u2191 \u2193', description: 'Navigate grid (row & column aware)' },
      { keys: 'Home', description: 'Jump to first image' },
      { keys: 'End', description: 'Jump to last image' },
    ],
  },
  {
    title: 'Actions',
    shortcuts: [
      { keys: SHORTCUTS.rotate.cw.label, description: 'Rotate the selection clockwise' },
      { keys: SHORTCUTS.rotate.ccw.label, description: 'Rotate the selection counter-clockwise' },
      {
        // Both keys, unlike the context menu, which has room for one \u2014 hence
        // `keys` rather than `label`.
        keys: SHORTCUTS.delete.keys.join(' / '),
        description: 'Delete the selection (permanent)',
      },
      { keys: '\u2318/Ctrl + O', description: 'Open folder' },
      {
        keys: 'F5',
        description: 'Rescan folder \u2014 new images in, missing ones out, scores kept',
      },
      { keys: '\u2318/Ctrl + S', description: 'Execute \u2014 delete low-rated images' },
    ],
  },
  {
    title: 'View',
    shortcuts: [
      { keys: 'V', description: 'Cycle layout: Grid / Loupe / Filmstrip' },
      { keys: '\u2318/Ctrl + 1 / 2 / 3', description: 'Go straight to Grid / Loupe / Filmstrip' },
      { keys: 'I', description: 'Toggle metadata overlay (Loupe/Filmstrip)' },
      { keys: '\u2318/Ctrl + I', description: 'Toggle info panel' },
      { keys: 'Scroll wheel', description: 'Zoom in / out (Loupe/Filmstrip)' },
      { keys: 'Double-click', description: 'Toggle fit / 100% zoom' },
    ],
  },
  {
    title: 'Overlays',
    shortcuts: [
      { keys: 'P', description: 'Toggle focus peaking (threshold adjustable)' },
      { keys: 'C', description: 'Toggle exposure clipping' },
      { keys: 'A', description: 'Toggle AF point — where the camera focused' },
      {
        keys: '⌘/Ctrl + Shift + P / K / A',
        description: 'Same three, from the View › Overlays menu',
      },
    ],
  },
  {
    title: 'Help',
    shortcuts: [
      { keys: '?', description: 'Show / hide this panel' },
      { keys: '\u2318/Ctrl + /', description: 'Show / hide this panel' },
      { keys: 'Alt', description: 'Reveal the menu bar (Windows/Linux)' },
    ],
  },
];

export function ShortcutsTutorial({
  isOpen,
  onClose,
}: ShortcutsTutorialProps): React.JSX.Element | null {
  const ref = useRef<HTMLDivElement>(null);
  const [version, setVersion] = useState<string | null>(null);

  // Fetched lazily on first open — the version comes from the main process,
  // where it was stamped from the git tag at build time.
  useEffect(() => {
    if (!isOpen || version !== null) return;
    let cancelled = false;
    window.api
      ?.getAppVersion()
      .then((v) => {
        if (!cancelled) setVersion(v);
      })
      .catch(() => {
        // Version is decorative — a failure must not block the panel
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, version]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === '?') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', handleKey, true);
    return () => document.removeEventListener('keydown', handleKey, true);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div
        ref={ref}
        className="bg-gray-800 border border-gray-600 rounded-xl shadow-2xl max-w-lg w-full max-h-[80vh] overflow-y-auto"
        data-testid="shortcuts-tutorial"
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-700">
          <h2 className="text-sm font-semibold text-white">Keyboard Shortcuts</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-lg leading-none">
            &times;
          </button>
        </div>

        <div className="p-5 flex flex-col gap-5">
          {SECTIONS.map((section) => (
            <div key={section.title}>
              <h3 className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold mb-2">
                {section.title}
              </h3>
              <div className="flex flex-col gap-1">
                {section.shortcuts.map((shortcut) => (
                  <div
                    key={shortcut.keys}
                    className="flex items-center justify-between text-xs py-0.5"
                  >
                    <span className="text-gray-300">{shortcut.description}</span>
                    <kbd className="ml-4 px-2 py-0.5 bg-gray-700 border border-gray-600 rounded text-gray-300 font-mono text-[11px] whitespace-nowrap">
                      {shortcut.keys}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="px-5 py-3 border-t border-gray-700 flex items-center justify-between gap-3 text-[10px] text-gray-500">
          <span data-testid="app-version">Photo Culler{version ? ` v${version}` : ''}</span>
          <span>
            Press <kbd className="px-1 py-0.5 bg-gray-700 rounded text-gray-400 font-mono">?</kbd>{' '}
            or <kbd className="px-1 py-0.5 bg-gray-700 rounded text-gray-400 font-mono">Escape</kbd>{' '}
            to close
          </span>
        </div>
      </div>
    </div>
  );
}
