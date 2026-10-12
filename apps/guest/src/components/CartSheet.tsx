import { useTranslation } from 'react-i18next';
import { Minus, Pencil, Plus, Trash2 } from 'lucide-react';
import { formatMoney } from '@tavolina/shared/client';
import type { GuestMenu } from '@tavolina/shared';
import { Button, Sheet, SheetContent, SheetTitle } from '@tavolina/ui';
import { describe, type GuestCartLine } from '../lib/cart';

export function CartSheet({
  open,
  onOpenChange,
  menu,
  lines,
  requiresConfirmation,
  sending,
  onQty,
  onEdit,
  onOrder,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  menu: GuestMenu;
  lines: GuestCartLine[];
  requiresConfirmation: boolean;
  sending: boolean;
  onQty: (uuid: string, qty: number) => void;
  onEdit: (line: GuestCartLine) => void;
  onOrder: () => void;
}) {
  const { t } = useTranslation();
  const currency = menu.location.currencyDisplay;
  const views = lines.map((line) => ({ line, view: describe(menu, line) }));
  const total = views.reduce((sum, v) => sum + v.view.totalMinor, 0);
  const missing = views.some((v) => v.view.missing);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" closeLabel={t('close')} className="max-h-[92dvh]">
        <SheetTitle className="text-2xl font-extrabold tracking-tight">
          {t('cart.title')}
        </SheetTitle>
        {lines.length === 0 ? (
          <p className="py-8 text-center text-foreground-muted">{t('cart.empty')}</p>
        ) : (
          <ul className="mt-4 flex flex-col divide-y divide-border">
            {views.map(({ line, view }) => (
              <li key={line.uuid} className="flex items-start gap-3 py-3">
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => onEdit(line)}
                  disabled={view.missing}
                >
                  <span className="flex items-center gap-1.5 font-bold">
                    {view.name}
                    {!view.missing ? (
                      <Pencil className="size-3.5 text-foreground-subtle" aria-hidden />
                    ) : null}
                  </span>
                  {view.details.length ? (
                    <span className="block text-sm text-foreground-muted">
                      {view.details.join(' · ')}
                    </span>
                  ) : null}
                  {line.notes ? (
                    <span className="block text-sm italic text-foreground-muted">
                      “{line.notes}”
                    </span>
                  ) : null}
                  {view.missing ? (
                    <span className="block text-sm font-semibold text-danger">
                      {t('cart.soldOut')}
                    </span>
                  ) : null}
                </button>
                <div className="flex flex-col items-end gap-1.5">
                  <span className="font-mono font-semibold tabular-nums">
                    {formatMoney(view.totalMinor, { currency })}
                  </span>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="icon-sm"
                      aria-label={
                        line.qty === 1
                          ? t('cart.remove', { name: view.name })
                          : t('cart.less', { name: view.name })
                      }
                      onClick={() => onQty(line.uuid, line.qty - 1)}
                    >
                      {line.qty === 1 ? <Trash2 /> : <Minus />}
                    </Button>
                    <span className="w-7 text-center font-mono font-bold tabular-nums">
                      {line.qty}
                    </span>
                    <Button
                      variant="outline"
                      size="icon-sm"
                      aria-label={t('cart.more', { name: view.name })}
                      disabled={line.qty >= 20 || view.missing}
                      onClick={() => onQty(line.uuid, line.qty + 1)}
                    >
                      <Plus />
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
        {lines.length ? (
          <div className="mt-2 flex flex-col gap-3 border-t border-border pt-4">
            <div className="flex items-baseline justify-between">
              <span className="text-foreground-muted">{t('cart.total')}</span>
              <span className="font-mono text-xl font-bold tabular-nums">
                {formatMoney(total, { currency })}
              </span>
            </div>
            <Button size="xl" block loading={sending} disabled={missing} onClick={onOrder}>
              {t('cart.order')}
            </Button>
            <p className="text-center text-sm text-foreground-muted">
              {missing
                ? t('cart.removeSoldOut')
                : requiresConfirmation
                  ? t('cart.confirmNote')
                  : t('cart.directNote')}
            </p>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
