declare module "https://esm.sh/sql.js-httpvfs@0.8.12" {
  export function createDbWorker(
    configs: unknown[],
    workerUrl: string,
    wasmUrl: string
  ): Promise<{
    db: {
      query: (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
    };
  }>;

  const defaultExport: {
    createDbWorker?: typeof createDbWorker;
  };

  export default defaultExport;
}
