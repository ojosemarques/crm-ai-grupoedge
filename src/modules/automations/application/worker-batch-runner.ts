export type WorkerProcessorResult = Readonly<{ status: string }>;

export type WorkerProcessor = Readonly<{
  key: string;
  processNext: (workerId: string) => Promise<WorkerProcessorResult>;
}>;

export type WorkerBatchRunnerOptions = Readonly<{
  scanDue: () => Promise<Readonly<{ published: number }>>;
  processors: readonly WorkerProcessor[];
  now?: () => number;
}>;

export type WorkerBatchResult = Readonly<{
  code: "BATCH_COMPLETED" | "BATCH_IDLE" | "DEADLINE_REACHED";
  processed: number;
  published: number;
  elapsedMs: number;
  outcomes: Readonly<Record<string, number>>;
}>;

export function createWorkerBatchRunner(options: WorkerBatchRunnerOptions) {
  const now = options.now ?? Date.now;

  return Object.freeze({
    async run(input: Readonly<{ workerId: string; maxJobs: number; maxDurationMs: number }>): Promise<WorkerBatchResult> {
      const startedAt = now();
      const deadline = startedAt + input.maxDurationMs;
      const scan = await options.scanDue();
      let processed = 0;
      const outcomes: Record<string, number> = {};

      while (processed < input.maxJobs && now() < deadline) {
        let found = false;
        for (const processor of options.processors) {
          if (now() >= deadline) break;
          const result = await processor.processNext(`${input.workerId}:${processor.key}`);
          if (result.status === "IDLE") continue;
          found = true;
          processed += 1;
          const outcome = `${processor.key}:${result.status}`;
          outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
          break;
        }
        if (!found) break;
      }

      const elapsedMs = Math.max(0, now() - startedAt);
      const code = processed === 0
        ? "BATCH_IDLE"
        : now() >= deadline
          ? "DEADLINE_REACHED"
          : "BATCH_COMPLETED";
      return Object.freeze({
        code,
        processed,
        published: scan.published,
        elapsedMs,
        outcomes: Object.freeze({ ...outcomes }),
      });
    },
  });
}
