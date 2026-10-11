import { Loader2 } from 'lucide-react';
import { cn } from '../lib/cn.js';

export interface SpinnerProps {
  className?: string;
  /** Accessible label; omit when the spinner sits inside a labelled control. */
  label?: string;
}

export function Spinner({ className, label }: SpinnerProps) {
  return (
    <Loader2
      className={cn('size-4 animate-spin', className)}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'status' : undefined}
    />
  );
}
