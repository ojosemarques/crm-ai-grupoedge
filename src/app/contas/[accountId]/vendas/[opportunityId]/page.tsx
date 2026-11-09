import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { PageHeader } from "@/components/layout/page-header";
import { DataTableShell } from "@/components/ui/surface";
import { ReceiptForm } from "@/app/pagamentos/[invoiceId]/receipt-form";
import { PaymentActions } from "@/app/pagamentos/[invoiceId]/payment-actions";
import { requirePageAuthentication } from "@/modules/auth/http/authentication-guards";
import { getOpportunityService } from "@/modules/opportunities/application/opportunity-service";
import { getPaymentService } from "@/modules/payments/application/payment-service";
import { ApplicationError } from "@/shared/core/errors/application-error";
import { workspaceDateAt, workspaceLocalDateTimeAt } from "@/shared/core/time/workspace-time";
import { CustomerConfirmationForm } from "./customer-confirmation-form";
import { ScheduleReallocationForm } from "./schedule-reallocation-form";

export const dynamic = "force-dynamic";
const paramsSchema = z.object({ accountId: z.string().uuid(), opportunityId: z.string().uuid() });
const money = (cents: string) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(cents) / 100);
const dueDate = (iso: string, timeZone: string) => new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone }).format(new Date(iso));
const invoiceStatusLabels = { DRAFT: "Rascunho", OPEN: "Em aberto", PARTIALLY_PAID: "Parcial", PAID: "Recebida", VOIDED: "Anulada", CANCELLED: "Cancelada" };

export default async function CustomerSalePage({ params, searchParams }: {
  params: Promise<{ accountId: string; opportunityId: string }>;
  searchParams: Promise<{ invoice?: string | string[] }>;
}) {
  const context = await requirePageAuthentication();
  const parsed = paramsSchema.safeParse(await params);
  if (!parsed.success) notFound();
  const { accountId, opportunityId } = parsed.data;
  let sale;
  try {
    sale = await getOpportunityService().getCustomerSale(context, accountId, opportunityId);
  } catch (error) {
    if (error instanceof ApplicationError && error.statusCode === 403) redirect("/acesso-negado");
    if (error instanceof ApplicationError && error.statusCode === 404) notFound();
    throw error;
  }
  const revision = sale.confirmation?.revision ?? 0;
  const selectedInvoice = (await searchParams).invoice;
  const editableInstallments = sale.installments.filter((invoice) => invoice.canReallocate).map((invoice) => ({
    ...invoice, dueOn: workspaceDateAt(new Date(invoice.dueAt), sale.timeZone),
  }));
  const selected = sale.installments.find((invoice) => invoice.id === selectedInvoice && invoice.canRead);
  const detail = selected ? await getPaymentService().detail(context, selected.id) : null;
  const lastCollectionEvent = detail?.events.find((event) => event.type === "INVOICE_NOT_RECEIVED" || event.type === "INVOICE_RESCHEDULED");
  const localDateTime = (value: string | null | undefined) => value ? workspaceLocalDateTimeAt(new Date(value), sale.timeZone) : "";
  return <main className="page-canvas">
    <Link href="/contas">Voltar para Clientes e empresas</Link>
    <PageHeader eyebrow={sale.accountName} title={sale.name} description="Confirmação comercial da venda" />
    <div className="mb-5 grid gap-2">
      <p>Vendedor no pipeline: {sale.sellerName}</p>
      <p>Condição contratada: {sale.terms ?? "Contrato comercial pendente"}</p>
      {sale.confirmation && <p>Última confirmação: revisão {revision} em {localDateTime(sale.confirmation.confirmedAt).replace("T", " ")}</p>}
    </div>
    {sale.installments.length > 0 && <section className="mb-6" aria-labelledby="installments-heading">
      <h2 id="installments-heading" className="mb-2 font-semibold">Parcelas do contrato</h2>
      <DataTableShell><table className="w-full text-left">
        <thead><tr><th scope="col">Cobrança</th><th scope="col">Vencimento</th><th scope="col">Valor</th><th scope="col">Recebido</th><th scope="col">Situação</th><th scope="col">Ações</th></tr></thead>
        <tbody>{sale.installments.map((invoice) => <tr key={invoice.id}>
          <td>{invoice.canRead ? <Link href={`/pagamentos/${invoice.id}`}>{invoice.number}</Link> : invoice.number}</td>
          <td>{dueDate(invoice.dueAt, sale.timeZone)}</td><td>{money(invoice.totalCents)}</td>
          <td>{invoice.paidCents === null ? "—" : money(invoice.paidCents)}</td>
          <td>{invoice.status ? invoiceStatusLabels[invoice.status] : "—"}</td>
          <td>{invoice.canRead && <Link href={`?invoice=${invoice.id}#recebimento`}>Conferir parcela</Link>}</td>
        </tr>)}</tbody>
      </table></DataTableShell>
      {(editableInstallments.length >= 2 || (editableInstallments.length === 1 && sale.amendment)) && <ScheduleReallocationForm
        key={editableInstallments.map((item) => `${item.id}:${item.revision}`).join(",")}
        action={`/api/accounts/${accountId}/sales/${opportunityId}/schedule`}
        installments={editableInstallments}
        amendment={sale.amendment}
      />}
    </section>}
    {detail && <section id="recebimento" className="mb-6" aria-labelledby="collection-heading">
      <h2 id="collection-heading" className="mb-2 font-semibold">Cobrança {detail.invoice.invoiceNumber}</h2>
      <p>Saldo em aberto: {money((detail.invoice.totalCents - detail.invoice.paidCents).toString())}{detail.overdue ? " · Vencida" : ""}</p>
      {lastCollectionEvent && <p>{lastCollectionEvent.type === "INVOICE_NOT_RECEIVED" ? "Não recebido" : "Vencimento reagendado"} em {dueDate(lastCollectionEvent.occurredAt.toISOString(), detail.timeZone)}. {lastCollectionEvent.reason}</p>}
      {detail.payments.length > 0 && <ul className="my-3 list-disc pl-5" aria-label="Histórico de recebimentos da parcela">
        {detail.payments.map((payment) => <li key={payment.id}>
          {dueDate(payment.occurredAt.toISOString(), detail.timeZone)} · {money(payment.amountCents.toString())} bruto
          {payment.netSettledCents === null ? " · líquido sem evidência" : ` · ${money(payment.netSettledCents.toString())} líquido`}
          {payment.reversedAt && ` · revertido em ${dueDate(payment.reversedAt.toISOString(), detail.timeZone)}`}
        </li>)}
      </ul>}
      {detail.permissions.recordReceipt && ["OPEN", "PARTIALLY_PAID"].includes(detail.invoice.status) && <ReceiptForm
        key={`receipt:${detail.invoice.id}`}
        invoiceId={detail.invoice.id}
        revision={detail.invoice.revision}
        outstandingCents={(detail.invoice.totalCents - detail.invoice.paidCents).toString()}
        accounts={detail.financialAccounts}
        timeZone={detail.timeZone}
      />}
      {(detail.permissions.markNotReceived || detail.permissions.reschedule) && <PaymentActions
        key={`actions:${detail.invoice.id}`}
        invoiceId={detail.invoice.id}
        revision={detail.invoice.revision}
        status={detail.invoice.status}
        sandboxEnabled={false}
        canManage={false}
        canReprocess={false}
        deadLetterAttempts={[]}
        canMarkNotReceived={detail.permissions.markNotReceived}
        canReschedule={detail.permissions.reschedule}
      />}
    </section>}
    {sale.canConfirm && sale.netContractCents !== null ? <CustomerConfirmationForm key={`${revision}:${sale.scheduleUpfrontCents ?? ""}`}
      action={`/api/accounts/${accountId}/sales/${opportunityId}/confirmation`}
      expectedRevision={revision} netContractCents={sale.netContractCents}
      upfrontLocked={sale.scheduleUpfrontCents !== null}
      sellerOptions={sale.sellerOptions} sellerMemberId={sale.sellerMemberId}
      initial={{
        modality: sale.confirmation?.modality ?? "", upfrontCents: sale.scheduleUpfrontCents ?? sale.confirmation?.upfrontCents ?? "",
        selfSourced: sale.confirmation?.selfSourced ?? false, sourceEvidence: sale.confirmation?.sourceEvidence ?? "",
        confirmationReason: sale.confirmation?.confirmationReason ?? "",
        acceptedAtLocal: localDateTime(sale.confirmation?.acceptedAt),
        activationAtLocal: localDateTime(sale.confirmation?.activationAt),
      }} /> : <p>A confirmação exige acesso de operação e um contrato vigente.</p>}
  </main>;
}
