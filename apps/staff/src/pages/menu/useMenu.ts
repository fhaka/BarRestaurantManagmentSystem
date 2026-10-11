import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DEFAULT_LANG, LANGS, type AdminMenu, type Lang, type Location } from '@tavolina/shared';
import { toast } from '@tavolina/ui';
import { api } from '../../lib/api';
import { useErrorMessages } from '../../lib/errors';
import { useSession } from '../../lib/session';

export function useMenuQuery() {
  const locationId = useSession((s) => s.locationId);
  return useQuery({
    queryKey: ['menu', locationId],
    queryFn: () => api<AdminMenu>('GET', '/menu'),
  });
}

/** Main language (stored on entities) and the other languages that get translations. */
export function useMenuLanguages(): { main: Lang; others: Lang[] } {
  const locationId = useSession((s) => s.locationId);
  const location = useQuery({
    queryKey: ['location', locationId],
    queryFn: () => api<Location>('GET', '/locations/current'),
    staleTime: 5 * 60_000,
  });
  const main = location.data?.settings.defaultLang ?? DEFAULT_LANG;
  return { main, others: LANGS.filter((l) => l !== main) };
}

/**
 * A mutation that refreshes the menu afterwards and reports errors. Field-level validation
 * errors go to `onFieldErrors` when given; everything else becomes a toast.
 */
export function useMenuMutation<TVars, TResult = unknown>(
  fn: (vars: TVars) => Promise<TResult>,
  options: {
    success?: string | ((result: TResult) => string);
    onSuccess?: (result: TResult) => void;
    onFieldErrors?: (errors: Record<string, string>) => void;
  } = {},
) {
  const queryClient = useQueryClient();
  const { message, fieldErrors } = useErrorMessages();
  return useMutation({
    mutationFn: fn,
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['menu'] });
      if (options.success) {
        toast.success(
          typeof options.success === 'function' ? options.success(result) : options.success,
        );
      }
      options.onSuccess?.(result);
    },
    onError: (err) => {
      const fields = fieldErrors(err);
      if (options.onFieldErrors && Object.keys(fields).length) options.onFieldErrors(fields);
      else toast.error(message(err));
    },
  });
}

export const isOutOfStock = (until: string | null, now = Date.now()) =>
  until !== null && new Date(until).getTime() > now;
