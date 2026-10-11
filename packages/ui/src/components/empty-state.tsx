import type { ReactNode } from 'react';
import { cn } from '../lib/cn.js';

export interface EmptyStateProps {
  icon?: ReactNode;
  title: ReactNode;
  /** Explain what to do next, not just that the list is empty. */
  description?: ReactNode;
  /** Primary next step, e.g. a Button. */
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-card border border-dashed border-border-strong px-6 py-12 text-center',
        className,
      )}
    >
      {icon ? (
        <div
          className="mb-1 flex size-12 items-center justify-center rounded-full bg-primary-soft text-primary-soft-fg [&_svg]:size-6"
          aria-hidden
        >
          {icon}
        </div>
      ) : null}
      <h3 className="text-base font-bold tracking-tight">{title}</h3>
      {description ? <p className="max-w-sm text-sm text-foreground-muted">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
