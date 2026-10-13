import { useCallback, useRef, useState, type ReactNode } from 'react';
import { ApprovalDialog } from '../components/Approval';
import type { ApprovalRequest } from './approval';

/**
 * A manager confirms an action on this device with their PIN (plan §4). Returns a single-use
 * token for exactly this action and entity, or null if cancelled.
 *
 *   const { approve, dialog } = useApproval();
 *   const token = await approve({ action: 'order.discount', entityType: 'order', entityId, summary });
 */
export function useApproval(): {
  approve: (request: ApprovalRequest) => Promise<string | null>;
  dialog: ReactNode;
} {
  const [request, setRequest] = useState<ApprovalRequest | null>(null);
  const resolver = useRef<((token: string | null) => void) | null>(null);
  const approve = useCallback(
    (next: ApprovalRequest) =>
      new Promise<string | null>((resolve) => {
        resolver.current = resolve;
        setRequest(next);
      }),
    [],
  );
  const finish = (token: string | null) => {
    resolver.current?.(token);
    resolver.current = null;
    setRequest(null);
  };
  const dialog = <ApprovalDialog request={request} onDone={finish} />;
  return { approve, dialog };
}
