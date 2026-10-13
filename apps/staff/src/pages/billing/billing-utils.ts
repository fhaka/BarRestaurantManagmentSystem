import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Banknote, CreditCard, Ticket, Wallet, type LucideIcon } from 'lucide-react';
import type { Bill, BillView, PaymentMethod } from '@tavolina/shared';
import { api } from '../../lib/api';
import { useSession } from '../../lib/session';

export function useBillQuery(orderRef: string) {
  const locationId = useSession((s) => s.locationId);
  return useQuery({
    queryKey: ['bill', locationId, orderRef],
    queryFn: () => api<BillView>('GET', `/orders/${orderRef}/bill`),
    refetchInterval: 30_000,
  });
}

export const METHOD_ICON: Record<PaymentMethod, LucideIcon> = {
  cash: Banknote,
  card: CreditCard,
  voucher: Ticket,
  account: Wallet,
};

/** "1/3", "Vendi 2", "Të përbashkëta", "Fatura 1". */
export function useBillLabel() {
  const { t } = useTranslation('billing');
  return (bill: Pick<Bill, 'label' | 'splitType'>) => {
    if (bill.splitType === 'full') return t('bill.whole');
    if (bill.label === 'shared') return t('bill.shared');
    if (bill.label.startsWith('seat:')) return t('bill.seat', { n: bill.label.slice(5) });
    if (bill.splitType === 'equal') return t('bill.part', { part: bill.label });
    return t('bill.numbered', { n: bill.label });
  };
}

/** Whole-lek amounts the cashier can tap as "the guest gave me…". */
export function quickTender(dueMinor: number): number[] {
  const due = Math.ceil(dueMinor / 100);
  const options = new Set<number>([due]);
  for (const step of [500, 1000, 2000, 5000]) {
    const next = Math.ceil(due / step) * step;
    if (next > due) options.add(next);
  }
  return [...options].slice(0, 5).map((lek) => lek * 100);
}
