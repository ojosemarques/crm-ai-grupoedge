import type { JourneySnapshot } from "@/modules/lifecycle/domain/lifecycle-contracts";

const stageLabels: Readonly<Record<string, string>> = {
  UNKNOWN: "Não definido", PROSPECT: "Prospect", LEAD: "Lead", QUALIFIED: "Qualificado", OPPORTUNITY: "Oportunidade", CUSTOMER: "Cliente", ONBOARDING: "Implantação", ACTIVE: "Ativo", RENEWAL: "Renovação", CHURN: "Churn", INACTIVE: "Inativo",
};
const functionLabels: Readonly<Record<string, string>> = { MARKETING: "Marketing", SDR: "SDR", CLOSER: "Closer", CUSTOMER_SUCCESS: "Customer Success", FARMER: "Farmer", FINANCE: "Financeiro", REVOPS: "RevOps" };

export function JourneyPanel({ journey }: Readonly<{ journey: JourneySnapshot | null }>) {
  if (!journey) return <section className="surface-panel p-5"><h2 className="text-lg font-semibold">Jornada de receita</h2><p className="mt-2 text-sm text-muted-foreground">Identidade canônica ainda indisponível para projetar a jornada.</p></section>;
  return <section className="surface-panel p-5" aria-labelledby="revenue-journey-title">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-semibold" id="revenue-journey-title">Jornada de receita</h2><p className="mt-1 text-sm text-muted-foreground">Ciclo de vida e responsáveis funcionais, sem substituir etapa ou status operacional.</p></div><span className="stage-badge">{stageLabels[journey.lifecycle?.stage ?? "UNKNOWN"]}</span></div>
    {journey.missingRequiredOwner ? <p className="mt-4 rounded-[var(--radius-control)] border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950" role="alert">Responsabilidade obrigatória ausente: {functionLabels[journey.missingRequiredOwner] ?? journey.missingRequiredOwner}.</p> : null}
    <div className="mt-4 flex flex-wrap gap-2">{journey.ownership.length ? journey.ownership.map((owner) => <span className="rounded-full bg-secondary px-3 py-1.5 text-xs font-medium" key={owner.id}>{functionLabels[owner.function] ?? owner.function}: {owner.destinationName}</span>) : <span className="text-sm text-muted-foreground">Nenhum responsável funcional vigente.</span>}</div>
    <details className="mt-4"><summary className="cursor-pointer text-sm font-semibold text-primary">Ver governança e transferências</summary><dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2"><div><dt className="text-muted-foreground">Regra</dt><dd>{journey.lifecycle ? `${journey.lifecycle.ruleKey} · v${journey.lifecycle.ruleVersion}` : "Sem projeção"}</dd></div><div><dt className="text-muted-foreground">Origem</dt><dd>{journey.lifecycle?.source ?? "Não informada"}</dd></div></dl>{journey.pendingTransfers.length ? <ul className="mt-3 space-y-2">{journey.pendingTransfers.map((transfer) => <li className="rounded-[var(--radius-control)] bg-[var(--surface-subtle)] p-3 text-sm" key={transfer.id}><strong>{functionLabels[transfer.fromFunction] ?? transfer.fromFunction} → {functionLabels[transfer.toFunction] ?? transfer.toFunction}</strong><span className="block text-muted-foreground">{transfer.destinationName} · {transfer.reason}</span></li>)}</ul> : <p className="mt-3 text-sm text-muted-foreground">Nenhuma transferência pendente.</p>}</details>
  </section>;
}
