import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type ElementRef,
  type HTMLAttributes,
} from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { cva, type VariantProps } from 'class-variance-authority';
import { X } from 'lucide-react';
import { cn } from '../lib/cn.js';
import { DialogOverlay } from './dialog.js';

/** A Sheet is a Dialog that slides in from an edge. Bottom sheets are the phone default. */
export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;
export const SheetTitle = DialogPrimitive.Title;
export const SheetDescription = DialogPrimitive.Description;

const sheetVariants = cva(
  'fixed z-50 flex flex-col gap-4 border-border bg-surface-raised p-6 text-foreground shadow-overlay data-[state=closed]:animate-fade-out',
  {
    variants: {
      side: {
        right:
          'inset-y-0 right-0 h-full w-[min(100vw,28rem)] border-l data-[state=open]:animate-slide-in-right',
        left: 'inset-y-0 left-0 h-full w-[min(100vw,22rem)] border-r data-[state=open]:animate-slide-in-left',
        bottom:
          'inset-x-0 bottom-0 max-h-[90dvh] rounded-t-[20px] border-t pb-[max(1.5rem,env(safe-area-inset-bottom))] data-[state=open]:animate-slide-in-bottom',
      },
    },
    defaultVariants: { side: 'right' },
  },
);

export interface SheetContentProps
  extends
    ComponentPropsWithoutRef<typeof DialogPrimitive.Content>,
    VariantProps<typeof sheetVariants> {
  closeLabel?: string;
}

export const SheetContent = forwardRef<
  ElementRef<typeof DialogPrimitive.Content>,
  SheetContentProps
>(function SheetContent({ side, className, children, closeLabel = 'Close', ...props }, ref) {
  return (
    <DialogPrimitive.Portal>
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(sheetVariants({ side }), className)}
        {...props}
      >
        {side === 'bottom' ? (
          <div
            className="mx-auto -mt-2 h-1.5 w-10 shrink-0 rounded-full bg-border-strong"
            aria-hidden
          />
        ) : null}
        <div className="flex-1 overflow-y-auto">{children}</div>
        <DialogPrimitive.Close
          className="absolute right-3 top-3 inline-flex size-10 items-center justify-center rounded-control text-foreground-muted transition-colors hover:bg-surface-sunken hover:text-foreground"
          aria-label={closeLabel}
        >
          <X className="size-4" aria-hidden />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
});

export function SheetHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('mb-4 flex flex-col gap-1 pr-10', className)} {...props} />;
}
