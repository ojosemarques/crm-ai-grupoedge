export type Row = Record<string, unknown>;

export function text(value: unknown, fallback = "—") { return typeof value === "string" && value.trim() ? value : typeof value === "number" ? String(value) : fallback; }
export function cents(value: unknown) { try { return typeof value === "bigint" ? value : BigInt(typeof value === "number" ? Math.round(value) : typeof value === "string" && /^-?\d+$/.test(value) ? value : "0"); } catch { return 0n; } }
export function money(value: unknown) { const amount = cents(value); const abs = amount < 0n ? -amount : amount; return `${amount < 0n ? "−" : ""}R$ ${new Intl.NumberFormat("pt-BR").format(abs / 100n)},${(abs % 100n).toString().padStart(2, "0")}`; }
const dateFormatters = new Map<string, Intl.DateTimeFormat>();

export function date(value: unknown, timeZone = "UTC") {
  if (typeof value !== "string" && !(value instanceof Date)) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  let formatter = dateFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone });
    dateFormatters.set(timeZone, formatter);
  }
  return formatter.format(parsed);
}
export function statusTone(status: string): "success" | "warning" | "danger" | "info" | "neutral" { if (["PAID", "RECEIVED", "SETTLED", "ACTIVE", "APPROVED"].includes(status)) return "success"; if (["OVERDUE", "REVERSED", "CANCELLED"].includes(status)) return "danger"; if (["PLANNED", "PENDING", "OPEN", "PARTIALLY_PAID", "DUE"].includes(status)) return "warning"; return "neutral"; }
export function statusLabel(status: string) { return ({ PAID: "Pago", RECEIVED: "Recebido", SETTLED: "Liquidado", PLANNED: "Previsto", OPEN: "Em aberto", PENDING: "Pendente", OVERDUE: "Vencido", PARTIALLY_PAID: "Parcial", CANCELLED: "Cancelado", REVERSED: "Estornado", ACTIVE: "Ativa", APPROVED: "Aprovada", DRAFT: "Rascunho" } as Record<string, string>)[status] ?? status; }
