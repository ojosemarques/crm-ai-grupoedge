"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { StatusBadge } from "@/components/ui/status-badge";
import { cents, date, money, statusLabel, statusTone, text, type Row } from "./finance-display";
import styles from "./finance-entries.module.css";

const emptyFilters = { search: "", account: "", category: "", direction: "", status: "" };
const fold = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("pt-BR");
const description = (row: Row) => text(row.description);
const category = (row: Row) => text(row.categoryName, "Sem categoria");
const account = (row: Row) => text(row.financialAccountName, "Sem conta vinculada");
const contact = (row: Row) => text(row.counterparty ?? row.customerName);
const entryTags = (row: Row) => Array.isArray(row.tags) ? row.tags.filter((tag): tag is string => typeof tag === "string") : [];
const contactTypes: Record<string, string> = { CUSTOMER: "Cliente", SUPPLIER: "Fornecedor", OTHER: "Outro" };
const direction = (row: Row) => text(row.direction);
const status = (row: Row) => {
  if (row.type === "PAYMENT_REVERSAL") return "REVERSED";
  if (row.reportingKind === "BALANCE_ONLY") return "SETTLED";
  return direction(row) === "EXPENSE" ? "PAID" : "RECEIVED";
};

function filterOptions(rows: Row[], value: (row: Row) => string) {
  return [...new Set(rows.map(value))].sort((left, right) => left.localeCompare(right, "pt-BR"));
}

function totalsFor(rows: Row[]) {
  let income = 0n;
  let expense = 0n;
  for (const row of rows) {
    if (row.reportingKind === "BALANCE_ONLY") continue;
    if (direction(row) === "EXPENSE") expense += cents(row.amountCents);
    else if (row.reportingKind === "EXPENSE_REFUND") expense -= cents(row.amountCents);
    else income += cents(row.amountCents);
  }
  return { income, expense };
}

export function FinanceEntries({ rows, timeZone }: Readonly<{ rows: Row[]; timeZone: string }>) {
  const [filters, setFilters] = useState(emptyFilters);
  const query = fold(filters.search.trim());
  const visible = rows.filter((row) =>
    (!filters.account || account(row) === filters.account)
    && (!filters.category || category(row) === filters.category)
    && (!filters.direction || direction(row) === filters.direction)
    && (!filters.status || status(row) === filters.status)
    && (!query || fold([description(row), category(row), account(row), contact(row), ...entryTags(row)].join(" ")).includes(query)),
  );
  const { income, expense } = totalsFor(visible);
  const result = income - expense;
  const cards = [
    { title: "Entradas realizadas", value: money(income), hint: "Recebimentos do período", icon: "entrada", tone: "income" },
    { title: "Saídas líquidas", value: money(expense), hint: "Despesas após estornos", icon: "auditoria", tone: "expense" },
    { title: "Resultado de caixa", value: money(result), hint: "Entradas menos saídas", icon: "tendencia", tone: result < 0n ? "expense" : "income" },
    { title: "Lançamentos exibidos", value: visible.length.toLocaleString("pt-BR"), hint: "Movimentações realizadas", icon: "dashboard" },
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
        <label>Buscar<input aria-label="Buscar lançamentos" type="search" placeholder="Descrição, conta, contato ou tag" value={filters.search}
          onChange={(event) => setFilters({ ...filters, search: event.target.value })}/></label>
        {options.map((filter) => <label key={filter.key}>{filter.title}
          <select aria-label={filter.title} value={filters[filter.key]} onChange={(event) => setFilters({ ...filters, [filter.key]: event.target.value })}>
            <option value="">Todos</option>
            {filter.items.map((value) => <option key={value} value={value}>{
              filter.key === "status" ? statusLabel(value) : "labels" in filter ? filter.labels[value] : value
            }</option>)}
          </select>
        </label>)}
        {Object.values(filters).some(Boolean) ? <Button size="sm" type="button" variant="secondary" onClick={() => setFilters(emptyFilters)}>Limpar filtros</Button> : null}
      </div>
      {visible.length ? <div className={styles.tableWrap}>
        <table aria-label="Movimentações realizadas" role="table">
          <thead role="rowgroup"><tr role="row">
            {["Data da movimentação", "Descrição", "Categoria", "Conta", "Contato", "Valor", "Status", "Conciliação"].map((column) =>
              <th scope="col" role="columnheader" key={column}>{column}</th>)}
          </tr></thead>
          <tbody role="rowgroup">{visible.map((row) => {
            const entryStatus = status(row);
            const expenseRow = direction(row) === "EXPENSE";
            const value = cents(row.amountCents);
            const due = date(row.dueAt, timeZone);
            const settled = date(row.settledAt, timeZone);
            const competence = date(row.competenceAt, timeZone);
            const tags = entryTags(row);
            const notes = text(row.notes, "");
            const contactType = contactTypes[text(row.counterpartyType, "")];
            return <tr role="row" key={text(row.id)}>
              <td role="cell" data-label="Data da movimentação" className={styles.due}>
                {settled}
                {due !== "—" && due !== settled ? <small>Vencimento em {due}</small> : null}
                {competence !== "—" && competence !== settled && competence !== due ? <small>Competência em {competence}</small> : null}
              </td>
              <td role="cell" data-label="Descrição" className={styles.description}>
                <strong>{description(row)}</strong>
                <small>{text(row.sourceLabel)}</small>
                {tags.length ? <small>{tags.join(" · ")}</small> : null}
                {notes ? <details className={styles.notes}><summary>Observações</summary><p>{notes}</p></details> : null}
              </td>
              <td role="cell" data-label="Categoria"><span className={styles.category}
                data-tone={row.reportingKind === "BALANCE_ONLY" ? "neutral" : expenseRow ? "expense" : "income"}>{category(row)}</span></td>
              <td role="cell" data-label="Conta" className={styles.account}>{text(row.financialAccountName)}</td>
              <td role="cell" data-label="Contato" className={styles.contact}>
                {contact(row)}{contactType ? <small>{contactType}</small> : null}
              </td>
              <td role="cell" data-label="Valor" className={styles.value}>
                <strong data-tone={expenseRow ? "expense" : "income"}>{value > 0n && !expenseRow ? "+" : ""}{money(expenseRow ? -value : value)}</strong>
              </td>
              <td role="cell" data-label="Status"><StatusBadge tone={statusTone(entryStatus)}>{statusLabel(entryStatus)}</StatusBadge></td>
              <td role="cell" data-label="Conciliação">
                {row.reconciled === true ? <span className={styles.matched}>Conciliado</span>
                  : row.type === "MANUAL" && row.status === "SETTLED" ? <span className={styles.muted}>Sem vínculo</span> : "—"}
              </td>
            </tr>;
          })}</tbody>
        </table>
      </div> : <p className={styles.empty}>{rows.length ? "Nenhum lançamento corresponde aos filtros." : "Nenhuma movimentação realizada no período."}</p>}
    </section>
  </div>;
}
