import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, CheckCircle2, Download, FileUp, Upload } from 'lucide-react';
import type { MenuImportResult } from '@tavolina/shared';
import {
  Button,
  Card,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from '@tavolina/ui';
import { ApiRequestError, api } from '../../lib/api';
import { useErrorMessages } from '../../lib/errors';
import { useSession } from '../../lib/session';
import { useMenuMutation } from './useMenu';

export function ImportExportTab() {
  const { t } = useTranslation('menu');
  const { message } = useErrorMessages();
  const locationName = useSession((s) => s.locationName);
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ name: string; csv: string } | null>(null);
  const [result, setResult] = useState<MenuImportResult | null>(null);
  const [downloading, setDownloading] = useState(false);

  async function download() {
    setDownloading(true);
    try {
      const csv = await api<string>('GET', '/menu/export', { responseType: 'text' });
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `menu-${(locationName ?? 'tavolina').replace(/\W+/g, '-').toLowerCase()}-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(message(err));
    } finally {
      setDownloading(false);
    }
  }

  // Rows with problems come back as 422 IMPORT_INVALID with the row list; show it, not a toast.
  const run = useMenuMutation(
    async (dryRun: boolean) => {
      try {
        return await api<MenuImportResult>('POST', '/menu/import', {
          body: { csv: file!.csv, dryRun },
        });
      } catch (err) {
        if (
          err instanceof ApiRequestError &&
          err.code === 'IMPORT_INVALID' &&
          Array.isArray(err.details.errors)
        ) {
          return {
            dryRun,
            created: 0,
            updated: 0,
            categoriesCreated: 0,
            ...err.details,
          } as MenuImportResult;
        }
        throw err;
      }
    },
    {
      onSuccess: (res) => {
        setResult(res);
        if (!res.dryRun && res.errors.length === 0) {
          toast.success(t('import.applied'));
          setFile(null);
        }
      },
    },
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
      <Card className="flex flex-col gap-4 p-5">
        <div>
          <h2 className="font-bold tracking-tight">{t('import.exportTitle')}</h2>
          <p className="text-sm text-foreground-muted">{t('import.exportDescription')}</p>
        </div>
        <Button variant="outline" className="self-start" loading={downloading} onClick={download}>
          <Download />
          {t('import.export')}
        </Button>
      </Card>

      <Card className="flex flex-col gap-4 p-5">
        <div>
          <h2 className="font-bold tracking-tight">{t('import.importTitle')}</h2>
          <p className="text-sm text-foreground-muted">{t('import.importDescription')}</p>
        </div>
        <input
          ref={fileInput}
          type="file"
          accept=".csv,text/csv"
          className="sr-only"
          tabIndex={-1}
          onChange={async (e) => {
            const chosen = e.target.files?.[0];
            e.target.value = '';
            if (!chosen) return;
            setResult(null);
            setFile({ name: chosen.name, csv: await chosen.text() });
          }}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => fileInput.current?.click()}>
            <FileUp />
            {t('import.chooseFile')}
          </Button>
          {file ? <span className="truncate text-sm font-medium">{file.name}</span> : null}
        </div>
        {file ? (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              loading={run.isPending && run.variables === true}
              onClick={() => run.mutate(true)}
            >
              {t('import.check')}
            </Button>
            <Button
              loading={run.isPending && run.variables === false}
              disabled={!result || !result.dryRun || result.errors.length > 0}
              onClick={() => run.mutate(false)}
            >
              <Upload />
              {t('import.apply')}
            </Button>
          </div>
        ) : null}

        {result ? (
          result.errors.length ? (
            <div className="flex flex-col gap-3">
              <p role="alert" className="flex items-center gap-2 text-sm font-semibold text-danger">
                <AlertTriangle className="size-4" aria-hidden />
                {t('import.errorsTitle', { count: result.errors.length })}
              </p>
              <Table containerClassName="max-h-72">
                <TableHeader>
                  <TableRow>
                    <TableHead numeric>{t('import.row')}</TableHead>
                    <TableHead>{t('import.column')}</TableHead>
                    <TableHead>{t('import.problem')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.errors.map((e, i) => (
                    <TableRow key={i}>
                      <TableCell numeric>{e.row}</TableCell>
                      <TableCell className="font-mono text-xs">{e.column ?? '—'}</TableCell>
                      <TableCell>
                        {t(`import.errors.${e.code}`, {
                          value: e.value ?? '',
                          defaultValue: e.message,
                        })}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p
              className="flex items-start gap-2 rounded-control bg-success-soft px-3 py-2.5 text-sm text-success-soft-fg"
              role="status"
            >
              <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                {t('import.summary', {
                  created: result.created,
                  updated: result.updated,
                  categories: result.categoriesCreated,
                })}{' '}
                {result.dryRun ? t('import.ready') : null}
              </span>
            </p>
          )
        ) : null}
      </Card>
    </div>
  );
}
