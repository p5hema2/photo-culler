interface EmptyStateProps {
  message?: string;
}

export function EmptyState({
  message = 'No images found in this folder',
}: EmptyStateProps): React.JSX.Element {
  return (
    <div
      className="flex flex-col items-center justify-center h-full text-gray-400"
      data-testid="empty-state"
    >
      <svg
        className="w-16 h-16 mb-4 text-gray-600"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1}
          d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
        />
      </svg>
      <p className="text-lg">{message}</p>
    </div>
  );
}
