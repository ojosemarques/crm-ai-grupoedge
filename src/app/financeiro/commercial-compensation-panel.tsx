"use client";

import { useRef, useState, type FormEvent } from "react";
import { AccessibleDialog } from "@/components/ui/accessible-dialog";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import type { CommercialCompensationRow } from "@/modules/finance/application/commercial-compensation-screen";
import { parseWorkspaceLocalDateTime } from "@/shared/core/time/workspace-time";
import styles from "./finance-workspace.module.css";

const kinds = {
  SALE_COMMISSION: "Comissão de venda", CLOSER_BONUS: "Bônus de closer",
  SDR_COMMISSION: "Comissão de Anúncios", SDR_BONUS: "Bônus de Anúncios", LEGACY_STAGE: "Etapa histórica",
};
const states = { PENDING: "Pendente", ELIGIBLE: "Elegível", APPROVED: "Aprovada", PAID: "Paga", REVIEW: "Em revisão" };
const integer = new Intl.NumberFormat("pt-BR");

function money(value: string | bigint | null) {
  if (value === null) return "—";
  const cents = BigInt(value);
  return `R$ ${integer.format(cents / 100n)},${(cents % 100n).toString().padStart(2, "0")}`;
}
const localDate = (value: string | null) => value?.split("-").reverse().join("/") ?? "—";
const instant = (value: string | null, timeZone: string) => value
  ? new Intl.DateTimeFormat("pt-BR", { timeZone, dateStyle: "short", timeStyle: "short" }).format(new Date(value)) : "—";

type ReferenceRow = Record<string, unknown>;
type Send = (payload: Record<string, unknown>, success: string, onSuccess?: () => void, onError?: (message: string) => void) => Promise<void>;

export function CommercialCompensationPanel({ rows, accounts, entries, timeZone, canPay, busy, send }: {
  rows: readonly CommercialCompensationRow[];
  accounts: readonly ReferenceRow[];
  entries: readonly ReferenceRow[];
  timeZone: string;
  canPay: boolean;
  busy: boolean;
  send: Send;
}) {
  const [filters, setFilters] = useState({ seller: "", kind: "", status: "", customer: "", sale: "" });
  const [paying, setPaying] = useState<CommercialCompensationRow | null>(null);
  const shown = rows.filter((row) =>
    (!filters.seller || row.sellerId === filters.seller) &&
    (!filters.kind || row.kind === filters.kind) &&
    (!filters.status || row.status === filters.status) &&
    (!filters.customer || row.customerId === filters.customer) &&
    (!filters.sale || row.opportunityId === filters.sale),
  );
  const summaries = [
    ["Geradas por competência", shown.reduce((sum, row) => sum + (row.generatedInPeriod ? BigInt(row.amountCents) : 0n), 0n)],
    ["A pagar por vencimento", shown.reduce((sum, row) => sum + (row.dueInPeriod && ["ELIGIBLE", "APPROVED"].includes(row.status) ? BigInt(row.balanceCents) : 0n), 0n)],
    ["Pagas por data da baixa", shown.reduce((sum, row) => sum + BigInt(row.periodPaidCents), 0n)],
    ["Pendentes e em revisão", shown.reduce((sum, row) => sum + (["PENDING", "REVIEW"].includes(row.status) ? BigInt(row.balanceCents) : 0n), 0n)],
  ] as const;
  const options = (getId: (row: CommercialCompensationRow) => string | null, getName: (row: CommercialCompensationRow) => string | null) =>
    [...new Map(rows.flatMap((row) => {
      const id = getId(row);
      return id ? [[id, getName(row) ?? id] as const] : [];
    }))].sort((left, right) => left[1].localeCompare(right[1], "pt-BR"));

  return <section className={styles.panel} aria-labelledby="commercial-compensation-title">
    <h2 id="commercial-compensation-title">Remuneração comercial</h2>
    <p>Consulte os títulos do período selecionado e as evidências da apuração.</p>
    <div className={styles.period}>
      {[
        ["seller", "Vendedor", options((row) => row.sellerId, (row) => row.sellerName)],
        ["kind", "Tipo de título", Object.entries(kinds)],
        ["status", "Estado do título", Object.entries(states)],
        ["customer", "Cliente", options((row) => row.customerId, (row) => row.customerName)],
        ["sale", "Venda", options((row) => row.opportunityId, (row) => row.opportunityName)],
      ].map(([key, label, values]) => {
        const field = key as keyof typeof filters;
        return <label key={String(key)}>{String(label)} <select value={filters[field]} onChange={(event) => setFilters({ ...filters, [field]: event.target.value })}>
          <option value="">Todos</option>{(values as readonly (readonly [string, string])[]).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select></label>;
      })}
    </div>
    <dl className={styles.metrics}>{summaries.map(([label, total]) => <div key={label}><dt>{label}</dt><dd>{money(total)}</dd></div>)}</dl>
    {shown.length ? <div className={styles.tableWrap}><table>
      <thead><tr><th>Vendedor e origem</th><th>Competência</th><th>Estado</th><th>Vencimento</th><th>Total</th><th>Saldo</th><th>Ações</th></tr></thead>
      <tbody>{shown.map((row) => <tr key={row.key}>
        <td><strong>{row.sellerName}</strong><small>{kinds[row.kind]}{row.customerName ? ` · ${row.customerName}` : ""}</small>
          <details><summary>Detalhes da apuração</summary>
            <dl>
              {row.opportunityName && <><dt>Venda</dt><dd>{row.opportunityName}</dd></>}
              <dt>Política</dt><dd>{row.policyVersion}</dd>
              <dt>Base</dt><dd>{money(row.basisCents)}</dd>
              <dt>Marco</dt><dd>{localDate(row.milestoneOn)}</dd>
              <dt>Elegibilidade</dt><dd>{instant(row.eligibleAt, timeZone)}</dd>
              <dt>Total baixado</dt><dd>{money(row.paidCents)}</dd>
            </dl>
            {row.payments.map((payment) => <p key={payment.entryId}>{money(payment.amountCents)} · {instant(payment.settledAt, timeZone)} · {payment.description} · {payment.evidence}</p>)}
            {row.reviews.map((review, index) => <p key={`${review.createdAt}:${index}`}>{instant(review.createdAt, timeZone)} · {review.reason}</p>)}
            <Evidence facts={row.sourceFacts} timeZone={timeZone} />
          </details>
        </td>
        <td>{row.competenceMonth}</td><td><StatusBadge>{states[row.status]}</StatusBadge>{row.reason && <small>{row.reason}</small>}</td>
        <td>{localDate(row.dueOn)}</td><td>{money(row.amountCents)}</td><td>{money(row.balanceCents)}</td>
        <td>{row.kind !== "LEGACY_STAGE" && row.status === "ELIGIBLE" ? <Button size="sm" disabled={busy} onClick={() => void send({
          action: "APPROVE_COMPENSATION", obligationKey: row.key, expectedRevision: row.revision,
        }, "Obrigação aprovada.")}>Aprovar título</Button> :
          row.kind !== "LEGACY_STAGE" && row.status === "APPROVED" && canPay ? <Button size="sm" onClick={() => setPaying(row)}>Registrar baixa</Button> : "—"}</td>
      </tr>)}</tbody>
    </table></div> : <p>Nenhum título no recorte.</p>}
    {paying && <CompensationSettlement row={paying} accounts={accounts} entries={entries} timeZone={timeZone}
      busy={busy} send={send} close={() => setPaying(null)} />}
  </section>;
}

function Evidence({ facts, timeZone }: { facts: CommercialCompensationRow["sourceFacts"]; timeZone: string }) {
  if (!facts || typeof facts !== "object" || Array.isArray(facts)) return null;
  return <>
    {typeof facts.d0 === "string" && <p>D0: {instant(facts.d0, timeZone)}</p>}
    {Array.isArray(facts.tiers) && facts.tiers.map((tier, index) => tier && typeof tier === "object" && !Array.isArray(tier)
      && typeof tier.rateBps === "string" && typeof tier.basisCents === "string" ?
      <p key={index}>Faixa {index + 1}: {Number(tier.rateBps) / 100}% sobre {money(tier.basisCents)}</p> : null)}
    {typeof facts.band === "number" && <p>Faixa de atingimento: {facts.band}% · revisão da apuração {String(facts.snapshotRevision ?? "—")}</p>}
    {Array.isArray(facts.settlements) && facts.settlements.map((payment) => payment && typeof payment === "object" && !Array.isArray(payment)
      && typeof payment.id === "string" && typeof payment.invoiceId === "string" && typeof payment.netCents === "string" ?
      <p key={payment.id}>Cobrança {payment.invoiceId} · líquido {money(payment.netCents)} · entrada {money(typeof payment.upfrontNetCents === "string" ? payment.upfrontNetCents : null)}</p> : null)}
  </>;
}

function CompensationSettlement({ row, accounts, entries, timeZone, busy, send, close }: {
  row: CommercialCompensationRow; accounts: readonly ReferenceRow[]; entries: readonly ReferenceRow[];
  timeZone: string; busy: boolean; send: Send; close: () => void;
}) {
  const [entryId, setEntryId] = useState("");
  const [error, setError] = useState("");
  const attempt = useRef<{ body: string; key: string } | null>(null);
  const existing = entries.find((entry) => entry.id === entryId);
  const expenses = entries.filter((entry) => entry.type === "MANUAL" && entry.direction === "EXPENSE" && entry.status === "SETTLED" &&
    typeof entry.financialAccountId === "string" && typeof entry.settledAt === "string");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    const decimal = /^(\d{1,14})(?:,(\d{1,2}))?$/.exec(String(form.get("amount") ?? "").trim());
    if (!decimal) { setError("Informe o valor em reais, com vírgula e até dois centavos."); return; }
    const amount = BigInt(decimal[1]!) * 100n + BigInt((decimal[2] ?? "").padEnd(2, "0"));
    if (amount <= 0n || amount > BigInt(row.balanceCents)) { setError("Informe um valor positivo até o saldo do título."); return; }
    try {
      const payload = {
        action: "SETTLE_COMPENSATION", obligationKey: row.key, expectedRevision: row.revision,
        financialAccountId: existing?.financialAccountId ?? form.get("account"),
        ...(existing ? { financialEntryId: existing.id } : {}),
        settledAt: existing?.settledAt ?? parseWorkspaceLocalDateTime(String(form.get("settledAt")), timeZone).toISOString(),
        amountCents: amount.toString(), reference: form.get("reference"), evidence: form.get("evidence"),
      };
      const body = JSON.stringify(payload);
      if (attempt.current?.body !== body) attempt.current = { body, key: crypto.randomUUID() };
      setError("");
      void send({ ...payload, idempotencyKey: attempt.current.key }, "Baixa registrada.", close, setError);
    } catch {
      setError("Informe uma data efetiva válida no fuso do workspace.");
    }
  }

  const balance = BigInt(row.balanceCents);
  return <AccessibleDialog busy={busy} labelledBy="commercial-settlement-title" onDismiss={close}>
    <h2 id="commercial-settlement-title">Registrar baixa de remuneração</h2>
    <p>{row.sellerName} · saldo de {money(balance)}. Registre um pagamento já efetuado.</p>
    <form className={styles.form} onSubmit={submit}>
      <label>Despesa existente<select value={entryId} onChange={(event) => setEntryId(event.target.value)}>
        <option value="">Registrar nova despesa</option>
        {expenses.map((entry) => <option key={String(entry.id)} value={String(entry.id)}>{String(entry.description)} · {instant(String(entry.settledAt), timeZone)}</option>)}
      </select></label>
      {!existing && <>
        <label>Conta utilizada<select name="account" required><option value="">Selecione</option>
          {accounts.filter((account) => account.active !== false).map((account) => <option key={String(account.id)} value={String(account.id)}>{String(account.name)}</option>)}
        </select></label>
        <label>Data e hora efetivas<input name="settledAt" type="datetime-local" required /></label>
      </>}
      <label>Valor baixado (R$)<input name="amount" inputMode="decimal" required defaultValue={`${balance / 100n},${(balance % 100n).toString().padStart(2, "0")}`} /></label>
      <label>Referência bancária<input name="reference" required minLength={4} maxLength={180} /></label>
      <label>Evidência da baixa<textarea name="evidence" required minLength={5} maxLength={500} /></label>
      {error && <p role="alert">{error}</p>}
      <div className={styles.formActions}><Button disabled={busy} type="submit">Confirmar baixa</Button><Button disabled={busy} type="button" variant="secondary" onClick={close}>Cancelar</Button></div>
    </form>
  </AccessibleDialog>;
}
