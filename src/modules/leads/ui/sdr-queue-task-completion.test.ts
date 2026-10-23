import { describe, expect, it } from "vitest";

import { sdrQueueTaskCompletion } from "@/modules/leads/ui/sdr-queue-task-completion";

describe("conclusão rápida de tarefas no Meu Dia", () => {
  it.each(["CALL", "WHATSAPP", "MESSAGE", "INSTAGRAM_MESSAGE", "INSTAGRAM_FOLLOW", "EMAIL", "FOLLOW_UP", "GENERAL", "MEETING"])(
    "libera %s comum sem depender do vencimento",
    (kind) => {
      const completion = sdrQueueTaskCompletion({ taskId: "task", kind, sourceKey: null });

      expect(completion).toMatchObject({
        available: true,
        cadence: false,
      });
      expect(completion.options.length).toBeGreaterThan(0);
    },
  );

  it("reconhece cadência sem limitar a conclusão de tarefas comuns", () => {
    expect(sdrQueueTaskCompletion({ taskId: "task", kind: "INSTAGRAM_MESSAGE", sourceKey: "active-prospecting:cadence:instagram-message-1" }).available).toBe(true);
    expect(sdrQueueTaskCompletion({ taskId: null, kind: "CALL", sourceKey: null }).available).toBe(false);
    expect(sdrQueueTaskCompletion({ taskId: "task", kind: "UNKNOWN", sourceKey: null }).available).toBe(false);
  });
});
