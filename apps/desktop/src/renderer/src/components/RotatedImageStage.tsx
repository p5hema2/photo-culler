interface RotatedImageStageProps {
  /** Natural pixel size of the image. Overlay canvases are sized to this. */
  width: number;
  height: number;
  /** User rotation in degrees (0, 90, 180, 270). */
  rotation: number;
  /** The <img> first, then any number of absolutely positioned overlay canvases. */
  children: React.ReactNode;
}

/**
 * Applies user rotation to an image AND every overlay drawn on top of it.
 *
 * The rotation used to sit on the <img> itself, so the overlay canvases — which
 * are `absolute top-0 left-0` siblings — stayed unrotated and drifted out of
 * alignment on any rotated photo. Moving the transform onto a wrapper that
 * contains both means CSS rotates them together, and every future overlay is
 * correct by construction instead of by remembering to redo the maths.
 *
 * The outer box carries the post-rotation footprint so the surrounding layout
 * reserves the right space: a rotated portrait image is laid out as landscape.
 */
export function RotatedImageStage({
  width,
  height,
  rotation,
  children,
}: RotatedImageStageProps): React.JSX.Element {
  const deg = (((Math.round(rotation / 90) * 90) % 360) + 360) % 360;
  const swap = deg === 90 || deg === 270;

  // Before onLoad the natural size is unknown. Fall back to letting the <img>
  // size the box itself, which is the pre-existing behaviour on first paint.
  if (!(width > 0) || !(height > 0)) {
    return <div style={{ position: 'relative', display: 'inline-block' }}>{children}</div>;
  }

  const outer = { width: swap ? height : width, height: swap ? width : height };

  return (
    <div style={{ position: 'relative', display: 'inline-block', ...outer }}>
      <div
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          width,
          height,
          transform: `translate(-50%, -50%)${deg ? ` rotate(${deg}deg)` : ''}`,
          transformOrigin: 'center center',
        }}
      >
        {children}
      </div>
    </div>
  );
}
