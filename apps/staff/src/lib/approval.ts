import type { ApprovalAction } from '@tavolina/shared';
import { ApiRequestError } from './api';

export interface ApprovalRequest {
  action: ApprovalAction;
  entityType: string;
  entityId: number | string;
  /** What is being approved, e.g. "Zbritje 15% në tavolinën 5". */
  summary: string;
}

/** Runs an action; if the server asks for a manager's approval, gets one and tries again. */
export async function withApproval<T>(
  approve: (request: ApprovalRequest) => Promise<string | null>,
  request: ApprovalRequest,
  run: (approvalToken?: string) => Promise<T>,
): Promise<T | null> {
  try {
    return await run();
  } catch (err) {
    if (!(err instanceof ApiRequestError && err.code === 'APPROVAL_INVALID')) throw err;
    const token = await approve(request);
    return token ? run(token) : null;
  }
}
