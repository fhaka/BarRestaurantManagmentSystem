import {
  createContext,
  forwardRef,
  useContext,
  useId,
  type InputHTMLAttributes,
  type LabelHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';
import { AlertCircle } from 'lucide-react';
import { cn } from '../lib/cn.js';

export const controlClasses = [
  'w-full rounded-control border bg-surface px-3 text-sm text-foreground',
  'placeholder:text-foreground-subtle transition-colors duration-150',
  'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:border-ring',
  'disabled:cursor-not-allowed disabled:opacity-60',
].join(' ');

/** Field context wires label, hint and error ids to the control automatically. */
interface FieldContextValue {
  id: string;
  hintId: string;
  errorId: string;
  invalid: boolean;
  hasHint: boolean;
}
const FieldContext = createContext<FieldContextValue | null>(null);

function useFieldA11y(props: { id?: string; 'aria-invalid'?: unknown }) {
  const field = useContext(FieldContext);
  if (!field) return { id: props.id, invalid: Boolean(props['aria-invalid']) };
  const describedBy = [field.hasHint ? field.hintId : null, field.invalid ? field.errorId : null]
    .filter(Boolean)
    .join(' ');
  return {
    id: props.id ?? field.id,
    invalid: field.invalid || Boolean(props['aria-invalid']),
    'aria-describedby': describedBy || undefined,
  };
}

export type InputProps = InputHTMLAttributes<HTMLInputElement>;

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, type = 'text', ...props },
  ref,
) {
  const { invalid, ...a11y } = useFieldA11y(props);
  return (
    <input
      ref={ref}
      type={type}
      className={cn(
        controlClasses,
        'h-11',
        invalid ? 'border-danger focus-visible:ring-danger/30' : 'border-border-strong',
        className,
      )}
      {...props}
      {...a11y}
      aria-invalid={invalid || undefined}
    />
  );
});

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, rows = 3, ...props },
  ref,
) {
  const { invalid, ...a11y } = useFieldA11y(props);
  return (
    <textarea
      ref={ref}
      rows={rows}
      className={cn(
        controlClasses,
        'py-2.5',
        invalid ? 'border-danger focus-visible:ring-danger/30' : 'border-border-strong',
        className,
      )}
      {...props}
      {...a11y}
      aria-invalid={invalid || undefined}
    />
  );
});

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  const field = useContext(FieldContext);
  return (
    <label
      htmlFor={props.htmlFor ?? field?.id}
      className={cn('text-sm font-semibold text-foreground', className)}
      {...props}
    />
  );
}

export interface FieldProps {
  label: ReactNode;
  /** Help text shown under the control. */
  hint?: ReactNode;
  /** Error text; when present the control is marked invalid. Say how to fix the problem. */
  error?: ReactNode;
  /** Id for the control; generated when omitted. */
  id?: string;
  className?: string;
  children: ReactNode;
}

/** Label + control + hint/error, with ARIA wiring. */
export function Field({ label, hint, error, id, className, children }: FieldProps) {
  const generated = useId();
  const controlId = id ?? generated;
  const value: FieldContextValue = {
    id: controlId,
    hintId: `${controlId}-hint`,
    errorId: `${controlId}-error`,
    invalid: Boolean(error),
    hasHint: Boolean(hint),
  };
  return (
    <FieldContext.Provider value={value}>
      <div className={cn('flex flex-col gap-1.5', className)}>
        <Label>{label}</Label>
        {children}
        {hint ? (
          <p id={value.hintId} className="text-xs text-foreground-muted">
            {hint}
          </p>
        ) : null}
        {error ? (
          <p
            id={value.errorId}
            className="flex items-center gap-1.5 text-xs font-medium text-danger"
            role="alert"
          >
            <AlertCircle className="size-3.5 shrink-0" aria-hidden />
            {error}
          </p>
        ) : null}
      </div>
    </FieldContext.Provider>
  );
}

/** Lets custom controls (e.g. Select) pick up the surrounding Field's id and invalid state. */
export function useField() {
  return useContext(FieldContext);
}
