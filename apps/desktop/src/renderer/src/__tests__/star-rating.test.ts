import { describe, it, expect, vi, afterEach, type Mock } from 'vitest';
import { render, fireEvent, cleanup, screen } from '@testing-library/react';
import { createElement } from 'react';
import { StarRating } from '../components/StarRating';
import type { StarRatingSize } from '../components/StarRating';

describe('StarRating', () => {
  let onRate: Mock<(rating: number) => void>;

  afterEach(() => {
    cleanup();
  });

  function renderStars(props: {
    rating: number | undefined;
    interactive?: boolean;
    size?: StarRatingSize;
    focusable?: boolean;
  }) {
    onRate = vi.fn<(rating: number) => void>();
    return render(
      createElement(StarRating, {
        rating: props.rating,
        onRate,
        interactive: props.interactive ?? true,
        size: props.size ?? 'md',
        focusable: props.focusable,
      }),
    );
  }

  /** The five targets, in order — `data-rating` is the value each one sets. */
  function starButtons(): HTMLElement[] {
    return Array.from(document.querySelectorAll<HTMLElement>('button[data-rating]'));
  }

  it('renders five stars whatever the file held', () => {
    renderStars({ rating: 3 });
    expect(starButtons().map((b) => b.dataset.rating)).toEqual(['1', '2', '3', '4', '5']);
  });

  // The file on disk is the authority and may legally hold -1 (rejected) or a
  // fractional rating; an unguarded index would blank the whole window.
  it.each([
    [2.5, '3 of 5 stars'],
    [-1, '0 of 5 stars'],
    [99, '5 of 5 stars'],
    [undefined, '0 of 5 stars'],
  ])('clamps %s for display', (rating, label) => {
    renderStars({ rating: rating as number | undefined, interactive: false });
    expect(screen.getByTestId('star-rating')).toHaveProperty('ariaLabel', label);
  });

  it('sets the rating of the star that was clicked', () => {
    renderStars({ rating: 0 });
    fireEvent.click(starButtons()[3]!);
    expect(onRate).toHaveBeenCalledWith(4);
  });

  it('clears the rating when the star already set is clicked again', () => {
    renderStars({ rating: 4 });
    fireEvent.click(starButtons()[3]!);
    expect(onRate).toHaveBeenCalledWith(0);
  });

  it('offers no targets at all when not interactive', () => {
    renderStars({ rating: 2, interactive: false });
    expect(starButtons()).toHaveLength(0);
  });

  // The grid is one role=grid with a single tab stop. Five focusable buttons per
  // cell, mounting and unmounting as the virtualizer scrolls, would bury it.
  it('is not focusable by default', () => {
    renderStars({ rating: 2 });
    expect(starButtons().map((b) => b.tabIndex)).toEqual([-1, -1, -1, -1, -1]);
    expect(screen.getByTestId('star-rating').getAttribute('role')).toBe('img');
  });

  it('is a radiogroup when the caller asks for one', () => {
    renderStars({ rating: 2, focusable: true });
    expect(screen.getByTestId('star-rating').getAttribute('role')).toBe('radiogroup');
    expect(starButtons().map((b) => b.getAttribute('aria-checked'))).toEqual([
      'false',
      'true',
      'false',
      'false',
      'false',
    ]);
    expect(starButtons().every((b) => b.tabIndex === 0)).toBe(true);
  });
});
