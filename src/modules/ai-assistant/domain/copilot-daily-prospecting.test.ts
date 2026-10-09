import { describe, expect, it } from "vitest";

import {
  buildDailyProspectingAction,
  dailyProspectingListIntent,
  formatDailyProspectingList,
  type DailyProspectingBatch,
  type DailyProspectingList,
} from "./copilot-daily-prospecting";

const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const phoneBatch: DailyProspectingBatch = {
  batchId: id(1),
  channel: "CALL",
  localDate: "2026-10-08",
  expiresAt: "2026-10-09T03:00:00.000Z",
  items: [
    { number: 1, leadId: id(10), tasks: [{ taskId: id(20), kind: "CALL" }] },
    { number: 2, leadId: id(11), tasks: [{ taskId: id(21), kind: "CALL" }] },
  ],
};

const instagramBatch: DailyProspectingBatch = {
  batchId: id(2),
  channel: "INSTAGRAM",
  localDate: "2026-10-08",
  expiresAt: "2026-10-09T03:00:00.000Z",
  items: [
    {
      number: 1,
      leadId: id(12),
      tasks: [
        { taskId: id(22), kind: "INSTAGRAM_FOLLOW" },
        { taskId: id(23), kind: "INSTAGRAM_MESSAGE" },
      ],
    },
  ],
};

describe("lista diária da prospecção no Copilot", () => {
  it("reconhece pedidos de telefone e Instagram sem confundir consultas comuns", () => {
    expect(dailyProspectingListIntent("Liste todos os nomes e telefones dos meus leads da meta diária")).toBe("CALL");
    expect(dailyProspectingListIntent("Quero o Instagram de todos os políticos da meta de hoje")).toBe("INSTAGRAM");
    expect(dailyProspectingListIntent("Qual telefone da Maria?")).toBeNull();
  });

  it("formata todos os itens e identifica explicitamente quem não tem Instagram", () => {
    const list: DailyProspectingList = {
      batch: instagramBatch,
      target: 75,
      truncated: false,
      entries: [
        { number: 1, leadId: id(12), name: "Ana Silva", city: "Itu", role: "Vereadora", phones: [], instagram: "@anasilva", tasks: instagramBatch.items[0]!.tasks },
        { number: 2, leadId: id(13), name: "José Lima", city: "Lages", role: "Prefeito", phones: [], instagram: null, tasks: [{ taskId: id(24), kind: "INSTAGRAM_MESSAGE" }] },
      ],
    };

    const answer = formatDailyProspectingList(list);
    expect(answer).toContain("1. Ana Silva — Itu — Vereadora — @anasilva");
    expect(answer).toContain("2. José Lima — Lages — Prefeito — não tem Instagram");
    expect(answer).toContain("Responda usando os números desta lista");
  });

  it("converte resultados de ligação em uma única ação em lote", () => {
    expect(buildDailyProspectingAction(phoneBatch, "1 - atendeu\n2 - não atendeu")).toEqual({
      kind: "COMPLETE_PROSPECTING_TASKS",
      items: [
        { leadId: id(10), taskId: id(20), taskKind: "CALL", result: "CONNECTED" },
        { leadId: id(11), taskId: id(21), taskKind: "CALL", result: "NO_ANSWER" },
      ],
    });
  });

  it("conclui seguir e mensagem juntos e aceita perfil não encontrado", () => {
    expect(buildDailyProspectingAction(instagramBatch, "1 - segui e enviei mensagem")).toEqual({
      kind: "COMPLETE_PROSPECTING_TASKS",
      items: [
        { leadId: id(12), taskId: id(22), taskKind: "INSTAGRAM_FOLLOW", result: "COMPLETED" },
        { leadId: id(12), taskId: id(23), taskKind: "INSTAGRAM_MESSAGE", result: "SENT" },
      ],
    });
    expect(buildDailyProspectingAction(instagramBatch, "1 - não achei instagram")).toEqual({
      kind: "COMPLETE_PROSPECTING_TASKS",
      items: [
        { leadId: id(12), taskId: id(22), taskKind: "INSTAGRAM_FOLLOW", result: "PROFILE_NOT_FOUND" },
        { leadId: id(12), taskId: id(23), taskKind: "INSTAGRAM_MESSAGE", result: "PROFILE_NOT_FOUND" },
      ],
    });
  });

  it("rejeita número fora da lista, duplicado ou resultado incompatível", () => {
    expect(() => buildDailyProspectingAction(phoneBatch, "3 - atendeu")).toThrow(/não pertence/i);
    expect(() => buildDailyProspectingAction(phoneBatch, "1 - atendeu\n1 - não atendeu")).toThrow(/repetido/i);
    expect(() => buildDailyProspectingAction(phoneBatch, "1 - segui")).toThrow(/resultado/i);
  });
});
