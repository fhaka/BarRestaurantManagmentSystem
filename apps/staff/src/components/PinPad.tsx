import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Delete } from 'lucide-react';
import { cn } from '@tavolina/ui';

const LENGTH = 4;
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;

export interface PinPadProps {
  /** Called when 4 digits are entered. Reject/throw to clear and shake. */
  onComplete: (pin: string) => Promise<void>;
  disabled?: boolean;
  /** Message shown under the dots (e.g. wrong PIN, attempts left). */
  error?: string | null;
}

/**
 * Large-target numeric keypad for PIN entry. Works with touch, mouse and the keyboard
 * (digits, Backspace). Submits automatically at 4 digits.
 */
export function PinPad({ onComplete, disabled, error }: PinPadProps) {
  const { t } = useTranslation('auth');
  const [pin, setPin] = useState('');
  const pinRef = useRef('');
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(false);
  const inactive = Boolean(disabled) || busy;

  const update = (value: string) => {
    pinRef.current = value;
    setPin(value);
  };

  const submit = useCallback(
    async (value: string) => {
      setBusy(true);
      try {
        await onComplete(value);
      } catch {
        setShake(true);
        setTimeout(() => setShake(false), 400);
      } finally {
        update('');
        setBusy(false);
      }
    },
    [onComplete],
  );

  const press = useCallback(
    (digit: string) => {
      if (inactive || pinRef.current.length >= LENGTH) return;
      const next = pinRef.current + digit;
      update(next);
      if (next.length === LENGTH) void submit(next);
    },
    [inactive, submit],
  );

  const backspace = useCallback(() => {
    if (!inactive) update(pinRef.current.slice(0, -1));
  }, [inactive]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey || e.altKey) return;
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') backspace();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [press, backspace]);

  const keyClass =
    'flex h-16 items-center justify-center rounded-card bg-surface text-2xl font-semibold tabular-nums shadow-raised ring-1 ring-border transition-[transform,background-color] active:scale-95 active:bg-surface-sunken disabled:opacity-50 sm:h-[72px]';

  return (
    <div className="flex w-full max-w-xs flex-col items-center gap-6">
      <div className={cn('flex gap-4', shake && 'animate-shake')} aria-hidden>
        {Array.from({ length: LENGTH }, (_, i) => (
          <span
            key={i}
            className={cn(
              'size-4 rounded-full border-2 transition-colors',
              i < pin.length ? 'border-primary bg-primary' : 'border-border-strong',
              error && pin.length === 0 && 'border-danger',
            )}
          />
        ))}
      </div>
      <span className="sr-only" aria-live="polite">
        {t('lock.pinProgress', { count: pin.length })}
      </span>
      <p className="min-h-5 text-center text-sm font-medium text-danger" aria-live="assertive">
        {error ?? ''}
      </p>
      <div className="grid w-full grid-cols-3 gap-3" role="group" aria-label={t('lock.pinLabel')}>
        {KEYS.map((digit) => (
          <button
            key={digit}
            type="button"
            className={keyClass}
            disabled={inactive}
            onClick={() => press(digit)}
            aria-label={t('lock.digit', { digit })}
          >
            {digit}
          </button>
        ))}
        <span aria-hidden />
        <button
          type="button"
          className={keyClass}
          disabled={inactive}
          onClick={() => press('0')}
          aria-label={t('lock.digit', { digit: '0' })}
        >
          0
        </button>
        <button
          type="button"
          className={cn(keyClass, 'bg-transparent shadow-none ring-0')}
          disabled={inactive || pin.length === 0}
          onClick={backspace}
          aria-label={t('lock.delete')}
        >
          <Delete className="size-6" aria-hidden />
        </button>
      </div>
    </div>
  );
}
