"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  useCallback,
  useMemo,
  useState,
  useTransition,
  type FormEvent,
} from "react";

import {
  FilterCheckboxList,
  MultiSelectDialog,
  leadFilterInputClass as inputClass,
  type FilterOption,
} from "@/app/leads/lead-list-filter-controls";
import styles from "@/app/leads/leads-list.module.css";
import { AccessibleDialog } from "@/components/ui/accessible-dialog";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import {
  defaultLeadListColumns,
  leadListColumnKeys,
  type LeadListColumnKey,
  type LeadListQuery,
  type LeadListRow,
  type LeadListScreen,
} from "@/modules/leads/domain/lead-list-contracts";

type Notice = Readonly<{ kind: "success" | "error"; message: string }> | null;
type FilterChip = Readonly<{ id: string; label: string; query: LeadListQuery }>;

const columnLabels: Readonly<Record<LeadListColumnKey, string>> = {
  name: "Nome",
  jobTitle: "Atuação",
  priority: "Prioridade",
  score: "Pontuação",
  reason: "Motivo",
  responsible: "Responsável",
  source: "Origem",
  campaign: "Campanha",
  creative: "Criativo",
  stage: "Etapa",
  status: "Status",
  sla: "SLA",
  age: "Tempo desde entrada",
  lastActivity: "Última atividade",
  nextAction: "Próxima ação",
  location: "Localidade",
  capacity: "Capacidade",
  decisionMaker: "Decisor",
};

const statusLabels: Readonly<Record<string, string>> = {
  OPEN: "Aberto",
  QUALIFIED: "Qualificado",
  DISQUALIFIED: "Desqualificado",
  CONVERTED: "Convertido",
  LOST: "Perdido",
};

const slaLabels: Readonly<Record<string, string>> = {
  HEALTHY: "Saudável · até 60s",
  ATTENTION: "Atenção · 61–180s",
  CRITICAL: "Crítico · acima de 180s",
  WITHOUT_ATTEMPT: "Sem tentativa",
  WITH_ATTEMPT: "Com tentativa",
};

const decisionMakerLabels: Readonly<Record<string, string>> = {
  UNKNOWN: "Não investigado",
  NEGATIVE: "Desfavorável",
  PARTIAL: "Parcial",
  POSITIVE: "Favorável",
};

const capacityLabels: Readonly<Record<string, string>> = {
  UNKNOWN: "Não informada",
  KNOWN: "Informada",
  UP_TO_5000: "Até R$ 5 mil",
  FROM_5000_TO_10000: "R$ 5 mil a R$ 10 mil",
  ABOVE_10000: "Acima de R$ 10 mil",
};

const nextActionLabels: Readonly<Record<string, string>> = {
  OVERDUE: "Vencida",
  TODAY: "Próximas 24 horas",
  FUTURE: "Futura",
  MISSING: "Ausente",
};

const operationalLabels: Readonly<Record<string, string>> = {
  NOW: "Agora",
  NEW: "Novos",
  P1: "P1",
  WAITING_CALL: "Aguardando ligação",
  RESPONDED: "Responderam",
  RETURN_TODAY: "Retorno para hoje",
  OVERDUE: "Atrasados",
  MEETINGS_TODAY: "Reuniões de hoje",
  MISSING_NEXT_ACTION: "Sem próxima ação",
};

const sortLabels: Readonly<Record<LeadListQuery["sort"], string>> = {
  operational: "Regra operacional padrão",
  name: "Nome",
  priority: "Prioridade",
  score: "Pontuação",
  responsible: "Responsável",
  source: "Origem",
  stage: "Etapa",
  sla: "SLA",
  receivedAt: "Entrada",
  lastActivity: "Última atividade",
  nextAction: "Próxima ação",
};

function querySearchParams(query: LeadListQuery): URLSearchParams {
  const params = new URLSearchParams();
  const put = (key: string, value: string | number | null) => {
    if (value !== "" && value !== null) params.set(key, String(value));
  };
  const putList = (key: string, values: readonly string[]) => {
    if (values.length) params.set(key, values.join(","));
  };
  put("q", query.q);
  put("page", query.page);
  put("pageSize", query.pageSize);
  putList("responsibles", query.responsibles);
  putList("teams", query.teams);
  putList("priorities", query.priorities);
  put("scoreMin", query.scoreMin);
  put("scoreMax", query.scoreMax);
  putList("stages", query.stages);
  putList("statuses", query.statuses);
  if (query.sla !== "ALL") put("sla", query.sla);
  putList("sources", query.sources);
  putList("campaigns", query.campaigns);
  putList("creatives", query.creatives);
  put("jobTitle", query.jobTitle);
  put("state", query.state);
  put("city", query.city);
  put("pain", query.pain);
  if (query.capacity !== "ALL") put("capacity", query.capacity);
  if (query.decisionMaker !== "ALL") put("decisionMaker", query.decisionMaker);
  put("enteredFrom", query.enteredFrom);
  put("enteredTo", query.enteredTo);
  put("lastActivityFrom", query.lastActivityFrom);
  put("lastActivityTo", query.lastActivityTo);
  if (query.nextAction !== "ALL") put("nextAction", query.nextAction);
  put("nextActionFrom", query.nextActionFrom);
  put("nextActionTo", query.nextActionTo);
  putList("disqualificationReasons", query.disqualificationReasons);
  putList("lossReasons", query.lossReasons);
  if (query.operationalBucket !== "ALL") put("operationalBucket", query.operationalBucket);
  if (query.sort !== "operational") put("sort", query.sort);
  if (query.direction !== "asc") put("direction", query.direction);
  if (query.columns.join(",") !== defaultLeadListColumns.join(",")) putList("columns", query.columns);
  return params;
}

function clearFilterFields(query: LeadListQuery, keepSearch = false): LeadListQuery {
  return {
    ...query,
    q: keepSearch ? query.q : "",
    page: 1,
    responsibles: [], teams: [], priorities: [], scoreMin: null, scoreMax: null,
    stages: [], statuses: [], sla: "ALL", sources: [], campaigns: [], creatives: [],
    jobTitle: "", state: "", city: "", pain: "", capacity: "ALL", decisionMaker: "ALL",
    enteredFrom: "", enteredTo: "", lastActivityFrom: "", lastActivityTo: "",
    nextAction: "ALL", nextActionFrom: "", nextActionTo: "",
    disqualificationReasons: [], lossReasons: [], operationalBucket: "ALL",
  };
}

function dateInputValue(value: string): string {
  if (!value) return "";
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function dateInputIso(value: string): string {
  return value ? new Date(value).toISOString() : "";
}

function formatDate(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone, dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function formatElapsed(from: string, now: string): string {
  const seconds = Math.max(0, Math.floor((new Date(now).getTime() - new Date(from).getTime()) / 1_000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}min`;
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}

function formatCents(value: string | null): string {
  if (value === null) return "Não informada";
  const cents = BigInt(value);
  const absolute = cents < 0n ? -cents : cents;
  const integer = (absolute / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${cents < 0n ? "-" : ""}R$ ${integer},${(absolute % 100n).toString().padStart(2, "0")}`;
}

function slaLabel(row: LeadListRow): string {
  if (row.slaSeconds === null) return "Sem ciclo de SLA";
  const band = { HEALTHY: "Saudável", ATTENTION: "Atenção", CRITICAL: "Crítico", UNKNOWN: "Indefinido" }[row.slaBand];
  return `${row.slaSeconds}s · ${band}${row.firstHumanAttemptAt ? " · tentativa registrada" : " · sem tentativa"}`;
}

function cellValue(column: LeadListColumnKey, row: LeadListRow, screen: LeadListScreen) {
  switch (column) {
    case "name": return <div className={styles.contactCell}><span aria-hidden="true" className={styles.contactAvatar}>{row.fullName.split(" ").filter(Boolean).slice(0, 2).map((name) => name[0]).join("")}</span><div><Link aria-label={`Abrir cartão do lead ${row.fullName}`} className="font-semibold text-primary underline-offset-4 hover:underline focus:outline-none focus:ring-2 focus:ring-ring" href={`/leads/${row.id}/historico`}>{row.fullName}</Link><p className="mt-1 text-xs text-muted-foreground">{row.normalizedPhone ?? row.normalizedEmail ?? "Sem contato disponível"}</p></div></div>;
    case "jobTitle": return row.jobTitle ?? "Não informado";
    case "priority": return row.priorityCode ? <span className="priority-badge" data-priority={row.priorityCode}>{row.priorityCode}</span> : "Sem faixa";
    case "score": return row.score ?? "—";
    case "reason": return row.priorityReason ?? "Sem pontuação registrada";
    case "responsible": return <span className={styles.ownerCell}><span aria-hidden="true" className={styles.ownerAvatar}>{row.responsibleName.slice(0, 1)}</span><span>{row.responsibleName}<small className="block text-muted-foreground">{row.responsibleType === "QUEUE" ? "Fila" : row.teamName ?? "Pessoa"}</small></span></span>;
    case "source": return <span className={styles.sourceTag}>{row.sourceName}</span>;
    case "campaign": return row.campaignName ?? "Sem campanha";
    case "creative": return row.creativeName ?? "Sem criativo";
    case "stage": return <span className="stage-badge">{row.stageName}</span>;
    case "status": return <span className={styles.status} data-status={row.status}>{statusLabels[row.status] ?? row.status}</span>;
    case "sla": return <span data-sla-band={row.slaBand}>{slaLabel(row)}</span>;
    case "age": return formatElapsed(row.receivedAt, screen.list.generatedAt);
    case "lastActivity": return <span>{row.lastActivitySubject ?? "Sem descrição"}<small className="block text-muted-foreground">{formatDate(row.lastActivityAt, screen.filters.timeZone)}</small></span>;
    case "nextAction": return row.nextActionAt ? <span>{row.nextActionDescription}<small className="block text-muted-foreground">{formatDate(row.nextActionAt, screen.filters.timeZone)}</small></span> : <strong className="text-danger">Sem próxima ação</strong>;
    case "location": return [row.city, row.stateCode].filter(Boolean).join("/") || "Não informada";
    case "capacity": return formatCents(row.budgetCents);
    case "decisionMaker": return decisionMakerLabels[row.decisionMakerStatus ?? "UNKNOWN"] ?? "Não investigado";
  }
}

function filterChips(query: LeadListQuery, screen: LeadListScreen): FilterChip[] {
  const chips: FilterChip[] = [];
  const next = (change: Partial<LeadListQuery>): LeadListQuery => ({ ...query, ...change, page: 1 });
  const addList = (id: string, prefix: string, values: readonly string[], options: readonly FilterOption[], replace: (values: string[]) => LeadListQuery) => {
    values.forEach((value) => chips.push({ id: `${id}:${value}`, label: prefix ? `${prefix}: ${options.find((option) => option.value === value)?.label ?? value}` : options.find((option) => option.value === value)?.label ?? value, query: replace(values.filter((item) => item !== value)) }));
  };
  if (query.q) chips.push({ id: "q", label: `Busca: ${query.q}`, query: next({ q: "" }) });
  addList("responsible", "Responsável", query.responsibles, screen.filters.responsibles, (values) => next({ responsibles: values }));
  addList("team", "Equipe", query.teams, screen.filters.teams.map((item) => ({ value: item.id, label: item.name })), (values) => next({ teams: values }));
  addList("priority", "", query.priorities, screen.filters.priorities.map((item) => ({ value: item.code, label: item.code })), (values) => next({ priorities: values as LeadListQuery["priorities"] }));
  addList("stage", "Etapa", query.stages, screen.filters.stages.map((item) => ({ value: item.id, label: item.name })), (values) => next({ stages: values }));
  addList("status", "Status", query.statuses, Object.entries(statusLabels).map(([value, label]) => ({ value, label })), (values) => next({ statuses: values as LeadListQuery["statuses"] }));
  addList("source", "Origem", query.sources, screen.filters.sources.map((item) => ({ value: item.id, label: item.name })), (values) => next({ sources: values }));
  addList("campaign", "Campanha", query.campaigns, screen.filters.campaigns.map((item) => ({ value: item.id, label: item.name })), (values) => next({ campaigns: values }));
  addList("creative", "Criativo", query.creatives, screen.filters.creatives.map((item) => ({ value: item.id, label: item.name })), (values) => next({ creatives: values }));
  addList("disqualification", "Desqualificação", query.disqualificationReasons, screen.filters.disqualificationReasons.map((item) => ({ value: item.id, label: item.name })), (values) => next({ disqualificationReasons: values }));
  addList("loss", "Perda", query.lossReasons, screen.filters.lossReasons.map((item) => ({ value: item.id, label: item.name })), (values) => next({ lossReasons: values }));
  if (query.sla !== "ALL") chips.push({ id: "sla", label: `SLA: ${slaLabels[query.sla]}`, query: next({ sla: "ALL" }) });
  if (query.scoreMin !== null) chips.push({ id: "score-min", label: `Score mínimo: ${query.scoreMin}`, query: next({ scoreMin: null }) });
  if (query.scoreMax !== null) chips.push({ id: "score-max", label: `Score máximo: ${query.scoreMax}`, query: next({ scoreMax: null }) });
  if (query.jobTitle) chips.push({ id: "job-title", label: `Atuação: ${query.jobTitle}`, query: next({ jobTitle: "" }) });
  if (query.state) chips.push({ id: "state", label: `Estado: ${query.state}`, query: next({ state: "" }) });
  if (query.city) chips.push({ id: "city", label: `Cidade: ${query.city}`, query: next({ city: "" }) });
  if (query.pain) chips.push({ id: "pain", label: `Dor: ${query.pain}`, query: next({ pain: "" }) });
  if (query.capacity !== "ALL") chips.push({ id: "capacity", label: `Capacidade: ${capacityLabels[query.capacity]}`, query: next({ capacity: "ALL" }) });
  if (query.decisionMaker !== "ALL") chips.push({ id: "decision", label: `Decisor: ${decisionMakerLabels[query.decisionMaker]}`, query: next({ decisionMaker: "ALL" }) });
  if (query.nextAction !== "ALL") chips.push({ id: "next-action", label: `Próxima ação: ${nextActionLabels[query.nextAction]}`, query: next({ nextAction: "ALL" }) });
  if (query.operationalBucket !== "ALL") chips.push({ id: "operational", label: `Recorte: ${operationalLabels[query.operationalBucket]}`, query: next({ operationalBucket: "ALL" }) });
  const dateFilters = [
    ["entered-from", "Entrada a partir de", "enteredFrom", query.enteredFrom], ["entered-to", "Entrada até", "enteredTo", query.enteredTo],
    ["last-from", "Última atividade a partir de", "lastActivityFrom", query.lastActivityFrom], ["last-to", "Última atividade até", "lastActivityTo", query.lastActivityTo],
    ["next-from", "Próxima ação a partir de", "nextActionFrom", query.nextActionFrom], ["next-to", "Próxima ação até", "nextActionTo", query.nextActionTo],
  ] as const;
  dateFilters.forEach(([id, label, key, value]) => { if (value) chips.push({ id, label: `${label}: ${formatDate(value, screen.filters.timeZone)}`, query: next({ [key]: "" }) }); });
  return chips;
}

async function readResponse(response: Response) {
  const body = (await response.json().catch(() => ({}))) as { result?: unknown; error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message ?? "Não foi possível concluir a operação.");
  return body.result;
}

export function LeadListWorkspace({ screen }: Readonly<{ screen: LeadListScreen }>) {
  const router = useRouter();
  const pathname = usePathname();
  const [draft, setDraft] = useState<LeadListQuery>(screen.query);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<Notice>(null);
  const [savedViewName, setSavedViewName] = useState("");
  const [selectedViewId, setSelectedViewId] = useState("");
  const [bulkTarget, setBulkTarget] = useState("GENERAL_QUEUE");
  const [bulkReason, setBulkReason] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [saveViewOpen, setSaveViewOpen] = useState(false);
  const [deleteViewOpen, setDeleteViewOpen] = useState(false);
  const [confirmingBulk, setConfirmingBulk] = useState(false);
  const [orderDraft, setOrderDraft] = useState({ sort: screen.query.sort, direction: screen.query.direction, pageSize: screen.query.pageSize });
  const [columnDraft, setColumnDraft] = useState<LeadListColumnKey[]>([...screen.query.columns]);
  const [mutating, setMutating] = useState(false);
  const [navigating, startNavigation] = useTransition();

  const dismissAdvanced = useCallback(() => setAdvancedOpen(false), []);
  const dismissSort = useCallback(() => setSortOpen(false), []);
  const dismissColumns = useCallback(() => setColumnsOpen(false), []);
  const dismissSaveView = useCallback(() => setSaveViewOpen(false), []);
  const dismissDeleteView = useCallback(() => setDeleteViewOpen(false), []);
  const dismissBulk = useCallback(() => setConfirmingBulk(false), []);

  const visibleColumns = useMemo(() => leadListColumnKeys.filter((column) => screen.query.columns.includes(column)), [screen.query.columns]);
  const chips = useMemo(() => filterChips(screen.query, screen), [screen]);
  const allPageSelected = screen.list.rows.length > 0 && screen.list.rows.every((row) => selected.has(row.id));

  const responsibleOptions = screen.filters.responsibles;
  const priorityOptions = screen.filters.priorities.map((item) => ({ value: item.code, label: item.name }));
  const stageOptions = screen.filters.stages.map((item) => ({ value: item.id, label: item.name }));

  function update<K extends keyof LeadListQuery>(key: K, value: LeadListQuery[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function applyFilterChange<K extends keyof LeadListQuery>(key: K, value: LeadListQuery[K]) {
    const next = { ...draft, [key]: value, page: 1 };
    setDraft(next);
    navigate(next);
  }

  function navigate(query: LeadListQuery) {
    setNotice(null);
    startNavigation(() => {
      const params = querySearchParams(query);
      router.push(`${pathname}${params.size ? `?${params}` : ""}`);
    });
  }

  function submitFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    navigate({ ...draft, page: 1 });
  }

  function resetFilters() {
    const cleared = clearFilterFields(screen.query);
    setDraft(cleared);
    navigate(cleared);
  }

  function togglePage(checked: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      screen.list.rows.forEach((row) => checked ? next.add(row.id) : next.delete(row.id));
      return next;
    });
  }

  async function saveView(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMutating(true);
    setNotice(null);
    try {
      const response = await fetch("/api/leads/saved-views", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: savedViewName, query: screen.query }),
      });
      await readResponse(response);
      setSavedViewName("");
      setSaveViewOpen(false);
      setNotice({ kind: "success", message: "Visualização salva para seu usuário." });
      router.refresh();
    } catch (error) {
      setNotice({ kind: "error", message: error instanceof Error ? error.message : "Falha ao salvar." });
    } finally {
      setMutating(false);
    }
  }

  function applySavedView() {
    const view = screen.savedViews.find((item) => item.id === selectedViewId);
    if (view) navigate(view.query);
  }

  async function deleteSavedView() {
    if (!selectedViewId) return;
    setMutating(true);
    setNotice(null);
    try {
      const response = await fetch(`/api/leads/saved-views/${selectedViewId}`, { method: "DELETE" });
      await readResponse(response);
      setSelectedViewId("");
      setDeleteViewOpen(false);
      setNotice({ kind: "success", message: "Visualização removida." });
      router.refresh();
    } catch (error) {
      setNotice({ kind: "error", message: error instanceof Error ? error.message : "Falha ao remover." });
    } finally {
      setMutating(false);
    }
  }

  async function confirmBulkRedistribution() {
    setMutating(true);
    setNotice(null);
    try {
      const target = bulkTarget.startsWith("MEMBER:")
        ? { type: "MEMBER" as const, memberId: bulkTarget.slice(7) }
        : { type: "GENERAL_QUEUE" as const };
      const response = await fetch("/api/leads/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadIds: [...selected], target, reason: bulkReason }),
      });
      const result = (await readResponse(response)) as { changed: number; skipped: number };
      setSelected(new Set());
      setConfirmingBulk(false);
      setBulkReason("");
      setNotice({ kind: "success", message: `${result.changed} lead(s) redistribuído(s); ${result.skipped} sem alteração.` });
      router.refresh();
    } catch (error) {
      setNotice({ kind: "error", message: error instanceof Error ? error.message : "Falha na redistribuição." });
    } finally {
      setMutating(false);
    }
  }

  return (
    <div className={styles.workspace}>
      {(navigating || mutating) && <p aria-live="polite" className={styles.loadingNotice}>Atualizando contatos…</p>}
      {notice && <p className={styles.notice} data-kind={notice.kind} role={notice.kind === "error" ? "alert" : "status"}>{notice.message}</p>}

      <section aria-labelledby="lead-filter-title" className={styles.filterSurface}>
        <div className={styles.filterHeading}>
          <div><h2 id="lead-filter-title"><Icon name="leads" size={16} />Todos os contatos</h2></div>
          <span className={styles.resultCount}>{screen.list.total} resultado(s)</span>
        </div>
        <form onSubmit={submitFilters}>
          <div className={styles.primaryBar}>
            <label className={styles.searchField}>
              <span className="sr-only">Busca</span><svg aria-hidden="true" className={styles.searchIcon} viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" /></svg>
              <input aria-label="Busca" className={inputClass} onChange={(event) => update("q", event.target.value)} placeholder="Pesquisar contatos..." type="search" value={draft.q} />
            </label>
            <MultiSelectDialog label="Prioridade" onApply={(values) => applyFilterChange("priorities", values as LeadListQuery["priorities"])} options={priorityOptions} values={draft.priorities} />
            <MultiSelectDialog label="Etapa" onApply={(values) => applyFilterChange("stages", values)} options={stageOptions} values={draft.stages} />
            <MultiSelectDialog label="Responsável" onApply={(values) => applyFilterChange("responsibles", values)} options={responsibleOptions} values={draft.responsibles} />
            <label className={styles.slaControl}>
              <span className="sr-only">SLA</span>
              <select aria-label="SLA" className={inputClass} onChange={(event) => update("sla", event.target.value as LeadListQuery["sla"])} value={draft.sla}>
                <option value="ALL">SLA: Todos</option>
                {Object.entries(slaLabels).map(([value, label]) => <option key={value} value={value}>SLA: {label}</option>)}
              </select>
            </label>
            <Button disabled={navigating} type="submit">Aplicar</Button>
            <Button aria-expanded={advancedOpen} aria-haspopup="dialog" onClick={() => setAdvancedOpen(true)} type="button" variant="secondary">Mais filtros{chips.length > 0 && <span className={styles.countBadge}>{chips.length}</span>}</Button>
            {chips.length > 0 && <Button disabled={navigating} onClick={resetFilters} type="button" variant="ghost">Limpar tudo</Button>}
          </div>
        </form>

        {chips.length > 0 && (
          <div aria-label="Filtros ativos" className={styles.activeFilters}>
            <span className={styles.activeLabel}>Filtros ativos</span>
            <div className={styles.chipList}>
              {chips.map((chip) => <button aria-label={`Remover filtro ${chip.label}`} className={styles.filterChip} disabled={navigating} key={chip.id} onClick={() => navigate(chip.query)} type="button"><span>{chip.label}</span><span aria-hidden="true">×</span></button>)}
            </div>
            {chips.length > 1 && <button className={styles.clearLink} disabled={navigating} onClick={resetFilters} type="button">Limpar todos</button>}
          </div>
        )}

        <div className={styles.filterFooter}>
          <div className={styles.viewTools}>
            <Button aria-expanded={sortOpen} aria-haspopup="dialog" onClick={() => { setOrderDraft({ sort: screen.query.sort, direction: screen.query.direction, pageSize: screen.query.pageSize }); setSortOpen(true); }} size="sm" type="button" variant="secondary">Ordenar<span className={styles.toolSummary}>{sortLabels[screen.query.sort]}</span></Button>
            <Button aria-expanded={columnsOpen} aria-haspopup="dialog" onClick={() => { setColumnDraft([...screen.query.columns]); setColumnsOpen(true); }} size="sm" type="button" variant="secondary">Colunas <span className={styles.toolSummary}>{visibleColumns.length}</span></Button>
          </div>
          <div className={styles.savedViews}>
            <label><span className="sr-only">Visualização salva</span><select aria-label="Visualização salva" className={inputClass} onChange={(event) => setSelectedViewId(event.target.value)} value={selectedViewId}><option value="">{screen.savedViews.length ? "Visualizações salvas" : "Nenhuma visualização salva"}</option>{screen.savedViews.map((view) => <option key={view.id} value={view.id}>{view.name}</option>)}</select></label>
            <Button disabled={!selectedViewId || navigating} onClick={applySavedView} size="sm" type="button" variant="ghost">Abrir</Button>
            <Button aria-haspopup="dialog" onClick={() => setSaveViewOpen(true)} size="sm" type="button" variant="ghost">Salvar atual</Button>
            {selectedViewId && <Button aria-haspopup="dialog" disabled={mutating} onClick={() => setDeleteViewOpen(true)} size="sm" type="button" variant="ghost">Excluir</Button>}
          </div>
        </div>
      </section>

      <section className={styles.resultSurface}>
        <div className={styles.resultHeader}>
          <div><h2>{screen.list.total} contatos</h2><p>Página {screen.list.page} de {screen.list.totalPages} · {screen.list.visibleTotal} contatos disponíveis</p></div>
          <span>Atualizado em {formatDate(screen.list.generatedAt, screen.filters.timeZone)}</span>
        </div>
        {screen.canBulkAssign && selected.size > 0 && (
          <div aria-label="Ações em massa" className={styles.bulkBar} role="region">
            <strong>{selected.size} selecionado(s)</strong>
            <label><span className="sr-only">Novo responsável</span><select aria-label="Novo responsável" className={inputClass} onChange={(event) => setBulkTarget(event.target.value)} value={bulkTarget}><option value="GENERAL_QUEUE">Fila Geral</option>{screen.filters.assignmentTargets.map((member) => <option key={member.id} value={`MEMBER:${member.id}`}>{member.name}</option>)}</select></label>
            <label className={styles.bulkReason}><span className="sr-only">Motivo obrigatório</span><input aria-label="Motivo obrigatório" className={inputClass} maxLength={500} minLength={3} onChange={(event) => setBulkReason(event.target.value)} placeholder="Motivo obrigatório" value={bulkReason} /></label>
            <Button disabled={bulkReason.trim().length < 3} onClick={() => setConfirmingBulk(true)} size="sm" type="button">Revisar redistribuição</Button>
          </div>
        )}
        {screen.list.visibleTotal === 0 ? (
          <div className={styles.emptyState}><h3>Nenhum lead disponível</h3><p>Os contatos da sua equipe aparecerão aqui.</p><Button asChild><Link href="/leads/entrada">Cadastrar primeiro lead</Link></Button></div>
        ) : screen.list.total === 0 ? (
          <div className={styles.emptyState}><h3>Nenhum resultado</h3><p>Nenhum lead corresponde à combinação de filtros.</p><Button onClick={resetFilters} type="button" variant="secondary">Limpar filtros</Button></div>
        ) : (
          <div className={styles.tableViewport}>
            <table className={styles.leadTable}>
              <caption className="sr-only">Lista de contatos</caption>
              <thead><tr><th className={styles.selectColumn}><input aria-label="Selecionar todos os leads desta página" checked={allPageSelected} onChange={(event) => togglePage(event.target.checked)} type="checkbox" /></th>{visibleColumns.map((column) => <th key={column}>{columnLabels[column]}</th>)}</tr></thead>
              <tbody>{screen.list.rows.map((row) => <tr data-selected={selected.has(row.id)} key={row.id}><td><input aria-label={`Selecionar ${row.fullName}`} checked={selected.has(row.id)} onChange={(event) => setSelected((current) => { const next = new Set(current); if (event.target.checked) next.add(row.id); else next.delete(row.id); return next; })} type="checkbox" /></td>{visibleColumns.map((column) => <td key={column}>{cellValue(column, row, screen)}</td>)}</tr>)}</tbody>
            </table>
          </div>
        )}
        {screen.list.total > 0 && <nav aria-label="Paginação da lista de leads" className={styles.pagination}><Button disabled={screen.list.page <= 1 || navigating} onClick={() => navigate({ ...screen.query, page: screen.list.page - 1 })} size="sm" type="button" variant="secondary">Anterior</Button><span>Página {screen.list.page} de {screen.list.totalPages}</span><Button disabled={screen.list.page >= screen.list.totalPages || navigating} onClick={() => navigate({ ...screen.query, page: screen.list.page + 1 })} size="sm" type="button" variant="secondary">Próxima</Button></nav>}
      </section>

      {advancedOpen && <AdvancedFiltersDialog draft={draft} onApply={() => { navigate({ ...draft, page: 1 }); setAdvancedOpen(false); }} onChange={setDraft} onDismiss={dismissAdvanced} screen={screen} />}

      {sortOpen && (
        <AccessibleDialog className={styles.compactDialog!} labelledBy="sort-dialog-title" onDismiss={dismissSort}>
          <DialogHeader description="Essas opções não alteram os filtros ativos." onDismiss={dismissSort} title="Ordenar resultados" titleId="sort-dialog-title" />
          <div className={styles.dialogFields}>
            <label className={styles.fieldLabel}>Ordenar por<select className={inputClass} onChange={(event) => setOrderDraft((current) => ({ ...current, sort: event.target.value as LeadListQuery["sort"] }))} value={orderDraft.sort}>{Object.entries(sortLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label className={styles.fieldLabel}>Direção<select className={inputClass} disabled={orderDraft.sort === "operational"} onChange={(event) => setOrderDraft((current) => ({ ...current, direction: event.target.value as "asc" | "desc" }))} value={orderDraft.direction}><option value="asc">Crescente</option><option value="desc">Decrescente</option></select></label>
            <label className={styles.fieldLabel}>Resultados por página<select className={inputClass} onChange={(event) => setOrderDraft((current) => ({ ...current, pageSize: Number(event.target.value) }))} value={orderDraft.pageSize}><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option></select></label>
          </div>
          <div className={styles.dialogActions}><Button onClick={dismissSort} type="button" variant="secondary">Cancelar</Button><Button onClick={() => { navigate({ ...screen.query, ...orderDraft, page: 1 }); setSortOpen(false); }} type="button">Aplicar ordenação</Button></div>
        </AccessibleDialog>
      )}

      {columnsOpen && (
        <AccessibleDialog className={styles.compactDialog!} labelledBy="columns-dialog-title" onDismiss={dismissColumns}>
          <DialogHeader description="O nome permanece visível para manter o contexto da linha." onDismiss={dismissColumns} title="Colunas exibidas" titleId="columns-dialog-title" />
          <fieldset className={styles.columnGrid}><legend className="sr-only">Escolha as colunas exibidas</legend>{leadListColumnKeys.map((column) => <label className={styles.checkboxOption} key={column}><input checked={columnDraft.includes(column)} disabled={column === "name"} onChange={(event) => setColumnDraft((current) => event.target.checked ? [...current, column] : current.filter((item) => item !== column))} type="checkbox" /><span>{columnLabels[column]}</span></label>)}</fieldset>
          <div className={styles.dialogActions}><Button onClick={dismissColumns} type="button" variant="secondary">Cancelar</Button><Button onClick={() => { navigate({ ...screen.query, columns: columnDraft, page: 1 }); setColumnsOpen(false); }} type="button">Aplicar colunas</Button></div>
        </AccessibleDialog>
      )}

      {saveViewOpen && (
        <AccessibleDialog busy={mutating} className={styles.compactDialog!} labelledBy="save-view-title" onDismiss={dismissSaveView}>
          <DialogHeader description="Inclui filtros, ordenação, tamanho da página e colunas atuais." disabled={mutating} onDismiss={dismissSaveView} title="Salvar visualização atual" titleId="save-view-title" />
          <form onSubmit={saveView}><label className={styles.fieldLabel}>Nome da nova visualização<input autoComplete="off" className={inputClass} maxLength={80} minLength={2} onChange={(event) => setSavedViewName(event.target.value)} required value={savedViewName} /></label><div className={styles.dialogActions}><Button disabled={mutating} onClick={dismissSaveView} type="button" variant="secondary">Cancelar</Button><Button disabled={mutating} type="submit">Salvar visualização</Button></div></form>
        </AccessibleDialog>
      )}

      {deleteViewOpen && (
        <AccessibleDialog busy={mutating} className={styles.compactDialog!} describedBy="delete-view-description" labelledBy="delete-view-title" onDismiss={dismissDeleteView}>
          <DialogHeader description="A visualização será inativada para seu usuário. Os leads e filtros atuais não serão alterados." descriptionId="delete-view-description" disabled={mutating} onDismiss={dismissDeleteView} title="Excluir visualização?" titleId="delete-view-title" />
          <div className={styles.dialogActions}><Button disabled={mutating} onClick={dismissDeleteView} type="button" variant="secondary">Cancelar</Button><Button disabled={mutating} onClick={deleteSavedView} type="button" variant="destructive">Confirmar exclusão</Button></div>
        </AccessibleDialog>
      )}

      {confirmingBulk && (
        <AccessibleDialog busy={mutating} className={styles.compactDialog!} describedBy="bulk-dialog-description" labelledBy="bulk-dialog-title" onDismiss={dismissBulk}>
          <DialogHeader description={`Confirme a redistribuição de ${selected.size} lead(s). Cada alteração criará evento e auditoria; itens que já estiverem no destino serão informados como sem alteração.`} descriptionId="bulk-dialog-description" disabled={mutating} onDismiss={dismissBulk} title="Confirmar redistribuição em massa" titleId="bulk-dialog-title" />
          <div className={styles.dialogActions}><Button disabled={mutating} onClick={dismissBulk} type="button" variant="secondary">Cancelar</Button><Button disabled={mutating} onClick={confirmBulkRedistribution} type="button">Confirmar redistribuição</Button></div>
        </AccessibleDialog>
      )}
    </div>
  );
}

function DialogHeader({ title, titleId, description, descriptionId, onDismiss, disabled = false }: Readonly<{ title: string; titleId: string; description: string; descriptionId?: string; onDismiss: () => void; disabled?: boolean }>) {
  return <div className={styles.dialogHeader}><div><h2 id={titleId}>{title}</h2><p id={descriptionId}>{description}</p></div><button aria-label={`Fechar ${title.toLocaleLowerCase("pt-BR")}`} className={styles.closeButton} disabled={disabled} onClick={onDismiss} type="button">×</button></div>;
}

function AdvancedFiltersDialog({
  draft,
  screen,
  onChange,
  onApply,
  onDismiss,
}: Readonly<{
  draft: LeadListQuery;
  screen: LeadListScreen;
  onChange: (query: LeadListQuery) => void;
  onApply: () => void;
  onDismiss: () => void;
}>) {
  const update = <K extends keyof LeadListQuery>(key: K, value: LeadListQuery[K]) => onChange({ ...draft, [key]: value });
  const responsibleOptions = screen.filters.responsibles;
  const teamOptions = screen.filters.teams.map((item) => ({ value: item.id, label: item.name }));
  const priorityOptions = screen.filters.priorities.map((item) => ({ value: item.code, label: item.name }));
  const stageOptions = screen.filters.stages.map((item) => ({ value: item.id, label: item.name }));
  const statusOptions = Object.entries(statusLabels).map(([value, label]) => ({ value, label }));
  const sourceOptions = screen.filters.sources.map((item) => ({ value: item.id, label: item.name }));
  const campaignOptions = screen.filters.campaigns.map((item) => ({ value: item.id, label: item.name }));
  const creativeOptions = screen.filters.creatives.map((item) => ({ value: item.id, label: item.name }));
  const lossOptions = screen.filters.lossReasons.map((item) => ({ value: item.id, label: item.name }));
  const disqualificationOptions = screen.filters.disqualificationReasons.map((item) => ({ value: item.id, label: item.name }));

  return (
    <AccessibleDialog className={styles.advancedDrawer!} labelledBy="advanced-filter-title" onDismiss={onDismiss}>
      <div className={styles.dialogHeader}>
        <div><p className={styles.dialogEyebrow}>Filtros avançados</p><h2 id="advanced-filter-title">Refine sua lista</h2><p>Os critérios continuam combináveis e serão aplicados no servidor.</p></div>
        <button aria-label="Fechar filtros avançados" className={styles.closeButton} onClick={onDismiss} type="button">×</button>
      </div>
      <div className={styles.advancedGroups}>
        <section className={styles.filterGroup}>
          <GroupHeading description="Quem atende e em qual equipe." index="01" title="Responsabilidade" />
          <FilterCheckboxList label="Responsável" onChange={(values) => update("responsibles", values)} options={responsibleOptions} values={draft.responsibles} />
          <FilterCheckboxList label="Equipe" onChange={(values) => update("teams", values)} options={teamOptions} values={draft.teams} />
        </section>

        <section className={styles.filterGroup}>
          <GroupHeading description="Prioridade, estágio e situação operacional." index="02" title="Funil" />
          <FilterCheckboxList label="Prioridade" onChange={(values) => update("priorities", values as LeadListQuery["priorities"])} options={priorityOptions} values={draft.priorities} />
          <FilterCheckboxList label="Etapa" onChange={(values) => update("stages", values)} options={stageOptions} values={draft.stages} />
          <FilterCheckboxList label="Status" onChange={(values) => update("statuses", values as LeadListQuery["statuses"])} options={statusOptions} values={draft.statuses} />
          <div className={styles.twoFields}>
            <label className={styles.fieldLabel}>SLA<select className={inputClass} onChange={(event) => update("sla", event.target.value as LeadListQuery["sla"])} value={draft.sla}><option value="ALL">Todos</option>{Object.entries(slaLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label className={styles.fieldLabel}>Recorte operacional<select className={inputClass} onChange={(event) => update("operationalBucket", event.target.value as LeadListQuery["operationalBucket"])} value={draft.operationalBucket}><option value="ALL">Todos</option>{Object.entries(operationalLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          </div>
        </section>

        <section className={styles.filterGroup}>
          <GroupHeading description="De onde veio a oportunidade." index="03" title="Aquisição" />
          <FilterCheckboxList label="Origem" onChange={(values) => update("sources", values)} options={sourceOptions} values={draft.sources} />
          <FilterCheckboxList label="Campanha" onChange={(values) => update("campaigns", values)} options={campaignOptions} values={draft.campaigns} />
          <FilterCheckboxList label="Criativo" onChange={(values) => update("creatives", values)} options={creativeOptions} values={draft.creatives} />
        </section>

        <section className={styles.filterGroup}>
          <GroupHeading description="Contexto e características do lead." index="04" title="Perfil" />
          <div className={styles.twoFields}>
            <label className={styles.fieldLabel}>Cargo ou atuação<select className={inputClass} onChange={(event) => update("jobTitle", event.target.value)} value={draft.jobTitle}><option value="">Todos</option>{screen.filters.jobTitles.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
            <label className={styles.fieldLabel}>Estado<select className={inputClass} onChange={(event) => update("state", event.target.value)} value={draft.state}><option value="">Todos</option>{screen.filters.states.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
            <label className={styles.fieldLabel}>Cidade<select className={inputClass} onChange={(event) => update("city", event.target.value)} value={draft.city}><option value="">Todas</option>{screen.filters.cities.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
            <label className={styles.fieldLabel}>Dor ou interesse<input className={inputClass} onChange={(event) => update("pain", event.target.value)} value={draft.pain} /></label>
            <label className={styles.fieldLabel}>Capacidade<select className={inputClass} onChange={(event) => update("capacity", event.target.value as LeadListQuery["capacity"])} value={draft.capacity}><option value="ALL">Todas</option>{Object.entries(capacityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label className={styles.fieldLabel}>Decisor<select className={inputClass} onChange={(event) => update("decisionMaker", event.target.value as LeadListQuery["decisionMaker"])} value={draft.decisionMaker}><option value="ALL">Todos</option>{Object.entries(decisionMakerLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          </div>
        </section>

        <section className={styles.filterGroup}>
          <GroupHeading description="Entrada, movimento e compromisso futuro." index="05" title="Atividade" />
          <label className={styles.fieldLabel}>Próxima ação<select className={inputClass} onChange={(event) => update("nextAction", event.target.value as LeadListQuery["nextAction"])} value={draft.nextAction}><option value="ALL">Todas</option>{Object.entries(nextActionLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <div className={styles.twoFields}>
            <label className={styles.fieldLabel}>Entrada a partir de<input className={inputClass} onChange={(event) => update("enteredFrom", dateInputIso(event.target.value))} type="datetime-local" value={dateInputValue(draft.enteredFrom)} /></label>
            <label className={styles.fieldLabel}>Entrada até<input className={inputClass} onChange={(event) => update("enteredTo", dateInputIso(event.target.value))} type="datetime-local" value={dateInputValue(draft.enteredTo)} /></label>
            <label className={styles.fieldLabel}>Última atividade a partir de<input className={inputClass} onChange={(event) => update("lastActivityFrom", dateInputIso(event.target.value))} type="datetime-local" value={dateInputValue(draft.lastActivityFrom)} /></label>
            <label className={styles.fieldLabel}>Última atividade até<input className={inputClass} onChange={(event) => update("lastActivityTo", dateInputIso(event.target.value))} type="datetime-local" value={dateInputValue(draft.lastActivityTo)} /></label>
            <label className={styles.fieldLabel}>Próxima ação a partir de<input className={inputClass} onChange={(event) => update("nextActionFrom", dateInputIso(event.target.value))} type="datetime-local" value={dateInputValue(draft.nextActionFrom)} /></label>
            <label className={styles.fieldLabel}>Próxima ação até<input className={inputClass} onChange={(event) => update("nextActionTo", dateInputIso(event.target.value))} type="datetime-local" value={dateInputValue(draft.nextActionTo)} /></label>
          </div>
        </section>

        <section className={styles.filterGroup}>
          <GroupHeading description="Motivos registrados no histórico comercial." index="06" title="Encerramento" />
          <FilterCheckboxList label="Motivo de perda" onChange={(values) => update("lossReasons", values)} options={lossOptions} values={draft.lossReasons} />
          <FilterCheckboxList label="Motivo de desqualificação" onChange={(values) => update("disqualificationReasons", values)} options={disqualificationOptions} values={draft.disqualificationReasons} />
        </section>

        <section className={styles.filterGroup}>
          <GroupHeading description="Faixa do score vigente, entre 0 e 100." index="07" title="Pontuação" />
          <div className={styles.twoFields}>
            <label className={styles.fieldLabel}>Pontuação mínima<input className={inputClass} max={100} min={0} onChange={(event) => update("scoreMin", event.target.value === "" ? null : Number(event.target.value))} type="number" value={draft.scoreMin ?? ""} /></label>
            <label className={styles.fieldLabel}>Pontuação máxima<input className={inputClass} max={100} min={0} onChange={(event) => update("scoreMax", event.target.value === "" ? null : Number(event.target.value))} type="number" value={draft.scoreMax ?? ""} /></label>
          </div>
        </section>
      </div>
      <div className={styles.drawerActions}>
        <Button onClick={() => onChange(clearFilterFields(draft, true))} type="button" variant="ghost">Limpar filtros do painel</Button>
        <div><Button onClick={onDismiss} type="button" variant="secondary">Cancelar</Button><Button onClick={onApply} type="button">Aplicar filtros</Button></div>
      </div>
    </AccessibleDialog>
  );
}

function GroupHeading({ index, title, description }: Readonly<{ index: string; title: string; description: string }>) {
  return <div className={styles.groupHeading}><span aria-hidden="true">{index}</span><div><h3>{title}</h3><p>{description}</p></div></div>;
}
