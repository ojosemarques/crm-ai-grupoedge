import { z } from "zod";

import type { CopilotAction } from "@/modules/ai-assistant/domain/copilot-action-contracts";
import { ApplicationError } from "@/shared/core/errors/application-error";

export const dailyProspectingChannels = ["DAILY", "CALL", "INSTAGRAM"] as const;
export type DailyProspectingChannel = (typeof dailyProspectingChannels)[number];
export type DailyProspectingTaskKind = "CALL" | "INSTAGRAM_MESSAGE" | "INSTAGRAM_FOLLOW";

const taskSchema = z.object({
  taskId: z.string().uuid(),
  kind: z.enum(["CALL", "INSTAGRAM_MESSAGE", "INSTAGRAM_FOLLOW"]),
}).strict();

export const dailyProspectingBatchSchema = z.object({
  batchId: z.string().uuid(),
  memberId: z.string().uuid(),
  memberName: z.string().trim().min(1).max(200),
  channel: z.enum(dailyProspectingChannels),
  localDate: z.iso.date(),
  expiresAt: z.iso.datetime({ offset: true }),
  items: z.array(z.object({
    number: z.number().int().positive(),
    leadId: z.string().uuid(),
    tasks: z.array(taskSchema).min(1).max(3),
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
  tasks: readonly Readonly<{ taskId: string; kind: DailyProspectingTaskKind; label: string }>[];
}>;
export type DailyProspectingList = Readonly<{
  batch: DailyProspectingBatch;
  target: number;
  totalPoliticians: number;
  activitySummary: readonly Readonly<{ kind: DailyProspectingTaskKind; label: string; count: number }>[];
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
  const wantsList = /\b(lista|liste|listar|todos|todas|nomes?|contatos|pessoas|quem|quantas?|mostre|mostrar)\b/.test(text);
  const dailyScope = /\b(meta|diari[ao]|hoje|meu dia|fila de tarefas|leads?|politicos?)\b/.test(text);
  if (!wantsList || !dailyScope) return null;
  if (/\b(instagram|insta)\b/.test(text)) return "INSTAGRAM";
  if (/\b(ligacao|ligacoes|ligar|telefonar)\b/.test(text)) return "CALL";
  return "DAILY";
}

function formatInstagram(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("@")) return trimmed;
  const profilePath = trimmed.match(/^(?:https?:\/\/)?(?:www\.)?instagram\.com\/([^/?#]+)/i)?.[1];
  if (profilePath && /^[a-z0-9._]+$/i.test(profilePath)) return `@${profilePath}`;
  if (/^[a-z0-9._]+$/i.test(trimmed)) return `@${trimmed}`;
  return trimmed;
}

export function dailyProspectingSummaryIntent(message: string): boolean {
  const text = normalized(message);
  if (!/^\s*\d{1,3}\s*[-–—.):=]/m.test(message)) return false;
  return /\b(nao atendeu|sem resposta|atendeu|conectou|conectado|ocupado|caixa postal|voicemail|numero incorreto|telefone incorreto|numero errado|canal indisponivel|sem telefone|nao achei|nao encontrou|perfil nao encontrado|sem instagram|falhou|erro|feito|segui|seguido|ja seguia|ja seguindo|enviei|mandei|mensagem enviada)\b/.test(text);
}

export function formatDailyProspectingList(list: DailyProspectingList): string {
  const channel = list.batch.channel === "CALL" ? "ligações" : "Instagram";
  const activitySummary = list.activitySummary.length
    ? list.activitySummary.map((activity) => `${activity.label}: ${activity.count}`).join(" · ")
    : "nenhuma atividade pendente";
  if (list.entries.length === 0) {
    const otherActivities = list.totalPoliticians > 0
      ? ` A meta completa ainda possui ${list.totalPoliticians} político(s): ${activitySummary}.`
      : "";
    if (list.batch.channel === "DAILY") return `Não há atividades pendentes na meta diária de ${list.batch.memberName}.`;
    return `Não há tarefas pendentes de ${channel} na meta diária de ${list.batch.memberName}.${otherActivities}`;
  }
  const entryActivities = (entry: DailyProspectingEntry) => entry.tasks.map((task) => task.label).join(", ");
  let lines: string;
  if (list.batch.channel === "INSTAGRAM") {
    const withInstagram = list.entries
      .filter((entry) => entry.instagram)
      .map((entry) => `${entry.number}. ${entry.name} — ${formatInstagram(entry.instagram!)}\n   Atividades: ${entryActivities(entry)}`);
    const withoutInstagram = list.entries
      .filter((entry) => !entry.instagram)
      .map((entry) => `${entry.number}. ${entry.name} — ${entry.city ?? "cidade não informada"} — ${entry.role ?? "cargo não informado"} — não tem Instagram\n   Atividades: ${entryActivities(entry)}`);
    lines = [
      withInstagram.length ? `Com Instagram:\n${withInstagram.join("\n")}` : "",
      withoutInstagram.length ? `Sem Instagram:\n${withoutInstagram.join("\n")}` : "",
    ].filter(Boolean).join("\n\n");
  } else {
    lines = list.entries.map((entry) => {
      const activities = entryActivities(entry);
      if (list.batch.channel === "CALL") return `${entry.number}. ${entry.name} — ${entry.phones.join(", ") || "não tem telefone"} — ${activities}`;
      return `${entry.number}. ${entry.name} — ${entry.city ?? "cidade não informada"} — ${entry.role ?? "cargo não informado"}\n   Telefone: ${entry.phones.join(", ") || "não tem telefone"}\n   Instagram: ${entry.instagram ? formatInstagram(entry.instagram) : "não tem Instagram"}\n   Atividades: ${activities}`;
    }).join("\n");
  }
  const limitation = list.truncated ? `\nA fila tem mais políticos, mas esta lista respeita sua meta configurada de ${list.target}.` : "";
  const examples = list.batch.channel === "DAILY"
    ? "Exemplo: `1 - não atendeu, segui e enviei mensagem` ou `2 - não achei Instagram`. Só serão concluídas as atividades descritas."
    : list.batch.channel === "CALL"
    ? "Exemplo: `1 - atendeu` ou `2 - não atendeu`."
    : "Exemplo: `1 - segui e enviei mensagem` ou `2 - não achei Instagram`.";
  const heading = list.batch.channel === "DAILY" ? `Lista pendente da meta diária de ${list.batch.memberName}` : `Lista pendente de ${channel} da meta diária de ${list.batch.memberName}`;
  return `${heading} (${list.entries.length} político(s) nesta lista; ${list.totalPoliticians} na meta; capacidade diária: ${list.target}).\nAtividades pendentes: ${activitySummary}.\n\n${lines}\n\nResponda usando os números desta lista. ${examples}${limitation}`;
}

function numberedResults(message: string): Array<{ number: number; text: string }> {
  const matches = [...message.matchAll(/(?:^|[\n;]|,(?=\s*\d{1,3}\s*[-–—.):=]))\s*(\d{1,3})\s*(?:[-–—.):=])\s*([\s\S]+?)(?=\s*(?:[\n;]\s*\d{1,3}\s*[-–—.):=]|,\s*\d{1,3}\s*[-–—.):=]|$))/g)];
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
  const instagramTasks = tasks.filter((task) => task.kind === "INSTAGRAM_FOLLOW" || task.kind === "INSTAGRAM_MESSAGE");
  const resultForAll = /\b(nao achei|nao encontrou|perfil nao encontrado|sem instagram)\b/.test(text)
    ? "PROFILE_NOT_FOUND" as const
    : /\b(canal indisponivel)\b/.test(text)
      ? "CHANNEL_UNAVAILABLE" as const
      : /\b(falhou|erro)\b/.test(text)
        ? "FAILED" as const
        : null;
  type Parsed = { taskId: string; kind: DailyProspectingTaskKind; result: "PROFILE_NOT_FOUND" | "CHANNEL_UNAVAILABLE" | "FAILED" | "ALREADY_FOLLOWING" | "COMPLETED" | "SENT" };
  if (resultForAll) return instagramTasks.map((task): Parsed => ({ ...task, result: resultForAll }));
  const allDone = /^feito$/.test(text) || (/\b(segui|seguido)\b/.test(text) && /\b(enviei|mandei|mensagem)\b/.test(text));
  const followed = allDone || /\b(segui|seguido)\b/.test(text);
  const alreadyFollowing = /\b(ja seguia|ja seguindo)\b/.test(text);
  const messaged = allDone || /\b(enviei|mandei|mensagem enviada)\b/.test(text);
  const results: Parsed[] = [];
  for (const task of instagramTasks) {
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
    if (batch.channel === "DAILY") {
      const result = callResult(row.text);
      const callTask = batchItem.tasks.find((item) => item.kind === "CALL");
      if (result && !callTask) invalid(`A tarefa de ligação do número ${row.number} não está disponível.`);
      if (result && callTask) items.push({ leadId: batchItem.leadId, taskId: callTask.taskId, taskKind: callTask.kind, result });
      const instagram = instagramResults(row.text, batchItem.tasks);
      items.push(...instagram.map((item) => ({ leadId: batchItem.leadId, taskId: item.taskId, taskKind: item.kind, result: item.result })));
      if (!result && instagram.length === 0) invalid(`Resultado inválido para o número ${row.number}. Informe o resultado da ligação e/ou do Instagram.`);
      continue;
    }
    const results = instagramResults(row.text, batchItem.tasks);
    if (results.length === 0) invalid(`Resultado inválido para o número ${row.number}. Use segui, enviei mensagem, segui e enviei mensagem, feito ou não achei Instagram.`);
    items.push(...results.map((result) => ({ leadId: batchItem.leadId, taskId: result.taskId, taskKind: result.kind, result: result.result })));
  }
  return { kind: "COMPLETE_PROSPECTING_TASKS", items };
}
