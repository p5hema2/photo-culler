import { useState } from 'react';

interface StarRatingProps {
  rating: number | undefined;
  onChange?: (rating: number) => void;
  size?: 'sm' | 'md';
  readonly?: boolean;
}

const SIZE_CONFIG = {
  sm: { starSize: 10, gap: 1 },
  md: { starSize: 16, gap: 2 },
};

function StarIcon({ filled, size }: { filled: boolean; size: number }): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? '#EAB308' : 'none'}
      stroke={filled ? '#EAB308' : '#6B7280'}
      strokeWidth={1.5}
    >
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
    </svg>
  );
}

export function StarRating({
  rating,
  onChange,
  size = 'md',
  readonly = false,
}: StarRatingProps): React.JSX.Element {
  const [hoveredStar, setHoveredStar] = useState<number | null>(null);
  const config = SIZE_CONFIG[size];
  const isInteractive = !readonly && onChange != null;
  const displayRating = hoveredStar ?? (rating ?? 0);

  return (
    <div
      className="inline-flex items-center"
      style={{ gap: config.gap }}
      onMouseLeave={() => {
        if (isInteractive) setHoveredStar(null);
      }}
    >
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          className={`p-0 border-0 bg-transparent ${isInteractive ? 'cursor-pointer' : 'cursor-default'}`}
          style={{ lineHeight: 0 }}
          onClick={(e) => {
            if (isInteractive) {
              e.stopPropagation();
              onChange!(star);
            }
          }}
          onMouseEnter={() => {
            if (isInteractive) setHoveredStar(star);
          }}
          disabled={!isInteractive}
          tabIndex={isInteractive ? 0 : -1}
          aria-label={`${star} star${star !== 1 ? 's' : ''}`}
        >
          <StarIcon filled={star <= displayRating} size={config.starSize} />
        </button>
      ))}
    </div>
  );
}
