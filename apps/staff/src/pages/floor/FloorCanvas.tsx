import { forwardRef, useEffect, useRef, useState, type ReactNode } from 'react';
import type { TableShape } from '@tavolina/shared';
import { cn } from '@tavolina/ui';

/** Smallest cell size before the canvas scrolls instead of shrinking (keeps tables tappable). */
const MIN_CELL = 16;

export interface FloorCanvasProps {
  cols: number;
  rows: number;
  showGrid?: boolean;
  className?: string;
  children: (cell: number) => ReactNode;
  onBackgroundPointerDown?: () => void;
}

/**
 * A grid that scales to the available width. Children are positioned in grid cells by the caller
 * (left = x * cell). Below MIN_CELL the canvas keeps its size and the container scrolls.
 */
export const FloorCanvas = forwardRef<HTMLDivElement, FloorCanvasProps>(function FloorCanvas(
  { cols, rows, showGrid = false, className, children, onBackgroundPointerDown },
  ref,
) {
  const wrapper = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = wrapper.current;
    if (!el) return;
    // Measure now too: the observer's first callback can be delayed (e.g. in background tabs).
    setWidth(el.clientWidth);
    const observer = new ResizeObserver(([entry]) => setWidth(entry!.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const cell = Math.max(MIN_CELL, Math.floor(width / cols));

  return (
    <div
      ref={wrapper}
      className={cn(
        'w-full overflow-auto rounded-card border border-border bg-surface-sunken',
        className,
      )}
    >
      {width > 0 ? (
        <div
          ref={ref}
          className="relative"
          style={{
            width: cell * cols,
            height: cell * rows,
            backgroundImage: showGrid
              ? 'radial-gradient(circle, rgb(var(--border-strong)) 1px, transparent 1px)'
              : undefined,
            backgroundSize: showGrid ? `${cell}px ${cell}px` : undefined,
            backgroundPosition: showGrid ? `-${cell / 2}px -${cell / 2}px` : undefined,
          }}
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) onBackgroundPointerDown?.();
          }}
        >
          {children(cell)}
        </div>
      ) : null}
    </div>
  );
});

/** The drawn table (rotated) behind an unrotated label layer. */
export function TableShapeView({
  shape,
  rotation,
  className,
}: {
  shape: TableShape;
  rotation: number;
  className?: string;
}) {
  const round = shape === 'round' || shape === 'bar_stool';
  return (
    <span
      aria-hidden
      className={cn(
        'absolute inset-0 border-2 transition-colors',
        round ? 'rounded-full' : shape === 'rectangle' ? 'rounded-[12px]' : 'rounded-[10px]',
        className,
      )}
      style={{ transform: rotation ? `rotate(${rotation}deg)` : undefined }}
    />
  );
}
