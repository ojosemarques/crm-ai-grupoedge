"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  RealtimeDashboardScreen,
  RealtimeDashboardSnapshot,
  RealtimeShareState,
} from "@/modules/realtime-dashboard/domain/realtime-dashboard-contracts";
import {
  nextRealtimePollDelay,
  REALTIME_DASHBOARD_SLIDE_DURATION_MS,
  REALTIME_DASHBOARD_STALE_AFTER_MS,
} from "@/modules/realtime-dashboard/domain/realtime-dashboard-polling";
import styles from "./realtime-dashboard.module.css";

type RealtimeDashboardProps = Readonly<{ mode: "private" | "public" }>;
type LoadState = "LOADING" | "LIVE" | "STALE" | "ERROR";

const initialSharing: RealtimeShareState = Object.freeze({
  active: false,
  revision: null,
  createdAt: null,
  rotatedAt: null,
  revokedAt: null,
});

const formatter = new Intl.NumberFormat("pt-BR");
const currencyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 0,
});

function formatCents(value: string): string {
  return currencyFormatter.format(Number(BigInt(value)) / 100);
}

function relativeFreshness(value: string | null, now = Date.now()): string {
  if (!value) return "sem fatos no período";
  const seconds = Math.max(0, Math.round((now - Date.parse(value)) / 1_000));
  if (seconds < 10) return "agora";
  if (seconds < 60) return `há ${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `há ${minutes} min`;
}

function MetricCard({ label, value, detail, tone = "blue" }: Readonly<{
  label: string;
  value: string;
  detail: string;
  tone?: "blue" | "green" | "amber" | "violet";
}>) {
  return (
    <article className={styles.metricCard} data-tone={tone}>
      <span className={styles.metricLabel}>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function EmptyState({ publicMode }: Readonly<{ publicMode: boolean }>) {
  return (
    <div className={styles.emptyState} role="alert">
      <div className={styles.emptyMark}>!</div>
      <h1>{publicMode ? "Placar indisponível" : "Não foi possível carregar o placar"}</h1>
      <p>{publicMode
        ? "O link pode ter sido revogado ou substituído. Solicite um novo link ao responsável."
        : "Verifique a conexão e tente novamente."}</p>
    </div>
  );
}

export function RealtimeDashboard({ mode }: RealtimeDashboardProps) {
  const publicMode = mode === "public";
  const [snapshot, setSnapshot] = useState<RealtimeDashboardSnapshot | null>(null);
  const [sharing, setSharing] = useState<RealtimeShareState>(initialSharing);
  const [canManageShare, setCanManageShare] = useState(false);
  const [loadState, setLoadState] = useState<LoadState>("LOADING");
  const [message, setMessage] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareBusy, setShareBusy] = useState(false);
  const [slide, setSlide] = useState<0 | 1>(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [clock, setClock] = useState(() => Date.now());
  const inFlight = useRef<AbortController | null>(null);
  const lastSuccessAt = useRef<number | null>(null);
  const failureCount = useRef(0);

  const publicToken = useMemo(() => {
    if (!publicMode || typeof window === "undefined") return null;
    const value = window.location.hash.slice(1);
    return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
  }, [publicMode]);

  const load = useCallback(async () => {
    if (inFlight.current || (publicMode && !publicToken)) {
      if (publicMode && !publicToken) setLoadState("ERROR");
      return false;
    }
    const controller = new AbortController();
    inFlight.current = controller;
    try {
      const response = await fetch(publicMode ? "/api/public/tempo-real" : "/api/tempo-real", {
        cache: "no-store",
        ...(publicMode ? { headers: { Authorization: `Bearer ${publicToken}` } } : {}),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP_${response.status}`);
      const payload = await response.json() as { result: RealtimeDashboardScreen | RealtimeDashboardSnapshot };
      if (publicMode) {
        setSnapshot(payload.result as RealtimeDashboardSnapshot);
      } else {
        const screen = payload.result as RealtimeDashboardScreen;
        setSnapshot(screen.snapshot);
        setSharing(screen.sharing);
        setCanManageShare(screen.permissions.manageShare);
      }
      lastSuccessAt.current = Date.now();
      failureCount.current = 0;
      setLoadState("LIVE");
      setMessage(null);
      return true;
    } catch {
      if (controller.signal.aborted) return false;
      failureCount.current += 1;
      setLoadState(lastSuccessAt.current ? "STALE" : "ERROR");
      setMessage(publicMode ? "O placar não pôde ser atualizado." : "Atualização interrompida. Tentando novamente.");
      return false;
    } finally {
      if (inFlight.current === controller) inFlight.current = null;
    }
  }, [publicMode, publicToken]);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = async () => {
      const ok = await load();
      if (!active) return;
      const delay = nextRealtimePollDelay({
        succeeded: ok,
        failureCount: failureCount.current,
        hidden: document.hidden,
        fullscreen: Boolean(document.fullscreenElement),
        jitterMs: Math.floor(Math.random() * 1_500),
      });
      timer = setTimeout(schedule, delay);
    };
    void schedule();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      inFlight.current?.abort();
    };
  }, [load]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setSlide((current) => current === 0 ? 1 : 0);
    }, REALTIME_DASHBOARD_SLIDE_DURATION_MS);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = Date.now();
      setClock(now);
      if (lastSuccessAt.current && now - lastSuccessAt.current > REALTIME_DASHBOARD_STALE_AFTER_MS) setLoadState("STALE");
    }, 1_000);
    const onFullscreen = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFullscreen);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("fullscreenchange", onFullscreen);
    };
  }, []);

  async function manageShare(action: "ROTATE" | "REVOKE") {
    setShareBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/tempo-real", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!response.ok) throw new Error(`HTTP_${response.status}`);
      const payload = await response.json() as { result: { sharing: RealtimeShareState; shareUrl?: string } };
      setSharing(payload.result.sharing);
      setShareUrl(payload.result.shareUrl ?? null);
      setMessage(action === "ROTATE"
        ? "Novo link gerado. O link anterior deixou de funcionar."
        : "Link público revogado imediatamente.");
    } catch {
      setMessage("Não foi possível alterar o link público.");
    } finally {
      setShareBusy(false);
    }
  }

  async function toggleFullscreen() {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  }

  if (!snapshot && loadState === "ERROR") return <main className={styles.board}><EmptyState publicMode={publicMode} /></main>;
  if (!snapshot) return <main aria-busy="true" className={styles.board}><div className={styles.loader}>Preparando o placar…</div></main>;

  const qualityLabel = snapshot.quality.state === "LIVE" ? "Ao vivo" : snapshot.quality.state === "PARTIAL" ? "Cobertura parcial" : "Qualidade indisponível";
  const goal = snapshot.week.salesGoal;
  const goalPercent = goal.progressBasisPoints === null ? 0 : Math.min(100, Math.round(goal.progressBasisPoints / 100));

  return (
    <main className={styles.board} data-fullscreen={fullscreen || undefined}>
      <header className={styles.header}>
        <div className={styles.brandBlock}>
          <span className={styles.livePulse} aria-hidden="true" />
          <div>
            <p>{snapshot.workspaceName}</p>
            <h1>TEMPO REAL</h1>
          </div>
        </div>
        <div className={styles.headerMeta}>
          <span className={styles.status} data-state={loadState.toLowerCase()} title={snapshot.quality.reason}>
            {loadState === "STALE" ? "Dados desatualizados" : qualityLabel}
          </span>
          <span>Atualizado {relativeFreshness(snapshot.freshnessAt, clock)}</span>
          <button onClick={() => void toggleFullscreen()} type="button">{fullscreen ? "Sair da tela cheia" : "Tela cheia"}</button>
        </div>
      </header>

      {message ? <div className={styles.notice} role="status">{message}</div> : null}

      <section aria-label={`Slide ${slide + 1} de 2`} className={styles.stage}>
        {slide === 0 ? (
          <div className={styles.slide}>
            <div className={styles.slideTitle}>
              <div><span>Hoje</span><h2>Ritmo comercial</h2></div>
              <p>{snapshot.today.period.fromDate.split("-").reverse().join("/")} · {snapshot.timeZone}</p>
            </div>
            <div className={styles.metricsGrid}>
              <MetricCard label="Ligações" value={formatter.format(snapshot.today.totals.calls)} detail="tentativas registradas" tone="blue" />
              <MetricCard label="Contatos efetivos" value={formatter.format(snapshot.today.totals.effectiveContacts)} detail="leads únicos alcançados" tone="green" />
              <MetricCard label="Mensagens" value={formatter.format(snapshot.today.totals.messages)} detail="WhatsApp, Instagram e e-mail" tone="violet" />
              <MetricCard label="Reuniões marcadas" value={formatter.format(snapshot.today.totals.meetingsScheduled)} detail="crédito de agendamento" tone="amber" />
              <MetricCard label="Reuniões realizadas" value={formatter.format(snapshot.today.totals.meetingsCompleted)} detail="concluídas no período" tone="green" />
              <MetricCard label="Vendas" value={formatter.format(snapshot.today.totals.sales)} detail={formatCents(snapshot.today.totals.salesValueCents)} tone="blue" />
            </div>
            <article className={styles.goalCard}>
              <div>
                <span>Meta semanal de vendas</span>
                <strong>{formatter.format(goal.achieved)}{goal.target === null ? "" : ` / ${formatter.format(Number(goal.target))}`}</strong>
                <small>{goal.label}</small>
              </div>
              <div className={styles.goalVisual}>
                <div className={styles.goalRing}>
                  <svg aria-hidden="true" viewBox="0 0 42 42">
                    <circle cx="21" cy="21" fill="none" r="17" strokeWidth="3" />
                    <circle cx="21" cy="21" fill="none" pathLength="100" r="17" strokeDasharray={`${goalPercent} 100`} strokeWidth="3" />
                  </svg>
                  <span>{goal.progressBasisPoints === null ? "—" : `${goalPercent}%`}</span>
                </div>
                <div className={styles.weekSummary}>
                  <span><b>{snapshot.week.totals.calls}</b> ligações na semana</span>
                  <span><b>{snapshot.week.totals.meetingsCompleted}</b> reuniões realizadas</span>
                  <span><b>{formatCents(snapshot.week.totals.salesValueCents)}</b> em vendas</span>
                </div>
              </div>
            </article>
          </div>
        ) : (
          <div className={styles.slide}>
            <div className={styles.slideTitle}>
              <div><span>Semana</span><h2>Ranking de atividade</h2></div>
              <p>Segunda a sexta · {snapshot.week.period.fromDate.split("-").reverse().join("/")}–{snapshot.week.period.toDate.split("-").reverse().join("/")}</p>
            </div>
            <div className={styles.ranking}>
              <div className={styles.rankingHeader} aria-hidden="true">
                <span>Posição</span><span>Profissional</span><span>Ações</span><span>Contatos</span><span>Reuniões</span><span>Vendas</span>
              </div>
              {snapshot.week.ranking.length ? snapshot.week.ranking.slice(0, 12).map((row) => (
                <article className={styles.rankingRow} data-podium={row.position <= 3 || undefined} key={`${row.position}-${row.name}`}>
                  <span className={styles.position}>{row.position}</span>
                  <div className={styles.person}><span>{row.initials}</span><strong>{row.name}</strong></div>
                  <strong>{formatter.format(row.actions)}</strong>
                  <span>{formatter.format(row.effectiveContacts)}</span>
                  <span>{formatter.format(row.meetingsCompleted)} <small>de {formatter.format(row.meetingsScheduled)}</small></span>
                  <span>{formatter.format(row.sales)} <small>{formatCents(row.salesValueCents)}</small></span>
                </article>
              )) : <div className={styles.noRanking}>Nenhuma atividade comercial registrada nesta semana.</div>}
            </div>
          </div>
        )}
      </section>

      <footer className={styles.footer}>
        <div className={styles.slideControl}>
          {[0, 1].map((index) => (
            <button aria-label={`Mostrar slide ${index + 1}`} aria-pressed={slide === index} key={index} onClick={() => setSlide(index as 0 | 1)} type="button">
              <span>{index + 1}</span><i>{index === 0 ? "Resumo" : "Ranking"}</i>
            </button>
          ))}
        </div>
        {!publicMode && canManageShare ? (
          <div className={styles.shareControls}>
            <span>{sharing.active ? `Link público ativo · revisão ${sharing.revision}` : "Link público desativado"}</span>
            {sharing.active ? <button disabled={shareBusy} onClick={() => void manageShare("REVOKE")} type="button">Revogar</button> : null}
            <button disabled={shareBusy} onClick={() => void manageShare("ROTATE")} type="button">{sharing.active ? "Trocar link" : "Gerar link"}</button>
          </div>
        ) : null}
      </footer>

      {shareUrl ? (
        <div className={styles.shareModal} role="dialog" aria-modal="true" aria-labelledby="share-title">
          <div>
            <span className={styles.modalEyebrow}>Bearer exibido uma única vez</span>
            <h2 id="share-title">Copie o novo link público</h2>
            <p>Quem tiver este link poderá ver o placar até ele ser revogado ou trocado.</p>
            <input aria-label="Link público" readOnly value={shareUrl} />
            <div className={styles.modalActions}>
              <button onClick={() => void navigator.clipboard.writeText(shareUrl)} type="button">Copiar link</button>
              <button onClick={() => setShareUrl(null)} type="button">Fechar</button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
