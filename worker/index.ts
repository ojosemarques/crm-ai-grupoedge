type HyperdriveBinding = Readonly<{ connectionString: string }>;
type WorkerEnv = Readonly<{
  HYPERDRIVE: HyperdriveBinding;
  CLOUDFLARE_CRON_ENABLED?: string;
  SERVERLESS_WORKER_ENABLED?: string;
  SERVERLESS_WORKER_SECRET?: string;
  META_ADS_CONVERSIONS_WORKER_ENABLED?: string;
  CRON_SECRET?: string;
}>;
type WorkerContext = Readonly<{ waitUntil(promise: Promise<unknown>): void }>;
type FetchHandler = Readonly<{
  fetch(request: Request, env: WorkerEnv, context: WorkerContext): Promise<Response>;
}>;

const SCHEDULED_TICK_URL = "https://crm.edgegrupo.com/api/internal/worker/tick";

function hyperdriveDatabaseUrl(env: WorkerEnv): string {
  const url = new URL(env.HYPERDRIVE.connectionString);
  url.searchParams.set("schema", "crm");
  return url.toString();
}

function workerSecret(env: WorkerEnv): string {
  const metaOnly = env.SERVERLESS_WORKER_ENABLED === "false"
    && env.META_ADS_CONVERSIONS_WORKER_ENABLED === "true";
  return (metaOnly ? env.CRON_SECRET : env.SERVERLESS_WORKER_SECRET)?.trim() ?? "";
}

async function fetchWithRequestDatabase(
  request: Request,
  env: WorkerEnv,
  context: WorkerContext,
): Promise<Response> {
  const [{ default: vinextWorker }, { withRequestDatabaseClient }] = await Promise.all([
    import("vinext/server/fetch-handler"),
    import("@/shared/core/database/client"),
  ]);
  const handler = vinextWorker as FetchHandler;
  return withRequestDatabaseClient(
    hyperdriveDatabaseUrl(env),
    () => handler.fetch(request, env, context),
    (promise) => context.waitUntil(promise),
  );
}

async function runScheduledTick(env: WorkerEnv): Promise<void> {
  const secret = workerSecret(env);
  if (secret.length < 32) {
    throw new Error("Segredo do cron Cloudflare ausente ou inválido.");
  }

  const response = await fetch(new Request(
    SCHEDULED_TICK_URL,
    { method: "GET", headers: { authorization: `Bearer ${secret}` } },
  ));

  try {
    if (!response.ok) {
      throw new Error(`Tick Cloudflare recusado com HTTP ${response.status}.`);
    }
  } finally {
    await response.body?.cancel();
  }
}

const worker = {
  fetch: fetchWithRequestDatabase,
  scheduled(_controller: unknown, env: WorkerEnv, context: WorkerContext): void {
    if (env.CLOUDFLARE_CRON_ENABLED !== "true") return;
    context.waitUntil(runScheduledTick(env));
  },
};

export default worker;
