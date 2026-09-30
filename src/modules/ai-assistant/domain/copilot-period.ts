import { resolveDashboardPeriod } from "@/modules/metrics/domain/dashboard-period";
import { addLocalDays, workspaceDateAt, workspaceWeekRange } from "@/shared/core/time/workspace-time";
import { ApplicationError } from "@/shared/core/errors/application-error";

const months = ["janeiro", "fevereiro", "marco", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const writeRequest = /\b(feche|fechar|registre|registrar|marque|marcar|mova|adicionar|adicione|crie|criar|criacao|cadastre|cadastrar|atualize|atualizar|altere|alterar|baixe|baixar|prepare|preparar)\b/;
const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

function operationalDateContinuation(message: string, retrievalQuery: string) {
  if (!retrievalQuery.startsWith(`${message}\n`)) return false;
  const previousRequest = retrievalQuery.slice(message.length + 1).trim().split(/\n+/).at(-1) ?? "";
  if (!writeRequest.test(normalize(previousRequest))) return false;
  // Only a date/time-only reply continues the preceding write request. A new
  // query (including bare "hoje") keeps its own reporting period.
  return /^(?:(?:para|pra|em|no dia|dia|pode ser)\s+)?(?:(?:amanha|depois de amanha|semana que vem)(?:\s+(?:as?\s*)?\d{1,2}(?:h\d{0,2}|:\d{2})?)?|(?:hoje|ontem)\s+as?\s*\d{1,2}(?:h\d{0,2}|:\d{2})?)[.!]?$/.test(normalize(message));
}

export function resolveCopilotPeriod(message: string, now: Date, timeZone: string, retrievalQuery = message) {
  const text = message.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const today = workspaceDateAt(now, timeZone);
  const currentYear = Number(today.slice(0, 4));
  const currentMonth = Number(today.slice(5, 7));
  const period = (preset: "TODAY" | "YESTERDAY" | "WEEK" | "MONTH" | "CUSTOM", from?: string, to?: string, assumed = false) => ({ ...resolveDashboardPeriod(preset, from, to, now, timeZone), timeZone, assumed });
  // Dates in write requests describe the proposed task, receipt or contract,
  // not the time range for reading current company information.
  if (writeRequest.test(text) || operationalDateContinuation(message, retrievalQuery)) return period("MONTH", undefined, undefined, true);
  const month = (year: number, index: number) => {
    const start = new Date(Date.UTC(year, index, 1)).toISOString().slice(0, 10);
    const end = new Date(Date.UTC(year, index + 1, 0)).toISOString().slice(0, 10);
    return period("CUSTOM", start, end);
  };
  const dates = [...text.matchAll(/\b(20\d{2}-\d{2}-\d{2}|\d{2}\/\d{2}\/20\d{2})\b/g)].map((match) => match[1]!.includes("/") ? match[1]!.split("/").reverse().join("-") : match[1]!);
  if (dates.length === 2) return period("CUSTOM", dates[0], dates[1]);
  if (dates.length === 1 && /\b(dia|em)\s/.test(text)) return period("CUSTOM", dates[0], dates[0]);
  if (/mes (passado|anterior)|ultimo mes/.test(text)) return month(currentYear, currentMonth - 2);
  if (/semana (passada|anterior)|ultima semana/.test(text)) {
    const week = workspaceWeekRange(today, timeZone);
    return period("CUSTOM", addLocalDays(week.startDate, -7), addLocalDays(week.startDate, -1));
  }
  const days = /ultim[oa]s?\s+(\d{1,3})\s+dias?/.exec(text);
  if (days && Number(days[1]) >= 1 && Number(days[1]) <= 366) {
    const result = period("CUSTOM", addLocalDays(today, 1 - Number(days[1])), today);
    return { ...result, to: now.toISOString() };
  }
  const namedMonths = months.flatMap((name, index) => new RegExp(`\\b${name}\\b`).test(text) ? [index] : []);
  if (namedMonths.length > 1 || [...text.matchAll(/\b20\d{2}\b/g)].length > 1) {
    throw new ApplicationError("Para comparar períodos, consulte cada intervalo separadamente ou informe duas datas explícitas.", { code: "COPILOT_PERIOD_AMBIGUOUS", statusCode: 422, expose: true });
  }
  const namedMonth = namedMonths[0] ?? -1;
  const year = /\b(20\d{2})\b/.exec(text);
  if (namedMonth >= 0) return month(year ? Number(year[1]) : currentYear, namedMonth);
  if (/ano (passado|anterior)/.test(text)) return period("CUSTOM", `${currentYear - 1}-01-01`, `${currentYear - 1}-12-31`);
  if (year && !dates.length) return period("CUSTOM", `${year[1]}-01-01`, `${year[1]}-12-31`);
  if (/este ano|esse ano|ano atual/.test(text)) return { ...period("CUSTOM", `${currentYear}-01-01`, today), to: now.toISOString() };
  if (/ontem/.test(text)) return period("YESTERDAY");
  if (/hoje/.test(text)) return period("TODAY");
  if (/esta semana|essa semana|semana atual/.test(text)) return period("WEEK");
  if (/este mes|esse mes|mes atual/.test(text)) return period("MONTH");
  if (/trimestre|semestre|\b(semana|mes|meses|ano|anos|desde|anteontem|amanha)\b|ultim[oa]s?\s+\d+\s+dias|entre\s+\d/.test(text)) {
    throw new ApplicationError("Informe o período como duas datas (DD/MM/AAAA a DD/MM/AAAA) para evitar consultar um intervalo diferente do solicitado.", { code: "COPILOT_PERIOD_AMBIGUOUS", statusCode: 422, expose: true });
  }
  return period("MONTH", undefined, undefined, true);
}
