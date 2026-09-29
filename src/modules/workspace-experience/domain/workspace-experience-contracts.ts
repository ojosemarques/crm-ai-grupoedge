import { z } from "zod";

export const homeViewKeys = ["SDR", "CLOSER", "FARMER", "CUSTOMER_SUCCESS", "MANAGER", "ADMIN"] as const;
export type HomeViewKey = (typeof homeViewKeys)[number];

export const homeQuerySchema = z.object({ view: z.enum(homeViewKeys).optional() }).strict();
export const globalSearchQuerySchema = z.object({
  q: z.string().trim().min(2).max(80),
  page: z.coerce.number().int().min(1).max(20).default(1),
  pageSize: z.coerce.number().int().min(4).max(20).default(12),
}).strict();

export type OperationalAction = Readonly<{
  kind: string;
  title: string;
  reason: string;
  urgency: "CRITICAL" | "ATTENTION" | "NORMAL";
  entityType: "Lead" | "Opportunity" | "Account" | "Workspace";
  entityId: string;
  entityLabel: string;
  dueAt: string | null;
  href: string;
  cta: string;
}>;

export type HomeMetric = Readonly<{
  label: string;
  value: string;
  state: "AVAILABLE" | "ZERO" | "UNAVAILABLE" | "PARTIAL" | "SUPPRESSED";
  href: string | null;
}>;

export type RoleHomeScreen = Readonly<{
  generatedAt: string;
  timeZone: string;
  displayName: string;
  activeView: HomeViewKey;
  availableViews: readonly HomeViewKey[];
  scope: "WORKSPACE" | "TEAM" | "OWN";
  primaryAction: OperationalAction | null;
  metrics: readonly HomeMetric[];
  queue: readonly OperationalAction[];
  state: "READY" | "EMPTY" | "PARTIAL";
}>;

export type GlobalSearchResult = Readonly<{
  id: string;
  type: "ACCOUNT" | "CONTACT" | "LEAD" | "OPPORTUNITY";
  title: string;
  context: string;
  hint: string | null;
  href: string;
}>;

export type GlobalSearchResponse = Readonly<{
  query: string;
  page: number;
  pageSize: number;
  hasMore: boolean;
  groups: readonly Readonly<{ type: GlobalSearchResult["type"]; label: string; items: readonly GlobalSearchResult[] }>[];
}>;

export type Contact360 = Readonly<{
  id: string; preferredName: string; legalName: string | null; jobTitle: string | null; status: string; quality: string; origin: string; timeZone: string;
  points: readonly Readonly<{ id: string; type: string; maskedValue: string; primary: boolean; verification: string; quality: string; doNotContact: boolean }>[];
  consents: readonly Readonly<{ id: string; channel: string; state: string; reasonCode: string; effectiveFrom: string }>[];
  accounts: readonly Readonly<{ roleId: string; accountId: string; accountName: string; roleType: string; influence: string; authority: string; validFrom: string; validTo: string | null }>[];
  leads: readonly Readonly<{ id: string; name: string; status: string; organization: string | null; href: string }>[];
  opportunities: readonly Readonly<{ id: string; name: string; status: string; amountCents: string; href: string }>[];
  conversations: readonly Readonly<{ id: string; channel: string; status: string; subject: string | null; lastMessageAt: string | null; href: string }>[];
  meetings: readonly Readonly<{ id: string; title: string; status: string; startsAt: string; href: string }>[];
  timeline: readonly Readonly<{ id: string; type: string; title: string; occurredAt: string; provenance: string; href: string | null }>[];
  page: number; pageSize: number; hasMoreTimeline: boolean; primaryAction: OperationalAction | null;
}>;

const priority: Readonly<Record<OperationalAction["urgency"], number>> = { CRITICAL: 0, ATTENTION: 1, NORMAL: 2 };
export function rankOperationalActions(actions: readonly OperationalAction[]): OperationalAction[] {
  return [...actions].sort((a, b) => priority[a.urgency] - priority[b.urgency] || (a.dueAt ?? "9999").localeCompare(b.dueAt ?? "9999") || a.entityId.localeCompare(b.entityId));
}

export function normalizeGlobalSearchTerm(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").trim().replace(/\s+/g, " ").toLocaleLowerCase("pt-BR");
}

export function maskContactPoint(type: "PHONE" | "EMAIL", value: string): string {
  if (type === "PHONE") return value.length <= 4 ? "••••" : `•••• ${value.slice(-4)}`;
  const [local = "", domain = ""] = value.split("@");
  return `${local.slice(0, 1) || "•"}•••@${domain || "•••"}`;
}

export function defaultHomeView(roleKey: string, available: readonly HomeViewKey[]): HomeViewKey {
  const preferred: HomeViewKey = roleKey === "sdr" ? "SDR" : roleKey === "closer" ? "CLOSER" : roleKey === "administrator" ? "ADMIN" : roleKey === "commercial_manager" ? "MANAGER" : available[0] ?? "MANAGER";
  return available.includes(preferred) ? preferred : available[0] ?? "MANAGER";
}
