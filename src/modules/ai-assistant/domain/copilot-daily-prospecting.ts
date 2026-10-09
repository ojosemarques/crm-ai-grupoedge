import { z } from "zod";

import type { CopilotAction } from "@/modules/ai-assistant/domain/copilot-action-contracts";
import { ApplicationError } from "@/shared/core/errors/application-error";

export const dailyProspectingChannels = ["CALL", "INSTAGRAM"] as const;
export type DailyProspectingChannel = (typeof dailyProspectingChannels)[number];
export type DailyProspectingTaskKind = "CALL" | "INSTAGRAM_MESSAGE" | "INSTAGRAM_FOLLOW";

const taskSchema = z.object({
  taskId: z.string().uuid(),
  kind: z.enum(["CALL", "INSTAGRAM_MESSAGE", "INSTAGRAM_FOLLOW"]),
}).strict();

export const dailyProspectingBatchSchema = z.object({
  batchId: z.string().uuid(),
  channel: z.enum(dailyProspectingChannels),
  localDate: z.iso.date(),
  expiresAt: z.iso.datetime({ offset: true }),
  items: z.array(z.object({
    number: z.number().int().positive(),
    leadId: z.string().uuid(),
    tasks: z.array(taskSchema).min(1).max(2),
  }).strict()).max(75),
}).strict();

export type DailyProspectingBatch = z.infer<typeof dailyProspectingBatchSchema>;
export type DailyProspectingEntry = Readonly<{
  number: number;
  leadId: string;
  name: string;
  city: string | null;
  role: string | null;
  phones: readonly string[];
  instagram: string | null;
  tasks: readonly Readonly<{ taskId: string; kind: DailyProspectingTaskKind }>[];
}>;
export type DailyProspectingList = Readonly<{
  batch: DailyProspectingBatch;
  target: number;
  truncated: boolean;
  entries: readonly DailyProspectingEntry[];
}>;

function normalized(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

function invalid(message: string): never {
  throw new ApplicationError(message, { code: "COPILOT_DAILY_SUMMARY_INVALID", statusCode: 400, expose: true });
}

export function dailyProspectingListIntent(message: string): DailyProspectingChannel | null {
  const text = normalized(message);
  const wantsList = /\b(lista|liste|listar|todos|todas|nomes)\b/.test(text);
  const dailyScope = /\b(meta|diari[ao]|hoje|meu dia|leads?|politicos?)\b/.test(text);
  if (!wantsList || !dailyScope) return null;
  if (/\b(instagram|insta)\b/.test(text)) return "INSTAGRAM";
  if (/\b(telefone|telefones|numero|numeros|ligacao|ligacoes|ligar)\b/.test(text)) return "CALL";
  return null;
}

export function dailyProspectingSummaryIntent(message: string): boolean {
  const text = normalized(message);
  if (!/^\s*\d{1,3}\s*[-–—.):=]/m.test(message)) return false;
  return /\b(nao atendeu|sem resposta|atendeu|conectou|conectado|ocupado|caixa postal|voicemail|numero incorreto|telefone incorreto|numero errado|canal indisponivel|sem telefone|nao achei|nao encontrou|perfil nao encontrado|sem instagram|falhou|erro|feito|segui|seguido|ja seguia|ja seguindo|enviei|mandei|mensagem enviada)\b/.test(text);
}

export function formatDailyProspectingList(list: DailyProspectingList): string {
  const channel = list.batch.channel === "CALL" ? "ligações" : "Instagram";
  if (list.entries.length === 0) return `Não há tarefas pendentes de ${channel} na sua meta diária.`;
  const lines = list.entries.map((entry) => {
    if (list.batch.channel === "CALL") return `${entry.number}. ${entry.name} — ${entry.phones.join(", ")}`;
    return `${entry.number}. ${entry.name} — ${entry.city ?? "cidade não informada"} — ${entry.role ?? "cargo não informado"} — ${entry.instagram ?? "não tem Instagram"}`;
  });
  const limitation = list.truncated ? `\nA fila tem mais políticos, mas esta lista respeita sua meta configurada de ${list.target}.` : "";
  const examples = list.batch.channel === "CALL"
    ? "Exemplo: `1 - atendeu` ou `2 - não atendeu`."
    : "Exemplo: `1 - segui e enviei mensagem` ou `2 - não achei Instagram`.";
  return `Lista pendente de ${channel} da meta diária (${list.entries.length}/${list.target}):\n\n${lines.join("\n")}\n\nResponda usando os números desta lista. ${examples}${limitation}`;
}

function numberedResults(message: string): Array<{ number: number; text: string }> {
  const matches = [...message.matchAll(/(?:^|\n|;)\s*(\d{1,3})\s*(?:[-–—.):=])\s*([^\n;]+?)(?=\s*(?:\n|;|$))/g)];
  if (matches.length === 0) invalid("Envie o resumo em linhas numeradas, por exemplo: 1 - não atendeu.");
  const seen = new Set<number>();
  return matches.map((match) => {
    const number = Number(match[1]);
    if (seen.has(number)) invalid(`O número ${number} está repetido no resumo.`);
    seen.add(number);
    return { number, text: normalized(match[2] ?? "") };
  });
}

function callResult(text: string) {
  if (/\b(nao atendeu|sem resposta)\b/.test(text)) return "NO_ANSWER" as const;
  if (/\b(atendeu|conectou|conectado)\b/.test(text)) return "CONNECTED" as const;
  if (/\b(ocupado)\b/.test(text)) return "BUSY" as const;
  if (/\b(caixa postal|voicemail)\b/.test(text)) return "VOICEMAIL" as const;
  if (/\b(numero incorreto|telefone incorreto|numero errado)\b/.test(text)) return "WRONG_NUMBER" as const;
  if (/\b(canal indisponivel|sem telefone)\b/.test(text)) return "CHANNEL_UNAVAILABLE" as const;
  return null;
}

function instagramResults(text: string, tasks: DailyProspectingBatch["items"][number]["tasks"]) {
  const resultForAll = /\b(nao achei|nao encontrou|perfil nao encontrado|sem instagram)\b/.test(text)
    ? "PROFILE_NOT_FOUND" as const
    : /\b(canal indisponivel)\b/.test(text)
      ? "CHANNEL_UNAVAILABLE" as const
      : /\b(falhou|erro)\b/.test(text)
        ? "FAILED" as const
        : null;
  type Parsed = { taskId: string; kind: DailyProspectingTaskKind; result: "PROFILE_NOT_FOUND" | "CHANNEL_UNAVAILABLE" | "FAILED" | "ALREADY_FOLLOWING" | "COMPLETED" | "SENT" };
  if (resultForAll) return tasks.map((task): Parsed => ({ ...task, result: resultForAll }));
  const allDone = /^feito$/.test(text) || (/\b(segui|seguido)\b/.test(text) && /\b(enviei|mandei|mensagem)\b/.test(text));
  const followed = allDone || /\b(segui|seguido)\b/.test(text);
  const alreadyFollowing = /\b(ja seguia|ja seguindo)\b/.test(text);
  const messaged = allDone || /\b(enviei|mandei|mensagem enviada)\b/.test(text);
  const results: Parsed[] = [];
  for (const task of tasks) {
    if (task.kind === "INSTAGRAM_FOLLOW" && alreadyFollowing) results.push({ ...task, result: "ALREADY_FOLLOWING" });
    else if (task.kind === "INSTAGRAM_FOLLOW" && followed) results.push({ ...task, result: "COMPLETED" });
    else if (task.kind === "INSTAGRAM_MESSAGE" && messaged) results.push({ ...task, result: "SENT" });
  }
  return results;
}

export function buildDailyProspectingAction(batchInput: DailyProspectingBatch, message: string): Extract<CopilotAction, { kind: "COMPLETE_PROSPECTING_TASKS" }> {
  const batch = dailyProspectingBatchSchema.parse(batchInput);
  const rows = numberedResults(message);
  const items: Extract<CopilotAction, { kind: "COMPLETE_PROSPECTING_TASKS" }>["items"] = [];
  for (const row of rows) {
    const batchItem = batch.items.find((item) => item.number === row.number);
    if (!batchItem) invalid(`O número ${row.number} não pertence à última lista apresentada.`);
    if (batch.channel === "CALL") {
      const result = callResult(row.text);
      if (!result) invalid(`Resultado inválido para o número ${row.number}. Use atendeu, não atendeu, ocupado, caixa postal, número incorreto ou canal indisponível.`);
      const task = batchItem.tasks.find((item) => item.kind === "CALL");
      if (!task) invalid(`A tarefa de ligação do número ${row.number} não está disponível.`);
      items.push({ leadId: batchItem.leadId, taskId: task.taskId, taskKind: task.kind, result });
      continue;
    }
    const results = instagramResults(row.text, batchItem.tasks);
    if (results.length === 0) invalid(`Resultado inválido para o número ${row.number}. Use segui, enviei mensagem, segui e enviei mensagem, feito ou não achei Instagram.`);
    items.push(...results.map((result) => ({ leadId: batchItem.leadId, taskId: result.taskId, taskKind: result.kind, result: result.result })));
  }
  return { kind: "COMPLETE_PROSPECTING_TASKS", items };
}
