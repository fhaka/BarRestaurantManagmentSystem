import { useTranslation } from 'react-i18next';
import type { AuditLogEntry } from '@tavolina/shared';
import { cn } from '@tavolina/ui';

/** A friendly name for the action, with its key underneath for exact searches. */
export function ActionLabel({ action }: { action: string }) {
  const { t } = useTranslation('audit');
  const group = action.split('.')[0]!;
  const label = t(`actions.${action.replace('.', '~')}` as 'actions.auth~login', {
    defaultValue: '',
  });
  return (
    <span className="flex flex-col">
      <span className="font-semibold">
        {label || t(`groups.${group}` as 'groups.auth', { defaultValue: group })}
      </span>
      <span className="font-mono text-xs text-foreground-muted">{action}</span>
    </span>
  );
}

const show = (v: unknown) =>
  v === undefined ? '—' : typeof v === 'string' ? v : JSON.stringify(v);

/** Before and after side by side; changed fields are highlighted. */
export function ChangeView({ entry }: { entry: AuditLogEntry }) {
  const { t } = useTranslation('audit');
  const before = (entry.before && typeof entry.before === 'object' ? entry.before : {}) as Record<
    string,
    unknown
  >;
  const after = (entry.after && typeof entry.after === 'object' ? entry.after : {}) as Record<
    string,
    unknown
  >;
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  return (
    <div className="flex flex-col gap-3 py-1">
      {keys.length ? (
        <table className="w-full max-w-3xl text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-foreground-muted">
              <th className="py-1 pr-4 font-semibold" />
              <th className="py-1 pr-4 font-semibold">{t('before')}</th>
              <th className="py-1 font-semibold">{t('after')}</th>
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => {
              const changed = JSON.stringify(before[k]) !== JSON.stringify(after[k]);
              return (
                <tr key={k} className="align-top">
                  <th
                    scope="row"
                    className="py-1 pr-4 text-left font-mono text-xs font-normal text-foreground-muted"
                  >
                    {k}
                  </th>
                  <td
                    className={cn(
                      'break-all py-1 pr-4 font-mono text-xs',
                      changed && 'text-danger line-through decoration-danger/50',
                    )}
                  >
                    {show(before[k])}
                  </td>
                  <td
                    className={cn(
                      'break-all py-1 font-mono text-xs',
                      changed && 'font-semibold text-success',
                    )}
                  >
                    {show(after[k])}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <p className="text-sm text-foreground-muted">{t('noChanges')}</p>
      )}
      <dl className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-3">
        <div>
          <dt className="text-foreground-muted">{t('device')}</dt>
          <dd>{entry.deviceName ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-foreground-muted">{t('ip')}</dt>
          <dd className="font-mono">{entry.ip ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-foreground-muted">{t('request')}</dt>
          <dd className="break-all font-mono">{entry.requestId ?? '—'}</dd>
        </div>
      </dl>
    </div>
  );
}
