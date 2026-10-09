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
  memberId: id(30),
  memberName: "Jhon Cunha",
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
  memberId: id(31),
  memberName: "Ede Rafael",
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

const dailyBatch: DailyProspectingBatch = {
  batchId: id(3),
  memberId: id(30),
  memberName: "Jhon Cunha",
  channel: "DAILY",
  localDate: "2026-10-08",
  expiresAt: "2026-10-09T03:00:00.000Z",
  items: [
    {
      number: 1,
      leadId: id(10),
      tasks: [
        { taskId: id(20), kind: "CALL" },
        { taskId: id(22), kind: "INSTAGRAM_FOLLOW" },
        { taskId: id(23), kind: "INSTAGRAM_MESSAGE" },
      ],
    },
  ],
};

describe("lista diária da prospecção no Copilot", () => {
  it("reconhece pedidos de telefone e Instagram sem confundir consultas comuns", () => {
    expect(dailyProspectingListIntent("Liste todos os nomes e telefones dos meus leads da meta diária")).toBe("DAILY");
    expect(dailyProspectingListIntent("Quem são as pessoas da minha meta de hoje e o que preciso fazer?")).toBe("DAILY");
    expect(dailyProspectingListIntent("Quantas pessoas eu tenho que ligar hoje e quem são elas?")).toBe("CALL");
    expect(dailyProspectingListIntent("Quero o Instagram de todos os políticos da meta de hoje")).toBe("INSTAGRAM");
    expect(dailyProspectingListIntent("Qual telefone da Maria?")).toBeNull();
  });

  it("interpreta quantidade, abordagem e variações comuns de Instagram na meta de hoje", () => {
    expect(dailyProspectingListIntent("quantos instagrans ou pessoas devo abordar hoje")).toBe("INSTAGRAM");
    expect(dailyProspectingListIntent("Quantos Instagrams preciso fazer hoje?")).toBe("INSTAGRAM");
    expect(dailyProspectingListIntent("O que devo abordar hoje?")).toBe("DAILY");
    expect(dailyProspectingListIntent("Quais ações da meta preciso executar hoje?")).toBe("DAILY");
    expect(dailyProspectingListIntent("Quantos seguidores tem o Instagram da Maria?")).toBeNull();
    expect(dailyProspectingListIntent("Quais tarefas do cliente Acme?")).toBeNull();
  });

  it("formata todos os itens e identifica explicitamente quem não tem Instagram", () => {
    const list: DailyProspectingList = {
      batch: instagramBatch,
      target: 75,
      totalPoliticians: 2,
      activitySummary: [
        { kind: "INSTAGRAM_FOLLOW", label: "Seguir perfil no Instagram", count: 2 },
        { kind: "INSTAGRAM_MESSAGE", label: "Mensagem Instagram nº 1", count: 2 },
      ],
      truncated: false,
      entries: [
        { number: 1, leadId: id(12), name: "Ana Silva", city: "Itu", role: "Vereadora", phones: [], instagram: "@anasilva", tasks: [{ taskId: id(22), kind: "INSTAGRAM_FOLLOW", label: "Seguir perfil no Instagram" }, { taskId: id(23), kind: "INSTAGRAM_MESSAGE", label: "Mensagem Instagram nº 1" }] },
        { number: 2, leadId: id(13), name: "José Lima", city: "Lages", role: "Prefeito", phones: [], instagram: null, tasks: [{ taskId: id(24), kind: "INSTAGRAM_MESSAGE", label: "Mensagem Instagram nº 1" }] },
      ],
    };

    const answer = formatDailyProspectingList(list);
    expect(answer).toContain("meta diária de Ede Rafael");
    expect(answer).toContain("Com Instagram:\n1. Ana Silva — @anasilva\n   Atividades: Seguir perfil no Instagram, Mensagem Instagram nº 1");
    expect(answer).toContain("Sem Instagram:\n2. José Lima — Lages — Prefeito — não tem Instagram\n   Atividades: Mensagem Instagram nº 1");
    expect(answer).toContain("Responda usando os números desta lista");
  });

  it("separa os leads com e sem Instagram no formato pedido pelo vendedor", () => {
    expect(dailyProspectingListIntent("Nos leads do Carlos Henrique me dê o nome, cidade e cargo dos que não tiverem Instagram; dos que tiverem, nome e @Instagram")).toBe("INSTAGRAM");

    const answer = formatDailyProspectingList({
      batch: instagramBatch,
      target: 75,
      totalPoliticians: 2,
      activitySummary: [{ kind: "INSTAGRAM_FOLLOW", label: "Seguir perfil no Instagram", count: 2 }],
      truncated: false,
      entries: [
        { number: 1, leadId: id(12), name: "Ana Silva", city: "Itu", role: "Vereadora", phones: [], instagram: "https://www.instagram.com/anasilva/", tasks: [{ taskId: id(22), kind: "INSTAGRAM_FOLLOW", label: "Seguir perfil no Instagram" }] },
        { number: 2, leadId: id(13), name: "José Lima", city: "Lages", role: "Prefeito", phones: [], instagram: null, tasks: [{ taskId: id(24), kind: "INSTAGRAM_MESSAGE", label: "Mensagem Instagram nº 1" }] },
      ],
    });

    expect(answer).toContain("Com Instagram:\n1. Ana Silva — @anasilva");
    expect(answer).toContain("Sem Instagram:\n2. José Lima — Lages — Prefeito — não tem Instagram");
    expect(answer).not.toContain("Ana Silva — Itu — Vereadora");
  });

  it("mantém políticos sem telefone na lista de ligações", () => {
    const answer = formatDailyProspectingList({
      batch: phoneBatch,
      target: 75,
      totalPoliticians: 1,
      activitySummary: [{ kind: "CALL", label: "Ligação nº 1", count: 1 }],
      truncated: false,
      entries: [{ number: 1, leadId: id(10), name: "Carlos Souza", city: null, role: null, phones: [], instagram: null, tasks: [{ taskId: id(20), kind: "CALL", label: "Ligação nº 1" }] }],
    });

    expect(answer).toContain("1. Carlos Souza — não tem telefone — Ligação nº 1");
  });

  it("explica quando o canal pedido está vazio sem esconder o restante da meta", () => {
    const answer = formatDailyProspectingList({
      batch: { ...phoneBatch, items: [] },
      target: 75,
      totalPoliticians: 75,
      activitySummary: [{ kind: "INSTAGRAM_MESSAGE", label: "Mensagem Instagram nº 1", count: 72 }],
      truncated: false,
      entries: [],
    });

    expect(answer).toContain("Não há tarefas pendentes de ligações");
    expect(answer).toContain("A meta completa ainda possui 75 político(s)");
    expect(answer).toContain("Mensagem Instagram nº 1: 72");
  });

  it("mostra a meta completa com contatos e a etapa exata de cada atividade", () => {
    const answer = formatDailyProspectingList({
      batch: dailyBatch,
      target: 75,
      totalPoliticians: 1,
      activitySummary: [
        { kind: "CALL", label: "Ligação nº 2", count: 1 },
        { kind: "INSTAGRAM_FOLLOW", label: "Seguir perfil no Instagram", count: 1 },
        { kind: "INSTAGRAM_MESSAGE", label: "Mensagem Instagram nº 3", count: 1 },
      ],
      truncated: false,
      entries: [{
        number: 1, leadId: id(10), name: "Ana Silva", city: "Itu", role: "Vereadora",
        phones: ["+5511999999999"], instagram: "@anasilva",
        tasks: [
          { taskId: id(20), kind: "CALL", label: "Ligação nº 2" },
          { taskId: id(22), kind: "INSTAGRAM_FOLLOW", label: "Seguir perfil no Instagram" },
          { taskId: id(23), kind: "INSTAGRAM_MESSAGE", label: "Mensagem Instagram nº 3" },
        ],
      }],
    });

    expect(answer).toContain("Telefone: +5511999999999");
    expect(answer).toContain("Instagram: @anasilva");
    expect(answer).toContain("Atividades: Ligação nº 2, Seguir perfil no Instagram, Mensagem Instagram nº 3");
  });

  it("converte resultados de ligação em uma única ação em lote", () => {
    expect(buildDailyProspectingAction(phoneBatch, "1 - atendeu\n2 - não atendeu")).toEqual({
      kind: "COMPLETE_PROSPECTING_TASKS",
      items: [
        { leadId: id(10), taskId: id(20), taskKind: "CALL", result: "CONNECTED" },
        { leadId: id(11), taskId: id(21), taskKind: "CALL", result: "NO_ANSWER" },
      ],
    });
    expect(buildDailyProspectingAction(phoneBatch, "1 - atendeu, 2 - não atendeu").items).toHaveLength(2);
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

  it("converte em lote somente os resultados informados na lista completa", () => {
    expect(buildDailyProspectingAction(dailyBatch, "1 - não atendeu, segui e enviei mensagem")).toEqual({
      kind: "COMPLETE_PROSPECTING_TASKS",
      items: [
        { leadId: id(10), taskId: id(20), taskKind: "CALL", result: "NO_ANSWER" },
        { leadId: id(10), taskId: id(22), taskKind: "INSTAGRAM_FOLLOW", result: "COMPLETED" },
        { leadId: id(10), taskId: id(23), taskKind: "INSTAGRAM_MESSAGE", result: "SENT" },
      ],
    });
    expect(buildDailyProspectingAction(dailyBatch, "1 - atendeu").items).toEqual([
      { leadId: id(10), taskId: id(20), taskKind: "CALL", result: "CONNECTED" },
    ]);
    expect(buildDailyProspectingAction(dailyBatch, "1 - não achei Instagram").items).toEqual([
      { leadId: id(10), taskId: id(22), taskKind: "INSTAGRAM_FOLLOW", result: "PROFILE_NOT_FOUND" },
      { leadId: id(10), taskId: id(23), taskKind: "INSTAGRAM_MESSAGE", result: "PROFILE_NOT_FOUND" },
    ]);
  });

  it("rejeita número fora da lista, duplicado ou resultado incompatível", () => {
    expect(() => buildDailyProspectingAction(phoneBatch, "3 - atendeu")).toThrow(/não pertence/i);
    expect(() => buildDailyProspectingAction(phoneBatch, "1 - atendeu\n1 - não atendeu")).toThrow(/repetido/i);
    expect(() => buildDailyProspectingAction(phoneBatch, "1 - segui")).toThrow(/resultado/i);
  });
});
