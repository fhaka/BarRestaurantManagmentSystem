import {
  forwardRef,
  useId,
  type ComponentPropsWithoutRef,
  type ElementRef,
  type ReactNode,
} from 'react';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import { cn } from '../lib/cn.js';

export const Switch = forwardRef<
  ElementRef<typeof SwitchPrimitive.Root>,
  ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(function Switch({ className, ...props }, ref) {
  return (
    <SwitchPrimitive.Root
      ref={ref}
      className={cn(
        'peer inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'data-[state=checked]:bg-primary data-[state=unchecked]:bg-border-strong',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="pointer-events-none block size-6 rounded-full bg-surface-raised shadow-raised ring-0 transition-transform data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0" />
    </SwitchPrimitive.Root>
  );
});

export interface SwitchFieldProps extends ComponentPropsWithoutRef<typeof SwitchPrimitive.Root> {
  label: ReactNode;
  description?: ReactNode;
}

/** A labelled switch row: label and help text on the left, switch on the right. */
export function SwitchField({ label, description, className, id, ...props }: SwitchFieldProps) {
  const generated = useId();
  const switchId = id ?? generated;
  const descriptionId = description ? `${switchId}-description` : undefined;
  return (
    <div className={cn('flex items-start justify-between gap-4 py-3', className)}>
      <div className="flex flex-col gap-0.5">
        <label htmlFor={switchId} className="cursor-pointer text-sm font-semibold">
          {label}
        </label>
        {description ? (
          <p id={descriptionId} className="text-sm text-foreground-muted">
            {description}
          </p>
        ) : null}
      </div>
      <Switch id={switchId} aria-describedby={descriptionId} {...props} />
    </div>
  );
}
