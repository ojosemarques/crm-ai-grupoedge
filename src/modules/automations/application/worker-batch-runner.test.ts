import { describe, expect, it, vi } from "vitest";

import { createWorkerBatchRunner } from "@/modules/automations/application/worker-batch-runner";

describe("worker batch runner", () => {
  it("limita o lote e preserva a ordem dos processadores", async () => {
    const first = vi.fn()
      .mockResolvedValueOnce({ status: "SUCCEEDED" })
      .mockResolvedValueOnce({ status: "IDLE" });
    const second = vi.fn().mockResolvedValue({ status: "RETRY_PENDING" });
    const runner = createWorkerBatchRunner({
      scanDue: async () => ({ published: 2 }),
      processors: [
        { key: "first", processNext: first },
        { key: "second", processNext: second },
      ],
      now: () => 100,
    });

    await expect(runner.run({ workerId: "serverless:test", maxJobs: 2, maxDurationMs: 1_000 }))
      .resolves.toEqual({
        code: "BATCH_COMPLETED",
        processed: 2,
        published: 2,
        elapsedMs: 0,
        outcomes: { "first:SUCCEEDED": 1, "second:RETRY_PENDING": 1 },
      });
    expect(first).toHaveBeenNthCalledWith(1, "serverless:test:first");
    expect(second).toHaveBeenCalledWith("serverless:test:second");
  });

  it("encerra como ocioso sem inventar processamento", async () => {
    const runner = createWorkerBatchRunner({
      scanDue: async () => ({ published: 0 }),
      processors: [{ key: "automations", processNext: async () => ({ status: "IDLE" }) }],
      now: () => 500,
    });
    await expect(runner.run({ workerId: "serverless:idle", maxJobs: 10, maxDurationMs: 1_000 }))
      .resolves.toMatchObject({ code: "BATCH_IDLE", processed: 0, outcomes: {} });
  });

  it("para no deadline antes de iniciar outro processador", async () => {
    let instant = 0;
    const runner = createWorkerBatchRunner({
      scanDue: async () => ({ published: 0 }),
      processors: [{
        key: "automations",
        processNext: async () => {
          instant = 1_500;
          return { status: "SUCCEEDED" };
        },
      }],
      now: () => instant,
    });
    await expect(runner.run({ workerId: "serverless:deadline", maxJobs: 10, maxDurationMs: 1_000 }))
      .resolves.toMatchObject({ code: "DEADLINE_REACHED", processed: 1, elapsedMs: 1_500 });
  });
});
