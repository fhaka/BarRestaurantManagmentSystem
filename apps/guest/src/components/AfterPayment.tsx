import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Heart, ReceiptText, Star } from 'lucide-react';
import { formatMoney } from '@tavolina/shared/client';
import type { GuestTableState } from '@tavolina/shared';
import { Button, Textarea, cn, toast } from '@tavolina/ui';
import { guestApi } from '../lib/api';

/** After paying: links to the digital receipts and "Leave a review" (plan §5.5). */
export function AfterPayment({
  tableToken,
  state,
  currency,
}: {
  tableToken: string;
  state: GuestTableState;
  currency: 'L' | 'ALL';
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const review = useMutation({
    mutationFn: () =>
      guestApi<GuestTableState>('POST', `/t/${tableToken}/review`, {
        rating,
        comment: comment.trim() || null,
      }),
    onSuccess: (next) => {
      queryClient.setQueryData(['state', tableToken], next);
      toast({ tone: 'success', title: t('review.thanks') });
    },
    onError: () => toast({ tone: 'danger', title: t('errors.generic') }),
  });
  if (!state.receipts.length && !state.review) return null;
  return (
    <section className="mx-4 mb-3 flex flex-col gap-3 rounded-card border border-success bg-success-soft p-4 text-success-soft-fg">
      {state.receipts.length ? (
        <div className="flex flex-col gap-2">
          <p className="font-bold">{t('review.paid')}</p>
          <div className="flex flex-wrap gap-2">
            {state.receipts.map((r) => (
              <a
                key={r.token}
                href={`/r/${r.token}`}
                className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-success bg-surface px-3 text-sm font-semibold text-foreground"
              >
                <ReceiptText className="size-4" aria-hidden />
                {t('review.receipt', { amount: formatMoney(r.totalMinor, { currency }) })}
              </a>
            ))}
          </div>
        </div>
      ) : null}
      {state.review === 'available' ? (
        <div className="flex flex-col gap-2">
          <p className="font-bold">{t('review.question')}</p>
          <div className="flex gap-1" role="radiogroup" aria-label={t('review.rating')}>
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={rating === n}
                aria-label={t('review.stars', { count: n })}
                onClick={() => setRating(n)}
                className="p-1"
              >
                <Star
                  className={cn(
                    'size-9',
                    n <= rating ? 'fill-highlight text-highlight' : 'text-foreground-subtle',
                  )}
                />
              </button>
            ))}
          </div>
          {rating ? (
            <>
              <Textarea
                rows={2}
                maxLength={1000}
                placeholder={t('review.commentPlaceholder')}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                className="bg-surface text-foreground"
              />
              <Button loading={review.isPending} onClick={() => review.mutate()}>
                {t('review.send')}
              </Button>
            </>
          ) : null}
        </div>
      ) : null}
      {state.review === 'done' ? (
        <p className="flex items-center gap-2 font-semibold">
          <Heart className="size-4" aria-hidden />
          {t('review.thanks')}
        </p>
      ) : null}
    </section>
  );
}
