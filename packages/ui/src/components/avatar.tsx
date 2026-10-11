import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../lib/cn.js';

const avatarVariants = cva(
  'inline-flex shrink-0 select-none items-center justify-center rounded-full font-bold uppercase',
  {
    variants: {
      size: {
        sm: 'size-8 text-xs',
        md: 'size-10 text-sm',
        lg: 'size-16 text-xl',
      },
    },
    defaultVariants: { size: 'md' },
  },
);

// Warm, theme-aware tints picked by name so the same person always gets the same colour.
const TINTS = [
  'bg-primary-soft text-primary-soft-fg',
  'bg-highlight-soft text-highlight-soft-fg',
  'bg-info-soft text-info-soft-fg',
  'bg-success-soft text-success-soft-fg',
  'bg-warning-soft text-warning-soft-fg',
  'bg-danger-soft text-danger-soft-fg',
];

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '?';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return `${first}${last}`;
}

function tintFor(name: string): string {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return TINTS[hash % TINTS.length]!;
}

export interface AvatarProps extends VariantProps<typeof avatarVariants> {
  name: string;
  className?: string;
}

/** Initials avatar. Decorative: put the person's name in text next to it. */
export function Avatar({ name, size, className }: AvatarProps) {
  return (
    <span aria-hidden className={cn(avatarVariants({ size }), tintFor(name), className)}>
      {initials(name)}
    </span>
  );
}
