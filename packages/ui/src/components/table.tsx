import {
  forwardRef,
  type HTMLAttributes,
  type TdHTMLAttributes,
  type ThHTMLAttributes,
} from 'react';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import { cn } from '../lib/cn.js';

export interface TableProps extends HTMLAttributes<HTMLTableElement> {
  /** Class for the scroll container; set a max height to get a sticky header. */
  containerClassName?: string;
}

export const Table = forwardRef<HTMLTableElement, TableProps>(function Table(
  { className, containerClassName, ...props },
  ref,
) {
  return (
    <div
      className={cn(
        'relative w-full overflow-auto rounded-card border border-border bg-surface',
        containerClassName,
      )}
    >
      <table ref={ref} className={cn('w-full caption-bottom text-sm', className)} {...props} />
    </div>
  );
});

export function TableHeader({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead
      className={cn(
        'sticky top-0 z-10 bg-surface-sunken/95 backdrop-blur [&_tr]:border-b [&_tr]:border-border',
        className,
      )}
      {...props}
    />
  );
}

export function TableBody({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn('[&_tr:last-child]:border-0', className)} {...props} />;
}

export function TableRow({ className, ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cn(
        'border-b border-border transition-colors hover:bg-surface-sunken/60 data-[state=selected]:bg-primary-soft',
        className,
      )}
      {...props}
    />
  );
}

export type SortDirection = 'asc' | 'desc' | false;

export interface TableHeadProps extends ThHTMLAttributes<HTMLTableCellElement> {
  numeric?: boolean;
  /** When set, the header renders a sort button. */
  sort?: SortDirection;
  onSort?: () => void;
}

export function TableHead({
  className,
  numeric,
  sort,
  onSort,
  children,
  ...props
}: TableHeadProps) {
  const sortable = onSort !== undefined;
  const SortIcon = sort === 'asc' ? ArrowUp : sort === 'desc' ? ArrowDown : ChevronsUpDown;
  return (
    <th
      scope="col"
      aria-sort={sort === 'asc' ? 'ascending' : sort === 'desc' ? 'descending' : undefined}
      className={cn(
        'h-11 whitespace-nowrap px-4 text-left align-middle text-xs font-semibold uppercase tracking-wide text-foreground-muted',
        numeric && 'text-right',
        className,
      )}
      {...props}
    >
      {sortable ? (
        <button
          type="button"
          onClick={onSort}
          className={cn(
            'inline-flex items-center gap-1 rounded-sm uppercase hover:text-foreground',
            numeric && 'flex-row-reverse',
          )}
        >
          {children}
          <SortIcon className={cn('size-3.5', !sort && 'opacity-50')} aria-hidden />
        </button>
      ) : (
        children
      )}
    </th>
  );
}

export interface TableCellProps extends TdHTMLAttributes<HTMLTableCellElement> {
  numeric?: boolean;
}

export function TableCell({ className, numeric, ...props }: TableCellProps) {
  return (
    <td
      className={cn(
        'px-4 py-3 align-middle',
        numeric && 'text-right font-mono tabular-nums',
        className,
      )}
      {...props}
    />
  );
}

export function TableCaption({ className, ...props }: HTMLAttributes<HTMLTableCaptionElement>) {
  return <caption className={cn('py-3 text-sm text-foreground-muted', className)} {...props} />;
}
