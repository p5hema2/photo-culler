import { useState } from 'react';

interface CollapsibleSectionProps {
  title: string;
  /** Shown in muted text next to the title, e.g. a tag count. */
  badge?: string | number;
  defaultOpen?: boolean;
  testId?: string;
  children: React.ReactNode;
}

/**
 * A disclosure section in the info panel.
 *
 * The panel's job is to answer "keep or reject?" at a glance, so only the
 * histogram, the quality score and the exposure line stay permanently visible.
 * Everything else lives behind one of these, one click away.
 *
 * Header styling matches the existing group labels so an open section looks
 * exactly like the old always-on layout.
 */
export function CollapsibleSection({
  title,
  badge,
  defaultOpen = false,
  testId,
  children,
}: CollapsibleSectionProps): React.JSX.Element {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="flex flex-col gap-1.5" data-testid={testId}>
      <button
        onClick={() => setOpen((prev) => !prev)}
        className="flex items-center gap-1.5 text-gray-500 uppercase tracking-wider text-[10px] font-semibold text-left hover:text-gray-300 transition-colors"
        data-testid={testId ? `${testId}-toggle` : undefined}
        aria-expanded={open}
      >
        <span className="inline-block w-2">{open ? '▾' : '▸'}</span>
        <span>{title}</span>
        {badge !== undefined && <span className="text-gray-600 normal-case">({badge})</span>}
      </button>
      {open && children}
    </div>
  );
}
