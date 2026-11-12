"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { StatusBadge } from "@/components/ui/status-badge";
import { cents, date, money, statusLabel, statusTone, text, type Row } from "./finance-display";
import styles from "./finance-entries.module.css";

const emptyFilters = { search: "", account: "", category: "", direction: "", status: "" };
const openStatuses = new Set(["PLANNED", "OPEN", "PENDING", "PARTIALLY_PAID", "OVERDUE", "DUE"]);
const fold = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("pt-BR");
const description = (row: Row) => text(row.description);
const category = (row: Row) => text(row.categoryName, "Sem categoria");
const account = (row: Row) => text(row.financialAccountName, "Sem conta vinculada");
const contact = (row: Row) => text(row.counterparty ?? row.customerName);
const direction = (row: Row) => text(row.direction);
const amount = (row: Row) => cents(openStatuses.has(text(row.status)) ? row.outstandingCents ?? row.amountCents : row.amountCents);
const status = (row: Row) => {
  const original = text(row.status);
  if (row.type === "PAYMENT_REVERSAL") return "REVERSED";
  if (original === "PLANNED" && row.approvalStatus === "REJECTED") return "REJECTED";
  if (original !== "SETTLED") return original;
  if (row.reportingKind === "BALANCE_ONLY") return "SETTLED";
  return direction(row) === "EXPENSE" ? "PAID" : "RECEIVED";
};
const label = (value: string) => value === "REJECTED" ? "Rejeitado" : statusLabel(value);

function filterOptions(rows: Row[], value: (row: Row) => string) {
  return [...new Set(rows.map(value))].sort((left, right) => left.localeCompare(right, "pt-BR"));
}

function totalsFor(rows: Row[], period: Row) {
  let income = 0n;
  let expense = 0n;
  const from = text(period.from, "");
  const to = text(period.to, "");
  for (const row of rows) {
    const settledAt = text(row.settledAt, "");
    if (row.status !== "SETTLED" || !settledAt || settledAt < from || settledAt >= to || row.reportingKind === "BALANCE_ONLY") continue;
    if (direction(row) === "EXPENSE") expense += cents(row.amountCents);
    else if (row.reportingKind === "EXPENSE_REFUND") expense -= cents(row.amountCents);
    else income += cents(row.amountCents);
  }
  return { income, expense };
}

export function FinanceEntries({ rows, period, timeZone, onSettle }: Readonly<{
  rows: Row[];
  period: Row;
  timeZone: string;
  onSettle?: ((row: Row) => void) | undefined;
}>) {
  const [filters, setFilters] = useState(emptyFilters);
  const query = fold(filters.search.trim());
  const visible = rows.filter((row) =>
    (!filters.account || account(row) === filters.account)
    && (!filters.category || category(row) === filters.category)
    && (!filters.direction || direction(row) === filters.direction)
    && (!filters.status || status(row) === filters.status)
    && (!query || fold([description(row), category(row), account(row), contact(row)].join(" ")).includes(query)),
  );
  const { income, expense } = totalsFor(visible, period);
  const result = income - expense;
  const cards = [
    { title: "Entradas realizadas", value: money(income), hint: "Recebimentos do período", icon: "entrada", tone: "income" },
    { title: "Saídas líquidas", value: money(expense), hint: "Despesas após estornos", icon: "auditoria", tone: "expense" },
    { title: "Resultado de caixa", value: money(result), hint: "Entradas menos saídas", icon: "tendencia", tone: result < 0n ? "expense" : "income" },
    { title: "Lançamentos exibidos", value: visible.length.toLocaleString("pt-BR"), hint: "Inclui títulos em aberto", icon: "dashboard" },
  ] as const;
  const options = [
    { key: "account", title: "Conta", items: filterOptions(rows, account) },
    { key: "category", title: "Categoria", items: filterOptions(rows, category) },
    { key: "direction", title: "Tipo", items: ["INCOME", "EXPENSE"], labels: { INCOME: "Entrada", EXPENSE: "Saída" } as Record<string, string> },
    { key: "status", title: "Status", items: filterOptions(rows, status) },
  ] as const;

  return <div className={styles.workspace}>
    <section aria-label="Resumo dos lançamentos" className={styles.metrics}>
      {cards.map(({ title, value, hint, icon, ...card }) => <article className={styles.metric} key={title}>
        <div><span>{title}</span><Icon name={icon} size={16}/></div>
        <strong data-tone={"tone" in card ? card.tone : undefined}>{value}</strong>
        <small>{hint}</small>
      </article>)}
    </section>
    <section className={styles.panel} aria-labelledby="finance-entries-heading">
      <header className={styles.header}>
        <h2 id="finance-entries-heading">Lançamentos</h2>
        <p aria-live="polite">{visible.length.toLocaleString("pt-BR")} de {rows.length.toLocaleString("pt-BR")} registros</p>
      </header>
      <div className={styles.filters} role="group" aria-label="Filtros de lançamentos">
        <label>Buscar<input aria-label="Buscar lançamentos" type="search" placeholder="Descrição, conta ou contato" value={filters.search}
          onChange={(event) => setFilters({ ...filters, search: event.target.value })}/></label>
        {options.map((filter) => <label key={filter.key}>{filter.title}
          <select aria-label={filter.title} value={filters[filter.key]} onChange={(event) => setFilters({ ...filters, [filter.key]: event.target.value })}>
            <option value="">Todos</option>
            {filter.items.map((value) => <option key={value} value={value}>{
              filter.key === "status" ? label(value) : "labels" in filter ? filter.labels[value] : value
            }</option>)}
          </select>
        </label>)}
        {Object.values(filters).some(Boolean) ? <Button size="sm" type="button" variant="secondary" onClick={() => setFilters(emptyFilters)}>Limpar filtros</Button> : null}
      </div>
      {visible.length ? <div className={styles.tableWrap}>
        <table aria-label="Movimentações e títulos" role="table">
          <thead role="rowgroup"><tr role="row">
            {["Vencimento", "Descrição", "Categoria", "Conta", "Contato", "Valor", "Status", "Conciliação", ...(onSettle ? ["Ações"] : [])].map((column) =>
              <th scope="col" role="columnheader" key={column}>{column}</th>)}
          </tr></thead>
          <tbody role="rowgroup">{visible.map((row) => {
            const entryStatus = status(row);
            const expenseRow = direction(row) === "EXPENSE";
            const invoiceHref = row.type === "INVOICE" ? `/pagamentos/${text(row.id).replace(/^invoice:/, "")}` : null;
            const canSettle = row.type === "MANUAL" && row.status === "PLANNED"
              && row.approvalStatus !== "PENDING" && row.approvalStatus !== "REJECTED";
            const value = amount(row);
            const due = date(row.dueAt, timeZone);
            const settled = date(row.settledAt, timeZone);
            const competence = date(row.competenceAt, timeZone);
            return <tr role="row" key={text(row.id)}>
              <td role="cell" data-label="Vencimento" className={styles.due}>
                {due}
                {settled !== "—" && settled !== due ? <small>Baixa em {settled}</small> : null}
                {competence !== "—" && competence !== due ? <small>Competência em {competence}</small> : null}
              </td>
              <td role="cell" data-label="Descrição" className={styles.description}>
                <strong>{invoiceHref ? <Link href={invoiceHref}>{description(row)}</Link> : description(row)}</strong>
                <small>{text(row.sourceLabel)}</small>
              </td>
              <td role="cell" data-label="Categoria"><span className={styles.category}
                data-tone={row.reportingKind === "BALANCE_ONLY" ? "neutral" : expenseRow ? "expense" : "income"}>{category(row)}</span></td>
              <td role="cell" data-label="Conta" className={styles.account}>{text(row.financialAccountName)}</td>
              <td role="cell" data-label="Contato" className={styles.contact}>{contact(row)}</td>
              <td role="cell" data-label="Valor" className={styles.value}>
                <strong data-tone={expenseRow ? "expense" : "income"}>{value > 0n && !expenseRow ? "+" : ""}{money(expenseRow ? -value : value)}</strong>
                {row.status === "PARTIALLY_PAID" ? <small>Em aberto</small> : null}
              </td>
              <td role="cell" data-label="Status"><StatusBadge tone={entryStatus === "REJECTED" ? "danger" : statusTone(entryStatus)}>{label(entryStatus)}</StatusBadge></td>
              <td role="cell" data-label="Conciliação">
                {row.reconciled === true ? <span className={styles.matched}>Conciliado</span>
                  : row.type === "MANUAL" && row.status === "SETTLED" ? <span className={styles.muted}>Sem vínculo</span> : "—"}
              </td>
              {onSettle ? <td role="cell" data-label="Ações">
                {canSettle ? <Button onClick={() => onSettle(row)} size="sm" variant="secondary">Liquidar</Button>
                  : invoiceHref && (row.status === "OPEN" || row.status === "PARTIALLY_PAID") ? <Link href={invoiceHref}>Registrar recebimento</Link> : "—"}
              </td> : null}
            </tr>;
          })}</tbody>
        </table>
      </div> : <p className={styles.empty}>{rows.length ? "Nenhum lançamento corresponde aos filtros." : "Nenhum lançamento no período."}</p>}
    </section>
  </div>;
}
