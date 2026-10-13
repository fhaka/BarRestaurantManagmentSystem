import { useTranslation } from 'react-i18next';
import { CircleAlert, CircleCheck, Clock } from 'lucide-react';
import type { FiscalInfo } from '@tavolina/shared';
import { Badge } from '@tavolina/ui';

export function FiscalBadge({ fiscal }: { fiscal: FiscalInfo | null }) {
  const { t } = useTranslation('billing');
  if (!fiscal) return null;
  const style = {
    registered: { tone: 'success' as const, icon: CircleCheck },
    pending: { tone: 'warning' as const, icon: Clock },
    failed: { tone: 'danger' as const, icon: CircleAlert },
  }[fiscal.status];
  return (
    <Badge tone={style.tone} icon={<style.icon />} title={fiscal.nivf ?? undefined}>
      {t(`fiscal.${fiscal.status}`)} · {fiscal.invoiceNumber}
    </Badge>
  );
}
