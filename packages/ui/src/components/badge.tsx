import type { HTMLAttributes, ReactNode } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../lib/cn.js';

export const badgeVariants = cva(
  'inline-flex items-center gap-1 whitespace-nowrap rounded-full font-semibold leading-none [&_svg]:size-3.5 [&_svg]:shrink-0',
  {
    variants: {
      tone: {
        neutral: 'bg-surface-sunken text-foreground-muted ring-1 ring-inset ring-border',
        primary: 'bg-primary-soft text-primary-soft-fg',
        highlight: 'bg-highlight-soft text-highlight-soft-fg',
        success: 'bg-success-soft text-success-soft-fg',
        warning: 'bg-warning-soft text-warning-soft-fg',
        danger: 'bg-danger-soft text-danger-soft-fg',
        info: 'bg-info-soft text-info-soft-fg',
        reserved: 'bg-reserved-soft text-reserved-soft-fg',
        solid: 'bg-primary text-primary-fg',
      },
      size: {
        sm: 'h-5 px-2 text-[11px]',
        md: 'h-6 px-2.5 text-xs',
        lg: 'h-8 px-3 text-sm',
      },
    },
    defaultVariants: { tone: 'neutral', size: 'md' },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {
  /** Leading icon. Status badges should always pair colour with an icon and a label. */
  icon?: ReactNode;
}

export function Badge({ className, tone, size, icon, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ tone, size }), className)} {...props}>
      {icon}
      {children}
    </span>
  );
}
