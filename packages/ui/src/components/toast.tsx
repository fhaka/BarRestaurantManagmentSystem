import { useSyncExternalStore, type ReactNode } from 'react';
import * as ToastPrimitive from '@radix-ui/react-toast';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { cn } from '../lib/cn.js';

export type ToastTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

export interface ToastOptions {
  title: ReactNode;
  description?: ReactNode;
  tone?: ToastTone;
  /** Milliseconds; defaults to 4000 (errors stay 7000). */
  duration?: number;
  action?: { label: string; onClick: () => void };
}

interface ToastRecord extends ToastOptions {
  id: number;
  open: boolean;
}

// A tiny module-level store so `toast()` can be called from anywhere (mutations, sockets).
let toasts: ToastRecord[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function dismiss(id: number) {
  toasts = toasts.map((t) => (t.id === id ? { ...t, open: false } : t));
  emit();
  // Remove after the exit animation.
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    emit();
  }, 200);
}

export function toast(options: ToastOptions): number {
  const id = nextId++;
  toasts = [...toasts.slice(-4), { ...options, id, open: true }];
  emit();
  return id;
}
toast.success = (title: ReactNode, description?: ReactNode) =>
  toast({ title, description, tone: 'success' });
toast.error = (title: ReactNode, description?: ReactNode) =>
  toast({ title, description, tone: 'danger' });
toast.dismiss = dismiss;

const toneIcon: Record<ToastTone, ReactNode> = {
  neutral: null,
  success: <CheckCircle2 className="text-success" aria-hidden />,
  warning: <AlertTriangle className="text-warning" aria-hidden />,
  danger: <XCircle className="text-danger" aria-hidden />,
  info: <Info className="text-info" aria-hidden />,
};

export interface ToasterProps {
  closeLabel?: string;
}

/** Mount once near the app root. */
export function Toaster({ closeLabel = 'Close' }: ToasterProps) {
  const items = useSyncExternalStore(subscribe, () => toasts);
  return (
    <ToastPrimitive.Provider swipeDirection="right">
      {items.map((t) => {
        const tone = t.tone ?? 'neutral';
        return (
          <ToastPrimitive.Root
            key={t.id}
            open={t.open}
            onOpenChange={(open) => {
              if (!open) dismiss(t.id);
            }}
            duration={t.duration ?? (tone === 'danger' ? 7000 : 4000)}
            type={tone === 'danger' ? 'foreground' : 'background'}
            className={cn(
              'group pointer-events-auto relative flex w-full items-start gap-3 rounded-card border border-border bg-surface-raised p-4 pr-10 text-foreground shadow-overlay',
              'data-[state=open]:animate-toast-in data-[state=closed]:animate-fade-out',
              'data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)] data-[swipe=end]:animate-fade-out',
              '[&>svg]:mt-0.5 [&>svg]:size-5 [&>svg]:shrink-0',
            )}
          >
            {toneIcon[tone]}
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <ToastPrimitive.Title className="text-sm font-semibold">
                {t.title}
              </ToastPrimitive.Title>
              {t.description ? (
                <ToastPrimitive.Description className="text-sm text-foreground-muted">
                  {t.description}
                </ToastPrimitive.Description>
              ) : null}
              {t.action ? (
                <ToastPrimitive.Action
                  altText={t.action.label}
                  onClick={t.action.onClick}
                  className="mt-1 self-start text-sm font-semibold text-primary hover:underline"
                >
                  {t.action.label}
                </ToastPrimitive.Action>
              ) : null}
            </div>
            <ToastPrimitive.Close
              aria-label={closeLabel}
              className="absolute right-2 top-2 inline-flex size-8 items-center justify-center rounded-control text-foreground-muted hover:bg-surface-sunken hover:text-foreground"
            >
              <X className="size-4" aria-hidden />
            </ToastPrimitive.Close>
          </ToastPrimitive.Root>
        );
      })}
      <ToastPrimitive.Viewport className="fixed bottom-0 right-0 z-[100] flex max-h-screen w-full flex-col gap-2 p-4 outline-hidden sm:max-w-sm" />
    </ToastPrimitive.Provider>
  );
}
