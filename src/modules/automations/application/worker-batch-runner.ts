import { logger } from "@/shared/core/logging/logger";

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
      let processed = 0;
      let published = 0;
      const outcomes: Record<string, number> = {};
      const failedProcessors = new Set<string>();
      try {
        published = (await options.scanDue()).published;
      } catch (error) {
        processed += 1;
        outcomes["lifecycle-scan:SCAN_ERROR"] = 1;
        logger.error({
          processorKey: "lifecycle-scan",
          errorName: error instanceof Error ? error.name : "UnknownError",
        }, "Varredura de ciclo de vida isolada após falha no lote serverless");
      }

      while (processed < input.maxJobs && now() < deadline) {
        let found = false;
        for (const processor of options.processors) {
          if (now() >= deadline) break;
          if (failedProcessors.has(processor.key)) continue;
          let result: WorkerProcessorResult;
          try {
            result = await processor.processNext(`${input.workerId}:${processor.key}`);
          } catch (error) {
            failedProcessors.add(processor.key);
            found = true;
            processed += 1;
            const outcome = `${processor.key}:PROCESSOR_ERROR`;
            outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
            logger.error({
              processorKey: processor.key,
              errorName: error instanceof Error ? error.name : "UnknownError",
            }, "Processador isolado após falha no lote serverless");
            if (processed >= input.maxJobs) break;
            continue;
          }
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
        published,
        elapsedMs,
        outcomes: Object.freeze({ ...outcomes }),
      });
    },
  });
}
