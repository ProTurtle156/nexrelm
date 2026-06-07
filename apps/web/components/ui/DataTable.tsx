import type { ReactNode } from 'react';
import { cn } from '@/lib/format';

export interface Column<T> {
  key: string;
  header: ReactNode;
  /** Cell renderer. */
  cell: (row: T) => ReactNode;
  className?: string;
  align?: 'left' | 'right' | 'center';
}

interface DataTableProps<T> {
  columns: Array<Column<T>>;
  rows: T[];
  rowKey: (row: T, index: number) => string;
  empty?: ReactNode;
  className?: string;
  onRowClick?: (row: T) => void;
}

const alignClass = { left: 'text-left', right: 'text-right', center: 'text-center' } as const;

/** A compact, scrollable data table styled for the dark-cyber console. */
export function DataTable<T>({ columns, rows, rowKey, empty, className, onRowClick }: DataTableProps<T>) {
  if (rows.length === 0) {
    return <div className="grid place-items-center px-4 py-10 text-sm text-faint">{empty ?? 'No data.'}</div>;
  }
  return (
    <div className={cn('w-full overflow-x-auto', className)}>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-line">
            {columns.map((c) => (
              <th
                key={c.key}
                className={cn('label whitespace-nowrap px-4 py-2.5 font-medium', alignClass[c.align ?? 'left'])}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={rowKey(row, i)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={cn(
                'border-b border-line/60 transition-colors last:border-0',
                onRowClick && 'cursor-pointer',
                'hover:bg-[color-mix(in_oklch,var(--accent)_7%,transparent)]',
              )}
            >
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={cn('whitespace-nowrap px-4 py-2.5 text-text/90', alignClass[c.align ?? 'left'], c.className)}
                >
                  {c.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
