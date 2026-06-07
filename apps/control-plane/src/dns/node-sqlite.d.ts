/**
 * Minimal ambient types for Node's built-in (experimental) `node:sqlite`.
 * @types/node@20 predates it; this declares just the surface we use. Runs under
 * `node --experimental-sqlite` (set via NODE_OPTIONS in the package scripts).
 */
declare module 'node:sqlite' {
  type SqlValue = string | number | bigint | null | Uint8Array;

  export interface StatementSync {
    run(...params: SqlValue[]): { changes: number; lastInsertRowid: number | bigint };
    get(...params: SqlValue[]): Record<string, SqlValue> | undefined;
    all(...params: SqlValue[]): Array<Record<string, SqlValue>>;
  }

  export class DatabaseSync {
    constructor(path: string, options?: { open?: boolean });
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }
}
