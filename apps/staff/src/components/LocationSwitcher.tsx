import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Building2 } from 'lucide-react';
import {
  SelectContent,
  SelectItem,
  SelectRoot,
  SelectTrigger,
  SelectValue,
  toast,
} from '@tavolina/ui';
import { loadLocationContext } from '../lib/api';
import { useErrorMessages } from '../lib/errors';
import { useSession } from '../lib/session';
import { homePath } from '../nav';

export function LocationSwitcher() {
  const { t } = useTranslation('app');
  const user = useSession((s) => s.user);
  const locationId = useSession((s) => s.locationId);
  const locationName = useSession((s) => s.locationName);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { message } = useErrorMessages();
  const [switching, setSwitching] = useState(false);

  const locations = user?.locations ?? [];

  if (locations.length <= 1) {
    return (
      <div className="flex h-11 items-center gap-2.5 rounded-control bg-surface-sunken px-3 text-sm font-semibold">
        <Building2 className="size-4 shrink-0 text-foreground-muted" aria-hidden />
        <span className="truncate">{locationName}</span>
      </div>
    );
  }

  return (
    <SelectRoot
      value={locationId ? String(locationId) : undefined}
      disabled={switching}
      onValueChange={async (value) => {
        setSwitching(true);
        try {
          await loadLocationContext(Number(value));
          // Everything cached belonged to the previous location.
          queryClient.removeQueries();
          navigate(homePath(useSession.getState().can));
        } catch (err) {
          toast.error(message(err));
        } finally {
          setSwitching(false);
        }
      }}
    >
      <SelectTrigger aria-label={t('nav.location')} className="font-semibold">
        <span className="flex min-w-0 items-center gap-2.5">
          <Building2 className="size-4 shrink-0 text-foreground-muted" aria-hidden />
          <SelectValue />
        </span>
      </SelectTrigger>
      <SelectContent>
        {locations.map((l) => (
          <SelectItem key={l.id} value={String(l.id)}>
            {l.name}
          </SelectItem>
        ))}
      </SelectContent>
    </SelectRoot>
  );
}
