"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import {
  Area, AreaChart, Bar, CartesianGrid, Cell, ComposedChart, Legend, Line, Pie, PieChart,
  ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { Icon, type IconName } from "@/components/ui/icon";
import type { FinanceDashboardData } from "@/modules/finance/application/finance-service";
import type { FinanceSection } from "./finance-workspace";
import styles from "./finance-dashboard.module.css";

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const compact = new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 });
const percent = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 1 });
const colors = ["#ed5660", "#f59e24", "#7367e8", "#32a9be", "#df69ad", "#8294b6"];
const dateLabel = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`;
const amount = (cents: string | number) => currency.format(Number(cents) / 100);
const monthLabel = (month: string) => new Intl.DateTimeFormat("pt-BR", { month: "short", timeZone: "UTC" })
  .format(new Date(`${month}-01T00:00:00Z`)).replace(".", "");
const axis = (value: number) => compact.format(value / 100);
const ticks = { fill: "var(--muted-foreground)", fontSize: 11 };
const tooltipStyle = { background: "var(--card)", color: "var(--foreground)", border: "1px solid var(--border)", borderRadius: 12 };

function Panel({ title, note, href, className = "", children }: Readonly<{
  title: string;
  note?: string;
  href?: string;
  className?: string;
  children: ReactNode;
}>) {
  return <section className={`${styles.panel} ${className}`} aria-label={title}>
    <header className={styles.panelHeader}>
      <div><h2>{title}</h2>{note ? <p>{note}</p> : null}</div>
      {href ? <Link href={href} aria-label={`Ver detalhes de ${title}`}><Icon name="seta-direita" size={15}/></Link> : null}
    </header>
    {children}
  </section>;
}

function Comparison({ value, previous, inverse = false }: Readonly<{
  value: string;
  previous: string | null | undefined;
  inverse?: boolean;
}>) {
  if (previous == null) return <small>Sem histórico no mês anterior</small>;
  const change = BigInt(value) - BigInt(previous);
  if (change === 0n) return <small>Sem variação vs. mês anterior</small>;
  const baseline = Math.abs(Number(previous));
  const positive = inverse ? change < 0n : change > 0n;
  const sign = change > 0n ? "+" : "−";
  const difference = baseline ? percent.format(Math.abs(Number(change)) / baseline) : amount(Math.abs(Number(change)));
  return <small data-tone={positive ? "positive" : "negative"}>{sign}{difference} vs. mês anterior</small>;
}

function Metric({ label, value, icon, href, tone, featured, children }: Readonly<{
  label: string;
  value: string;
  icon: IconName;
  href: string;
  tone?: "positive" | "negative";
  featured?: boolean;
  children: ReactNode;
}>) {
  return <Link href={href} className={styles.metric} data-featured={featured || undefined}>
    <span className={styles.metricTop}><span>{label}</span><Icon name={icon} size={16}/></span>
    <strong data-tone={tone}>{amount(value)}</strong>
    {children}
  </Link>;
}

function History({ rows, href, asOf }: Readonly<{ rows: FinanceDashboardData["history"]; href: string; asOf: string | null }>) {
  const chart = rows.map((row) => ({
    month: row.month,
    income: row.incomeCents === null ? null : Number(row.incomeCents),
    expense: row.expenseCents === null ? null : Number(row.expenseCents),
    result: row.resultCents === null ? null : Number(row.resultCents),
  }));
  return <Panel title="Entradas, saídas e resultado" note={`Caixa realizado nos últimos 6 meses${asOf ? ` · mês atual até ${dateLabel(asOf)}` : ""}`} href={href}>
    {chart.some((point) => point.result !== null) ? <>
      <div className={styles.history}>
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <ComposedChart data={chart} accessibilityLayer margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="4 5"/>
            <XAxis dataKey="month" tickFormatter={monthLabel} tick={ticks} tickLine={false} axisLine={false}/>
            <YAxis tickFormatter={axis} tick={ticks} tickLine={false} axisLine={false} width={47}/>
            <ReferenceLine y={0} stroke="var(--muted-foreground)" strokeOpacity={0.45}/>
            <Tooltip formatter={(value) => amount(Number(value))} labelFormatter={(label) => `${monthLabel(String(label))}/${String(label).slice(0, 4)}`} contentStyle={tooltipStyle}/>
            <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }}/>
            <Bar dataKey="income" name="Entradas" fill="var(--fin-green)" maxBarSize={34} isAnimationActive={false}/>
            <Bar dataKey="expense" name="Saídas líquidas" fill="var(--fin-red)" maxBarSize={34} isAnimationActive={false}/>
            <Line dataKey="result" name="Resultado" type="linear" stroke="var(--fin-blue)" strokeWidth={2.5} dot={{ r: 3 }} isAnimationActive={false}/>
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <details className={styles.historyDetails}>
        <summary>Ver valores por mês</summary>
        <div className={styles.historyTable}><table><thead><tr><th>Mês</th><th>Entradas</th><th>Saídas</th><th>Resultado</th></tr></thead>
          <tbody>{rows.map((row) => <tr key={row.month}>
            <th scope="row">{monthLabel(row.month)}/{row.month.slice(0, 4)}</th>
            {[row.incomeCents, row.expenseCents, row.resultCents].map((value, index) =>
              <td key={index}>{value === null ? "—" : amount(value)}</td>)}
          </tr>)}</tbody>
        </table></div>
      </details>
    </> : <p className={styles.empty}>Nenhuma movimentação realizada nesse intervalo.</p>}
  </Panel>;
}

function Distribution({ expenses, total, href }: Readonly<{
  expenses: FinanceDashboardData["expenses"];
  total: string;
  href: string;
}>) {
  const chart = expenses.map((expense, index) => ({ ...expense, value: Number(expense.cents), color: colors[index % colors.length]! }));
  return <Panel title="Distribuição de despesas" note="Saídas brutas liquidadas por categoria" href={href}>
    {chart.length ? <>
      <div className={styles.donut}>
        <div className={styles.donutPlot} aria-hidden="true"><ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <PieChart>
            <Pie data={chart} dataKey="value" nameKey="name" innerRadius="70%" outerRadius="96%" paddingAngle={chart.length > 1 ? 2 : 0} stroke="none" isAnimationActive={false}>
              {chart.map((expense) => <Cell key={expense.name} fill={expense.color}/>)}
            </Pie>
          </PieChart>
        </ResponsiveContainer></div>
        <span><small>Total bruto</small><strong>{amount(total)}</strong></span>
      </div>
      <ul className={styles.legend}>{chart.map((expense) => <li key={expense.name}>
        <i style={{ background: expense.color }}/><span>{expense.name}</span><strong>{amount(expense.cents)}</strong>
        <small>{percent.format(expense.value / Number(total))}</small>
      </li>)}</ul>
    </> : <p className={styles.empty}>Nenhuma despesa liquidada no mês.</p>}
  </Panel>;
}

function Projection({ rows, href }: Readonly<{ rows: FinanceDashboardData["projection"]; href: string }>) {
  const chart = rows.map((row) => ({ day: row.bucket, balance: Number(row.balanceCents) }));
  const last = rows.at(-1);
  const minimum = chart.reduce((value, row) => Math.min(value, row.balance), Number.POSITIVE_INFINITY);
  return <Panel title="Fluxo de caixa projetado" note="Próximos 30 dias · títulos em aberto" href={href}>
    {last ? <>
      <div className={styles.projectionTotals}>
        <div><span>Saldo em {dateLabel(last.bucket)}</span><strong>{amount(last.balanceCents)}</strong></div>
        <div><span>Menor saldo</span><strong data-tone={minimum < 0 ? "negative" : undefined}>{amount(minimum)}</strong></div>
      </div>
      <div className={styles.projection}>
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <AreaChart data={chart} accessibilityLayer margin={{ top: 8, right: 10, left: 2, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="4 5"/>
            <XAxis dataKey="day" tickFormatter={dateLabel} tick={ticks} minTickGap={18} tickLine={false} axisLine={false}/>
            <YAxis domain={["auto", "auto"]} tickFormatter={axis} tick={ticks} tickLine={false} axisLine={false} width={46}/>
            <Tooltip formatter={(value) => amount(Number(value))} labelFormatter={(label) => dateLabel(String(label))} contentStyle={tooltipStyle}/>
            <Area dataKey="balance" name="Saldo projetado" type="stepAfter" stroke="var(--fin-blue)" fill="var(--fin-blue)" fillOpacity={0.13} strokeWidth={2} isAnimationActive={false}/>
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </> : <p className={styles.empty}>A projeção está disponível na visão do mês atual.</p>}
  </Panel>;
}

function Due({ title, data, href, tone }: Readonly<{
  title: string;
  data: FinanceDashboardData["payable"];
  href: string;
  tone: "positive" | "negative";
}>) {
  return <Panel title={title} note="Próximos 7 dias · posição atual" href={href}>
    <strong className={styles.dueAmount} data-tone={tone}>{amount(data.upcomingCents)}</strong>
    <p className={styles.dueSummary}>{data.openCount} em aberto · {amount(data.openCents)}</p>
    {Number(data.overdueCents) > 0 ? <p className={styles.overdue}>{amount(data.overdueCents)} em atraso</p> : null}
    {data.items.length ? <ul className={styles.dueList}>{data.items.map((item) => <li key={item.id}>
      <span><small>{dateLabel(item.due)}</small> {item.name}</span><strong>{amount(item.cents)}</strong>
    </li>)}</ul> : <p className={styles.empty}>Nenhum vencimento próximo.</p>}
    {data.upcomingCount > data.items.length ? <Link className={styles.more} href={href}>Ver todos os {data.upcomingCount} vencimentos</Link> : null}
  </Panel>;
}

function Balances({ data, href }: Readonly<{ data: FinanceDashboardData; href: string }>) {
  const accounts = [...data.accounts].sort((a, b) => Number(b.balanceCents) - Number(a.balanceCents));
  const max = Math.max(1, ...accounts.map((account) => Math.abs(Number(account.balanceCents))));
  return <Panel title="Saldo por conta" href={href}>
    {accounts.length ? <ul className={styles.accounts}>{accounts.map((account) => <li key={account.id}>
      <div><span>{account.name}</span><strong data-tone={Number(account.balanceCents) < 0 ? "negative" : undefined}>{amount(account.balanceCents)}</strong></div>
      <progress max={max} value={Math.abs(Number(account.balanceCents))} aria-label={account.name}/>
    </li>)}</ul> : <p className={styles.empty}>Nenhuma conta financeira cadastrada.</p>}
    {data.unallocatedCents !== "0" ? <p className={styles.dueSummary}>Caixa sem conta vinculada de {amount(data.unallocatedCents)}</p> : null}
  </Panel>;
}

export function FinanceDashboard({ data, href }: Readonly<{ data: FinanceDashboardData; href: (section: FinanceSection) => string }>) {
  const previous = data.history.at(-2);
  const cashLabel = data.currentMonth ? "Caixa atual" : "Saldo final do mês";
  const hasPriorCash = previous?.resultCents != null;
  return <div className={styles.dashboard}>
    <section aria-label="Indicadores financeiros" className={styles.metrics}>
      <Metric label={cashLabel} value={data.cashCents} icon="receita" href={href("contas")} featured>
        <Comparison value={data.cashCents} previous={hasPriorCash ? data.openingCents : null}/>
      </Metric>
      <Metric label="Entradas do mês" value={data.incomeCents} icon="entrada" href={href("entradas")} tone="positive">
        <Comparison value={data.incomeCents} previous={previous?.incomeCents}/>
      </Metric>
      <Metric label="Saídas líquidas do mês" value={data.expenseCents} icon="auditoria" href={href("despesas")}>
        <Comparison value={data.expenseCents} previous={previous?.expenseCents} inverse/>
      </Metric>
      <Metric label="Resultado do mês" value={data.resultCents} icon="tendencia" href={href("fluxo-caixa")} tone={Number(data.resultCents) < 0 ? "negative" : "positive"}>
        <Comparison value={data.resultCents} previous={previous?.resultCents}/>
      </Metric>
      <Metric label="Vendas fechadas" value={data.salesCents} icon="vendas" href="/dashboard"><small>Valor dos negócios ganhos</small></Metric>
      {data.commission ? <Metric label="Comissões geradas" value={data.commission.generatedCents} icon="equipe" href={href("comissoes")}>
        <small>{amount(data.commission.paidCents)} pagos no mês</small>
      </Metric> : null}
    </section>
    <div className={styles.charts}>
      <History rows={data.history} href={href("fluxo-caixa")} asOf={data.currentMonth ? data.asOf : null}/>
      <Distribution expenses={data.expenses} total={data.grossCents} href={href("despesas")}/>
    </div>
    <div className={styles.operations}>
      <Projection rows={data.projection} href={href("fluxo-caixa")}/>
      <Due title="Contas a pagar" data={data.payable} href={href("pagar-receber")} tone="negative"/>
      <Due title="Contas a receber" data={data.receivable} href={href("pagar-receber")} tone="positive"/>
      <Balances data={data} href={href("contas")}/>
    </div>
  </div>;
}
