import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Printer } from 'lucide-react';
import type { TableQr } from '@tavolina/shared';
import { Button, EmptyState, Skeleton } from '@tavolina/ui';
import { api } from '../../lib/api';
import { useSession } from '../../lib/session';
import { useFloorQuery } from './floor-utils';

/** One card per table with its QR code, laid out for A4; the app chrome is hidden when printing. */
export function QrSheetPage() {
  const { t } = useTranslation('floor');
  const { areaId } = useParams();
  const locationName = useSession((s) => s.locationName);
  const floor = useFloorQuery();
  const area = floor.data?.areas.find((a) => String(a.id) === areaId);
  const sheet = useQuery({
    queryKey: ['qr-sheet', areaId],
    queryFn: () => api<TableQr[]>('GET', `/areas/${areaId}/qr-sheet`),
  });

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5 px-4 py-6 sm:px-8 print:max-w-none print:p-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between print:hidden">
        <div className="flex flex-col gap-1">
          <Link
            to="/floor/edit"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-foreground-muted hover:text-foreground"
          >
            <ArrowLeft className="size-4" aria-hidden />
            {t('editor.title')}
          </Link>
          <h1 className="text-2xl font-extrabold tracking-tight">
            {t('qr.title', { area: area?.name ?? '' })}
          </h1>
          <p className="text-foreground-muted">{t('qr.hint')}</p>
        </div>
        <Button onClick={() => window.print()} disabled={!sheet.data?.length}>
          <Printer />
          {t('qr.print')}
        </Button>
      </div>

      {sheet.isPending ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="aspect-[3/4] rounded-card" />
          ))}
        </div>
      ) : !sheet.data?.length ? (
        <EmptyState title={t('qr.empty')} />
      ) : (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 print:grid-cols-3 print:gap-0">
          {sheet.data.map((qr) => (
            <li
              key={qr.tableId}
              className="flex break-inside-avoid flex-col items-center gap-3 rounded-card border-2 border-dashed border-border-strong bg-white p-5 text-center text-sand-950 print:rounded-none print:border-sand-300"
            >
              <span className="text-xs font-bold uppercase tracking-widest text-sand-600">
                {locationName}
              </span>
              <span className="text-3xl font-extrabold">
                {t('qr.table', { name: qr.tableName })}
              </span>
              {/* Server-generated SVG from our own QR library; it contains only the code's path. */}
              <span
                className="block w-full max-w-[180px] [&_svg]:h-auto [&_svg]:w-full"
                dangerouslySetInnerHTML={{ __html: qr.svg }}
              />
              <span className="text-sm font-semibold">{t('qr.scan')}</span>
              <span className="text-xs text-sand-600">{t('qr.scanEn')}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
