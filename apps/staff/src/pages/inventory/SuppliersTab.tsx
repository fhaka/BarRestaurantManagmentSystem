import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Mail, Phone, Plus, Trash2, Users } from 'lucide-react';
import { supplierInputSchema, type Supplier } from '@tavolina/shared';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  Input,
  Skeleton,
  SwitchField,
  Textarea,
  toast,
} from '@tavolina/ui';
import { api } from '../../lib/api';
import { useErrorMessages } from '../../lib/errors';
import { useSession } from '../../lib/session';
import { useSuppliers } from './inventory-utils';

export function SuppliersTab() {
  const { t } = useTranslation('inventory');
  const manage = useSession((s) => s.can)('inventory.manage');
  const suppliers = useSuppliers();
  const [editing, setEditing] = useState<Supplier | 'new' | null>(null);
  if (suppliers.isLoading) return <Skeleton className="h-64" />;
  const add = manage ? (
    <Button onClick={() => setEditing('new')}>
      <Plus />
      {t('suppliers.add')}
    </Button>
  ) : undefined;
  return (
    <div className="flex flex-col gap-4">
      {suppliers.data?.length ? (
        <>
          <div className="flex justify-end">{add}</div>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {suppliers.data.map((s) => (
              <li
                key={s.id}
                className="flex flex-col gap-2 rounded-card border border-border bg-surface p-4 shadow-raised"
              >
                <span className="flex items-start justify-between gap-2">
                  <span className="text-lg font-bold">{s.name}</span>
                  {!s.active ? <Badge size="sm">{t('stock.inactive')}</Badge> : null}
                </span>
                {s.contact ? <span className="text-sm">{s.contact}</span> : null}
                {s.phone ? (
                  <a
                    href={`tel:${s.phone.replace(/\s/g, '')}`}
                    className="flex items-center gap-2 text-sm text-primary hover:underline"
                  >
                    <Phone className="size-4" aria-hidden />
                    {s.phone}
                  </a>
                ) : null}
                {s.email ? (
                  <a
                    href={`mailto:${s.email}`}
                    className="flex items-center gap-2 text-sm text-primary hover:underline"
                  >
                    <Mail className="size-4" aria-hidden />
                    {s.email}
                  </a>
                ) : null}
                {s.notes ? <span className="text-sm text-foreground-muted">{s.notes}</span> : null}
                {manage ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-auto self-start"
                    onClick={() => setEditing(s)}
                  >
                    {t('suppliers.edit')}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <EmptyState
          icon={<Users />}
          title={t('suppliers.empty')}
          description={t('suppliers.emptyDescription')}
          action={add}
        />
      )}
      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          {editing ? (
            <SupplierForm
              key={editing === 'new' ? 'new' : editing.id}
              supplier={editing === 'new' ? null : editing}
              onClose={() => setEditing(null)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SupplierForm({ supplier, onClose }: { supplier: Supplier | null; onClose: () => void }) {
  const { t } = useTranslation('inventory');
  const { message, fieldErrors, validate } = useErrorMessages();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    name: supplier?.name ?? '',
    contact: supplier?.contact ?? '',
    phone: supplier?.phone ?? '',
    email: supplier?.email ?? '',
    notes: supplier?.notes ?? '',
    active: supplier?.active ?? true,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const done = () => {
    void queryClient.invalidateQueries({ queryKey: ['inventory'] });
    onClose();
  };
  const save = useMutation({
    mutationFn: (body: unknown) =>
      supplier
        ? api('PATCH', `/suppliers/${supplier.id}`, { body })
        : api('POST', '/suppliers', { body }),
    onSuccess: () => {
      toast.success(t('suppliers.saved'));
      done();
    },
    onError: (err) => {
      const f = fieldErrors(err);
      if (Object.keys(f).length) setErrors(f);
      else toast.error(message(err));
    },
  });
  const remove = useMutation({
    mutationFn: () => api('DELETE', `/suppliers/${supplier!.id}`),
    onSuccess: done,
    onError: (err) => toast.error(message(err)),
  });
  const submit = () => {
    const body = {
      name: form.name,
      contact: form.contact || null,
      phone: form.phone || null,
      email: form.email || null,
      notes: form.notes || null,
      active: form.active,
    };
    const result = validate(supplierInputSchema, body);
    if (!result.ok) return setErrors(result.errors);
    setErrors({});
    save.mutate(body);
  };
  const text = (key: 'name' | 'contact' | 'phone' | 'email', max: number, type = 'text') => (
    <Field label={t(`suppliers.${key}`)} error={errors[key]}>
      <Input
        type={type}
        value={form[key]}
        maxLength={max}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
      />
    </Field>
  );
  return (
    <>
      <DialogHeader>
        <DialogTitle>{supplier ? supplier.name : t('suppliers.add')}</DialogTitle>
      </DialogHeader>
      <div className="flex flex-col gap-4">
        {text('name', 120)}
        <div className="grid gap-4 sm:grid-cols-2">
          {text('contact', 120)}
          {text('phone', 40, 'tel')}
        </div>
        {text('email', 190, 'email')}
        <Field label={t('suppliers.notes')} error={errors.notes}>
          <Textarea
            value={form.notes}
            maxLength={500}
            rows={2}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
        </Field>
        <SwitchField
          label={t('suppliers.active')}
          checked={form.active}
          onCheckedChange={(v) => setForm({ ...form, active: v })}
        />
      </div>
      <DialogFooter>
        {supplier ? (
          <Button
            variant="ghost"
            className="mr-auto text-danger"
            loading={remove.isPending}
            onClick={() => remove.mutate()}
          >
            <Trash2 />
            {t('suppliers.delete')}
          </Button>
        ) : null}
        <Button variant="outline" onClick={onClose}>
          {t('cancelAction')}
        </Button>
        <Button loading={save.isPending} onClick={submit}>
          {t('confirm')}
        </Button>
      </DialogFooter>
    </>
  );
}
