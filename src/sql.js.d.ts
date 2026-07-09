// Type declarations for sql.js (used via ESM import in kumaDb.ts)
// sql.js bundles WASM internally for Node.js — no locateFile needed.
declare module "sql.js" {
  interface QueryExecResult {
    columns: string[];
    values: any[][];
  }
  interface Statement {
    bind(params?: any[]): boolean;
    step(): boolean;
    getAsObject(): Record<string, unknown>;
    free(): boolean;
  }
  interface Database {
    run(sql: string, params?: any[]): Database;
    exec(sql: string): QueryExecResult[];
    prepare(sql: string): Statement;
    export(): Uint8Array;
    close(): void;
  }
  interface SqlJsStatic {
    Database: typeof Database;
  }
  interface SqlJsConfig {
    locateFile?: (file: string) => string;
    wasmBinary?: Buffer | ArrayBuffer | Uint8Array;
  }
  export default function initSqlJs(config?: SqlJsConfig): Promise<SqlJsStatic>;
  export type {
    Database,
    Statement,
    QueryExecResult,
    SqlJsStatic,
    SqlJsConfig,
  };
}
