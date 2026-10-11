import type { HTMLAttributes } from 'react';
import { cn } from '../lib/cn.js';

/** Placeholder block with a soft shimmer. Size it with width/height classes. */
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden
      className={cn(
        'relative overflow-hidden rounded-control bg-surface-sunken',
        'before:absolute before:inset-0 before:-translate-x-full before:animate-shimmer',
        'before:bg-gradient-to-r before:from-transparent before:via-foreground/[0.06] before:to-transparent',
        className,
      )}
      {...props}
    />
  );
}
