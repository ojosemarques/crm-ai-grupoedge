type ContactRow = Readonly<{
  eventType: string;
  leadId: string | null;
  creditedMemberId?: string | null;
  quantity: number;
}>;

export const effectiveContactEventTypes = [
  "CALL_CONNECTED",
  "INBOUND_MESSAGE_RECEIVED",
  "WHATSAPP_MESSAGE_SENT",
  "INSTAGRAM_MESSAGE_SENT",
  "EMAIL_SENT",
] as const;

export function summarizeEffectiveContacts(rows: readonly ContactRow[]) {
  const totalBalances = new Map<string, number>();
  const memberBalances = new Map<string, Map<string, number>>();
  for (const row of rows) {
    if (!row.leadId || !effectiveContactEventTypes.some((eventType) => eventType === row.eventType)) continue;
    const key = `${row.eventType}:${row.leadId}`;
    totalBalances.set(key, (totalBalances.get(key) ?? 0) + row.quantity);
    if (!row.creditedMemberId) continue;
    const balances = memberBalances.get(row.creditedMemberId) ?? new Map<string, number>();
    balances.set(key, (balances.get(key) ?? 0) + row.quantity);
    memberBalances.set(row.creditedMemberId, balances);
  }
  const distinctLeads = (balances: ReadonlyMap<string, number>) => new Set([...balances]
    .filter(([, quantity]) => quantity > 0)
    .map(([key]) => key.slice(key.indexOf(":") + 1))).size;
  return Object.freeze({
    total: distinctLeads(totalBalances),
    byMember: new Map([...memberBalances].map(([memberId, balances]) => [memberId, distinctLeads(balances)])),
  });
}
