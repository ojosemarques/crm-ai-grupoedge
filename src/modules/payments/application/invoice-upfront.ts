import type { Prisma, PrismaClient } from "@/generated/prisma/client";

export async function invoiceUpfrontAmounts(
  database: PrismaClient | Prisma.TransactionClient,
  workspaceId: string,
  invoices: readonly { id: string; revisedUpfrontCents: bigint | null }[],
) {
  const historical = invoices.filter((invoice) => invoice.revisedUpfrontCents === null).map((invoice) => invoice.id);
  const lines = historical.length ? await database.invoiceLine.findMany({
    where: { workspaceId, invoiceId: { in: historical }, position: 2, descriptionSnapshot: "Entrada contratual" },
    select: { invoiceId: true, totalCents: true },
  }) : [];
  const original = new Map(lines.map((line) => [line.invoiceId, line.totalCents]));
  return new Map(invoices.map((invoice) => [
    invoice.id, invoice.revisedUpfrontCents ?? original.get(invoice.id) ?? 0n,
  ]));
}
