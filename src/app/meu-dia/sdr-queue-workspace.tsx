"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";

import styles from "@/app/meu-dia/meu-dia.module.css";
import { Button } from "@/components/ui/button";
import { Icon, type IconName } from "@/components/ui/icon";
import { AccountPlanCommitments } from "@/components/opportunities/account-plan-commitments";
import {
  getSlaBand,
  sdrQueueBuckets,
  type SdrQueueBucket,
  type SdrQueueItem,
  type SdrQueueScreen,
  type SdrQueueSection,
} from "@/modules/leads/domain/sdr-queue-contracts";

const AUTO_REFRESH_SECONDS = 30;

const summaryBuckets: readonly Readonly<{
  key: SdrQueueBucket;
  label: string;
  icon: IconName;
}>[] = [
  { key: "NEW", label: "Novos", icon: "leads" },
  { key: "RESPONDED", label: "Responderam", icon: "inbox" },
  { key: "OVERDUE", label: "Atrasados", icon: "relogio" },
  { key: "MEETINGS_TODAY", label: "Reuniões hoje", icon: "agenda" },
  { key: "MISSING_NEXT_ACTION", label: "Sem próxima ação", icon: "alerta" },
];

function formatDate(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone,
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatTime(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function elapsedSeconds(from: string, nowMs: number): number {
  return Math.max(0, Math.floor((nowMs - new Date(from).getTime()) / 1_000));
}

function elapsedLabel(from: string, nowMs: number): string {
  const seconds = elapsedSeconds(from, nowMs);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function slaState(item: SdrQueueItem, screen: SdrQueueScreen, nowMs: number) {
  if (
    item.slaSeconds === null ||
    item.healthyMaxSeconds === null ||
    item.attentionMaxSeconds === null
  ) {
    return {
      seconds: null,
      band: "UNKNOWN" as const,
      label: "SLA sem ciclo persistido",
    };
  }

  const seconds = item.firstHumanAttemptAt
    ? item.slaSeconds
    : item.slaSeconds +
      Math.max(
        0,
        Math.floor(
          (nowMs - new Date(screen.generatedAt).getTime()) / 1_000,
        ),
      );
  const band = getSlaBand(
    seconds,
    item.healthyMaxSeconds,
    item.attentionMaxSeconds,
  );
  const bandLabel = {
    HEALTHY: "Saudável",
    ATTENTION: "Atenção",
    CRITICAL: "Crítico",
  }[band];

  return {
    seconds,
    band,
    label: `${seconds}s · ${bandLabel}${item.firstHumanAttemptAt ? " · tentativa registrada" : " · sem tentativa"}`,
  };
}

function afterActionLabel(item: SdrQueueItem): string {
  if (item.recommendation.code === "CREATE_NEXT_ACTION") {
    return "Depois: defina o prazo e confirme quem executará a ação.";
  }
  if (item.recommendation.code === "OPEN_MEETING") {
    return "Depois: registre o resultado da reunião e a próxima ação combinada.";
  }
  return "Depois: registre o resultado e confirme a próxima ação no Lead 360.";
}

function PriorityScore({ item }: Readonly<{ item: SdrQueueItem }>) {
  return (
    <div className={styles.scoreLine}>
      <span
        className={styles.priority}
        data-priority={item.priorityCode ?? undefined}
      >
        {item.priorityCode ?? "Sem prioridade"}
      </span>
      <span className={styles.score}>
        {item.score === null ? "Sem pontuação" : `${item.score}/100`}
      </span>
    </div>
  );
}

function FocusLead({
  item,
  nowMs,
  screen,
}: Readonly<{
  item: SdrQueueItem | undefined;
  nowMs: number;
  screen: SdrQueueScreen;
}>) {
  if (!item) {
    return (
      <section aria-labelledby="focus-title" className={styles.focusCard}>
        <p className={styles.focusLabel}>Atenda agora</p>
        <div className={styles.emptyFocus}>
          <h2 id="focus-title">Nenhum atendimento imediato</h2>
          <p>
            A fila “Agora” está vazia no escopo selecionado. Revise as demais
            filas abaixo.
          </p>
        </div>
      </section>
    );
  }

  const sla = slaState(item, screen, nowMs);

  return (
    <section
      aria-labelledby="focus-title"
      className={styles.focusCard}
      data-focus-lead-id={item.id}
      data-operational-recommendation={item.recommendation.code}
    >
      <header className={styles.focusHeader}>
        <p className={styles.focusLabel}>Atenda agora</p>
        <span
          className={styles.priority}
          data-priority={item.priorityCode ?? undefined}
        >
          {item.priorityCode ?? "Sem prioridade"}
        </span>
      </header>

      <div className={styles.focusBody}>
        <div className={styles.focusIdentity}>
          <h2 id="focus-title">
            <span aria-hidden="true" className={styles.leadAvatar}>{item.fullName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("")}</span>
            <Link href={`/leads/${item.id}/historico`}>{item.fullName}</Link>
          </h2>
          <p className={styles.focusMeta}>
            {item.jobTitle ?? "Atuação não informada"} · {item.stageName} · {" "}
            {item.responsibleName}
          </p>
          <p className={styles.focusPain}>
            <strong>Dor:</strong> {item.pain ?? "Não informada"}
          </p>
        </div>

        <div className={styles.focusMetrics}>
          <div className={styles.focusMetric}>
            <span>SLA em tempo real</span>
            <strong data-sla-band={sla.band}>{sla.label}</strong>
          </div>
          <div className={styles.focusMetric}>
            <span>Desde a entrada</span>
            <strong>há {elapsedLabel(item.receivedAt, nowMs)}</strong>
          </div>
          <div className={styles.focusMetric}>
            <span>Pontuação vigente</span>
            <strong>
              {item.score === null ? "Não calculada" : `${item.score}/100`}
            </strong>
          </div>
        </div>

        <div className={styles.focusActions}>
          <p className={styles.focusMeta}>
            <strong>Próxima ação:</strong> {" "}
            {item.nextActionAt
              ? `${item.nextActionDescription ?? "Ação sem descrição"} · ${formatDate(item.nextActionAt, screen.timeZone)}`
              : "ausente — erro operacional"}
          </p>
          <Button asChild className={styles.focusPrimary}>
            <Link href={item.recommendation.href}>
              {item.recommendation.label}
            </Link>
          </Button>
          <Link
            aria-label={`Abrir Lead 360 de ${item.fullName}`}
            className={styles.focusSecondary}
            href={`/leads/${item.id}/historico`}
          >
            Abrir Lead 360
          </Link>
          <p className={styles.afterAction}>{afterActionLabel(item)}</p>
        </div>

        <p className={styles.focusReason}>
          <strong>Por que está no topo:</strong> {item.recommendation.reason} {" "}
          {item.priorityReason ?? "Motivo de prioridade não registrado."}
        </p>
      </div>
    </section>
  );
}

function QueueRow({
  item,
  nowMs,
  screen,
}: Readonly<{
  item: SdrQueueItem;
  nowMs: number;
  screen: SdrQueueScreen;
}>) {
  const sla = slaState(item, screen, nowMs);

  return (
    <article
      className={styles.queueRow}
      data-lead-id={item.id}
      data-operational-recommendation={item.recommendation.code}
    >
      <div>
        <Link
          aria-label={`Abrir lead ${item.fullName}`}
          className={styles.identityLink}
          href={`/leads/${item.id}/historico`}
        >
          <span aria-hidden="true" className={styles.rowAvatar}>{item.fullName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("")}</span>{item.fullName}
        </Link>
        <p className={styles.rowMeta}>
          {item.jobTitle ?? "Atuação não informada"} · {item.stageName}
        </p>
        <p className={styles.rowPain}>
          {item.pain ? `Dor: ${item.pain}` : "Dor não informada"}
        </p>
      </div>

      <div>
        <PriorityScore item={item} />
        <p className={styles.rowReason}>
          {item.priorityReason ?? "Motivo não registrado"}
        </p>
      </div>

      <div>
        <span className={styles.slaBadge} data-sla-band={sla.band}>
          {sla.label}
        </span>
        <p
          className={`${styles.nextAction} ${item.nextActionAt ? "" : styles.missingAction}`}
        >
          {item.nextActionAt
            ? `${item.nextActionDescription ?? "Próxima ação"} · ${formatDate(item.nextActionAt, screen.timeZone)}`
            : "Sem próxima ação"}
        </p>
      </div>

      <div className={styles.rowAction}>
        <Button asChild className="w-full" size="sm">
          <Link href={item.recommendation.href}>
            {item.recommendation.label}
          </Link>
        </Button>
        <p className={styles.rowActionMeta}>
          Entrada há {elapsedLabel(item.receivedAt, nowMs)}
        </p>
      </div>

      <details className={styles.rowDisclosure}>
        <summary>Ver contexto operacional</summary>
        <p>
          {item.recommendation.reason} Responsável: {item.responsibleName}
          {item.responsibleType === "QUEUE" ? " (fila)" : ""}. Última
          atividade: {item.lastActivitySubject ?? "Entrada registrada"} em {" "}
          {formatDate(item.lastActivityAt, screen.timeZone)}.
        </p>
      </details>
    </article>
  );
}

function QueuePanel({
  focusLeadId,
  nowMs,
  screen,
  section,
}: Readonly<{
  focusLeadId: string | undefined;
  nowMs: number;
  screen: SdrQueueScreen;
  section: SdrQueueSection;
}>) {
  const headingId = `queue-panel-${section.key.toLowerCase()}`;
  const visibleItems = section.items.filter((item) => item.id !== focusLeadId);

  return (
    <div
      aria-labelledby={`queue-tab-${section.key}`}
      className={styles.queueContent}
      id={`queue-tabpanel-${section.key}`}
      role="tabpanel"
      tabIndex={0}
    >
      <header className={styles.queueHeader}>
        <div>
          <h2 id={headingId} tabIndex={-1}>
            {section.title}
          </h2>
          <p>{section.description}</p>
        </div>
        <Link
          aria-label={`Abrir lista de ${section.title}: ${section.total} leads`}
          className={styles.drilldown}
          href={section.drilldownHref}
        >
          Ver lista completa · {section.total}
        </Link>
      </header>

      {visibleItems.length === 0 ? (
        <div className={styles.emptyQueue}>
          {section.total > 0 && focusLeadId
            ? "O único lead deste recorte já está em destaque em “Atenda agora”."
            : "Nenhum lead nesta fila com o escopo atual."}
        </div>
      ) : (
        <div className={styles.queueList}>
          {visibleItems.map((item) => (
            <QueueRow
              item={item}
              key={item.id}
              nowMs={nowMs}
              screen={screen}
            />
          ))}
        </div>
      )}

      {section.total > section.items.length ? (
        <p className={styles.resultNote}>
          Exibindo {section.items.length} de {section.total}. Abra a lista
          completa para ver todo o recorte.
        </p>
      ) : null}
    </div>
  );
}

type SideGroup = Readonly<{
  key: SdrQueueBucket;
  title: string;
  total: number;
  tone?: "danger" | "warning";
  totalLabel?: string;
  items: readonly SdrQueueItem[];
}>;

function SidePanel({
  groups,
  onOpenQueue,
}: Readonly<{
  groups: readonly SideGroup[];
  onOpenQueue: (key: SdrQueueBucket) => void;
}>) {
  return (
    <aside aria-label="Riscos e compromissos de hoje" className={styles.sidePanel}>
      {groups.map((group) => (
        <section
          className={styles.sideCard}
          data-tone={group.tone}
          key={group.title}
        >
          <header className={styles.sideCardHeader}>
            <h2>{group.title}</h2>
            <span className={styles.sideCount}>
              {group.totalLabel ?? group.total}
            </span>
          </header>
          {group.items.length === 0 ? (
            <p className={styles.sideEmpty}>Nenhum item neste recorte.</p>
          ) : (
            <ul className={styles.sideList}>
              {group.items.map((item) => (
                <li className={styles.sideItem} key={item.id}>
                  <Link href={`/leads/${item.id}/historico`}>
                    {item.fullName}
                  </Link>
                  <p>
                    {item.nextActionDescription ?? item.recommendation.label}
                  </p>
                </li>
              ))}
            </ul>
          )}
          <button
            className={styles.sideOpenButton}
            onClick={() => onOpenQueue(group.key)}
            type="button"
          >
            Abrir fila
          </button>
        </section>
      ))}
    </aside>
  );
}

function isQueueBucket(value: string | null): value is SdrQueueBucket {
  return sdrQueueBuckets.some((bucket) => bucket === value);
}

export function SdrQueueWorkspace({ screen }: Readonly<{ screen: SdrQueueScreen }>) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [nowMs, setNowMs] = useState(() => new Date(screen.generatedAt).getTime());
  const [isRefreshing, startRefresh] = useTransition();

  const requestedQueue = searchParams.get("queue");
  const activeQueue: SdrQueueBucket = isQueueBucket(requestedQueue)
    ? requestedQueue
    : "NOW";
  const activeSection =
    screen.sections.find((section) => section.key === activeQueue) ??
    screen.sections[0]!;
  const focusLead = screen.sections.find((section) => section.key === "NOW")
    ?.items[0];

  useEffect(() => {
    const clockId = window.setInterval(() => setNowMs(Date.now()), 1_000);
    const refreshId = window.setInterval(() => {
      startRefresh(() => router.refresh());
    }, AUTO_REFRESH_SECONDS * 1_000);
    return () => {
      window.clearInterval(clockId);
      window.clearInterval(refreshId);
    };
  }, [router]);

  const sectionsByKey = useMemo(
    () => new Map(screen.sections.map((section) => [section.key, section])),
    [screen.sections],
  );

  const sideGroups = useMemo(() => {
    const usedLeadIds = new Set<string>(focusLead ? [focusLead.id] : []);
    const takeUnique = (key: SdrQueueBucket, limit = 2) => {
      const items = sectionsByKey.get(key)?.items ?? [];
      const selected: SdrQueueItem[] = [];
      for (const item of items) {
        if (usedLeadIds.has(item.id)) continue;
        usedLeadIds.add(item.id);
        selected.push(item);
        if (selected.length === limit) break;
      }
      return selected;
    };

    const nowItems = sectionsByKey.get("NOW")?.items ?? [];
    const criticalItems = nowItems.filter(
      (item) => slaState(item, screen, nowMs).band === "CRITICAL",
    );
    const criticalUnique: SdrQueueItem[] = [];
    for (const item of criticalItems) {
      if (usedLeadIds.has(item.id)) continue;
      usedLeadIds.add(item.id);
      criticalUnique.push(item);
      if (criticalUnique.length === 2) break;
    }

    const groups: SideGroup[] = [
      {
        key: "MEETINGS_TODAY",
        title: "Próximas reuniões",
        total: sectionsByKey.get("MEETINGS_TODAY")?.total ?? 0,
        items: takeUnique("MEETINGS_TODAY"),
      },
      {
        key: "OVERDUE",
        title: "Retornos vencidos",
        total: sectionsByKey.get("OVERDUE")?.total ?? 0,
        tone: "warning",
        items: takeUnique("OVERDUE"),
      },
      {
        key: "NOW",
        title: "SLA crítico",
        total: criticalItems.length,
        totalLabel: `${criticalItems.length} visíveis`,
        tone: "danger",
        items: criticalUnique,
      },
      {
        key: "MISSING_NEXT_ACTION",
        title: "Sem próxima ação",
        total: sectionsByKey.get("MISSING_NEXT_ACTION")?.total ?? 0,
        tone: "danger",
        items: takeUnique("MISSING_NEXT_ACTION"),
      },
    ];

    return groups;
  }, [focusLead, nowMs, screen, sectionsByKey]);

  const secondsUntilRefresh = Math.max(
    0,
    AUTO_REFRESH_SECONDS -
      Math.floor(
        (nowMs - new Date(screen.generatedAt).getTime()) / 1_000,
      ),
  );

  function focusQueuePanel(key: SdrQueueBucket) {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        document.querySelector<HTMLElement>(`#queue-tabpanel-${key}`)?.focus();
      });
    });
  }

  function selectSection(key: SdrQueueBucket, moveFocus = true) {
    const params = new URLSearchParams(searchParams.toString());
    if (key === "NOW") params.delete("queue");
    else params.set("queue", key);
    window.history.replaceState(
      null,
      "",
      `${pathname}${params.size ? `?${params.toString()}` : ""}`,
    );
    if (moveFocus) focusQueuePanel(key);
  }

  function selectMember(memberId: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (memberId) params.set("memberId", memberId);
    else params.delete("memberId");
    router.push(`${pathname}${params.size ? `?${params.toString()}` : ""}`);
  }

  function handleTabKeyDown(
    event: ReactKeyboardEvent<HTMLButtonElement>,
    currentIndex: number,
  ) {
    let nextIndex: number | undefined;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (currentIndex + 1) % screen.sections.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex =
        (currentIndex - 1 + screen.sections.length) % screen.sections.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = screen.sections.length - 1;
    }

    if (nextIndex === undefined) return;
    event.preventDefault();
    const nextSection = screen.sections[nextIndex];
    if (!nextSection) return;
    selectSection(nextSection.key, false);
    tabRefs.current[nextIndex]?.focus();
  }

  const selectedSdrName = screen.selectedMemberId
    ? screen.sdrOptions.find((member) => member.id === screen.selectedMemberId)
        ?.name ?? "SDR selecionado"
    : screen.viewer.scope === "OWN"
      ? screen.viewer.displayName
      : "Todos no meu escopo";

  return (
    <div className={styles.workspace}>
      <header className={styles.operationalHeader}>
        <div>
          <p className={styles.eyebrow}>Operação SDR</p>
          <h1 className={styles.title}>Meu Dia</h1>
          <p className={styles.context}>
            Prioridades de {selectedSdrName} · dados em {screen.timeZone}
          </p>
        </div>

        <div className={styles.headerControls}>
          {screen.viewer.scope !== "OWN" ? (
            <label className={styles.memberField}>
              Visualizar fila por SDR
              <select
                onChange={(event) => selectMember(event.target.value)}
                value={screen.selectedMemberId ?? ""}
              >
                <option value="">Todos no meu escopo</option>
                {screen.sdrOptions.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                    {member.active ? "" : " · inativo"}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <div className={styles.refreshStatus} role="status">
            <strong>
              {isRefreshing
                ? "Atualizando dados persistidos…"
                : `Atualizado às ${formatTime(screen.generatedAt, screen.timeZone)}`}
            </strong>
            <span>Atualização automática em até {secondsUntilRefresh}s</span>
          </div>
          <Button
            disabled={isRefreshing}
            onClick={() => startRefresh(() => router.refresh())}
            size="sm"
            type="button"
            variant="secondary"
          >
            Atualizar
          </Button>
        </div>
      </header>

      <nav aria-label="Resumo operacional" className={styles.summaryStrip}>
        {summaryBuckets.map((summary) => {
          const section = sectionsByKey.get(summary.key);
          return (
            <button
              aria-pressed={summary.key === activeSection.key}
              className={styles.summaryButton}
              key={summary.key}
              onClick={() => selectSection(summary.key)}
              type="button"
            >
              <span className={styles.summaryLabel}>{summary.label}<Icon name={summary.icon} size={17} /></span>
              <strong>{section?.total ?? 0}</strong>
              <small>Abrir fila <Icon name="seta-direita" size={12} /></small>
            </button>
          );
        })}
      </nav>

      <FocusLead item={focusLead} nowMs={nowMs} screen={screen} />

      <AccountPlanCommitments timeZone={screen.timeZone} />

      <div className={styles.contentGrid}>
        <section aria-label="Navegador de filas" className={styles.queuePanel}>
          <div className={styles.tabsScroller}>
            <div aria-label="Filas do Meu Dia" className={styles.tabList} role="tablist">
              {screen.sections.map((section, index) => (
                <button
                  aria-controls={`queue-tabpanel-${section.key}`}
                  aria-selected={section.key === activeSection.key}
                  className={styles.tab}
                  id={`queue-tab-${section.key}`}
                  key={section.key}
                  onClick={() => selectSection(section.key)}
                  onKeyDown={(event) => handleTabKeyDown(event, index)}
                  ref={(element) => {
                    tabRefs.current[index] = element;
                  }}
                  role="tab"
                  tabIndex={section.key === activeSection.key ? 0 : -1}
                  type="button"
                >
                  {section.title}
                  <span className={styles.tabCount}>{section.total}</span>
                </button>
              ))}
            </div>
          </div>

          <QueuePanel
            focusLeadId={focusLead?.id}
            nowMs={nowMs}
            screen={screen}
            section={activeSection}
          />
        </section>

        <SidePanel groups={sideGroups} onOpenQueue={selectSection} />
      </div>
    </div>
  );
}
