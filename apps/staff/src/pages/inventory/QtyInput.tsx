import { useTranslation } from 'react-i18next';
import type { StockUnit } from '@tavolina/shared';
import { Input, cn } from '@tavolina/ui';

/** A quantity typed as a decimal ("0.018", "1,5") with the ingredient's unit shown after it. */
export function QtyInput({
  value,
  onChange,
  unit,
  className,
  ...props
}: {
  value: string;
  onChange: (value: string) => void;
  unit: StockUnit | null;
  className?: string;
  id?: string;
  'aria-label'?: string;
  'aria-invalid'?: boolean;
}) {
  const { t } = useTranslation('inventory');
  return (
    <div className="relative">
      <Input
        inputMode="decimal"
        className={cn('pr-12 font-mono tabular-nums', className)}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^\d.,]/g, ''))}
        {...props}
      />
      {unit ? (
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-foreground-subtle">
          {t(`units.${unit}`)}
        </span>
      ) : null}
    </div>
  );
}
