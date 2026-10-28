"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import type {
  RealtimeDashboardScreen,
  RealtimeDashboardSnapshot,
  RealtimeShareState,
} from "@/modules/realtime-dashboard/domain/realtime-dashboard-contracts";
import type { RealtimeDashboardFront } from "@/modules/realtime-dashboard/domain/realtime-dashboard-front";
import {
  nextRealtimePollDelay,
  REALTIME_DASHBOARD_SLIDE_COUNT,
  REALTIME_DASHBOARD_SLIDE_DURATION_MS,
  REALTIME_DASHBOARD_STALE_AFTER_MS,
  REALTIME_DASHBOARD_REQUEST_TIMEOUT_MS,
  REALTIME_TV_PAGE_RELOAD_INTERVAL_MS,
} from "@/modules/realtime-dashboard/domain/realtime-dashboard-polling";
import { Avatar, BrandMark, Icon } from "./realtime-dashboard-icons";
import { DashboardSummary, Leaderboard, Overview } from "./realtime-dashboard-visuals";
import { readRealtimeTheme, setRealtimeTheme, subscribeRealtimeTheme } from "./realtime-dashboard-theme";
import styles from "./realtime-dashboard.module.css";

type LoadState = "LOADING" | "LIVE" | "STALE" | "ERROR";
const initialSharing: RealtimeShareState = { active: false, revision: null, createdAt: null, rotatedAt: null, revokedAt: null };

function relativeFreshness(value: number | null, now: number) {
  if (value === null) return "Conectando…";
  const seconds = Math.max(0, Math.floor((now - value) / 1_000));
  return seconds < 5 ? "Atualizado agora" : seconds < 60 ? `Atualizado há ${seconds}s` : `Atualizado há ${Math.floor(seconds / 60)} min`;
}

export function RealtimeDashboard({ mode }: Readonly<{ mode: "private" | "public" | "tv" }>) {
  const publicMode = mode !== "private";
  const tvMode = mode === "tv";
  const theme = useSyncExternalStore(subscribeRealtimeTheme, readRealtimeTheme, () => "dark" as const);
  const [snapshots, setSnapshots] = useState<Readonly<Record<RealtimeDashboardFront, RealtimeDashboardSnapshot>> | null>(null);
  const [sharing, setSharing] = useState<RealtimeShareState>(initialSharing);
  const [canManageShare, setCanManageShare] = useState(false);
  const [loadState, setLoadState] = useState<LoadState>("LOADING");
  const [message, setMessage] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareBusy, setShareBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [slide, setSlide] = useState(0);
  const front: RealtimeDashboardFront = slide < 2 ? "PROSPECTING" : "ADVERTISING";
  const frontLabel = front === "PROSPECTING" ? "Prospecção Ativa" : "Anúncios";
  const ranking = slide % 2 === 1;
  const snapshot = snapshots?.[front] ?? null;
  const [paused, setPaused] = useState(false);
  const [rankingPage, setRankingPage] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [clock, setClock] = useState(() => Date.now());
  const [receivedAt, setReceivedAt] = useState<number | null>(null);
  const [slideStartedAt, setSlideStartedAt] = useState(() => Date.now());
  const boardRef = useRef<HTMLElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inFlight = useRef<AbortController | null>(null);
  const lastSuccessAt = useRef<number | null>(null);
  const failureCount = useRef(0);
  const dialogOpen = settingsOpen || Boolean(shareUrl);
  const hasSnapshot = Boolean(snapshot);

  useEffect(() => {
    if (!tvMode) return;
    const deadline = Date.now() + REALTIME_TV_PAGE_RELOAD_INTERVAL_MS;
    let reloading = false;
    const reload = () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    };
    // Abas suspensas podem ter seus timers adiados pelo navegador.
    const checkDeadline = () => { if (Date.now() >= deadline) reload(); };
    const timer = window.setTimeout(reload, REALTIME_TV_PAGE_RELOAD_INTERVAL_MS);
    window.addEventListener("focus", checkDeadline);
    window.addEventListener("pageshow", checkDeadline);
    document.addEventListener("visibilitychange", checkDeadline);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", checkDeadline);
      window.removeEventListener("pageshow", checkDeadline);
      document.removeEventListener("visibilitychange", checkDeadline);
    };
  }, [tvMode]);

  const publicToken = useMemo(() => {
    if (!publicMode || typeof window === "undefined") return null;
    const value = window.location.hash.slice(1);
    return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
  }, [publicMode]);

  const load = useCallback(async () => {
    if (inFlight.current || (publicMode && !tvMode && !publicToken)) {
      if (publicMode && !tvMode && !publicToken) setLoadState("ERROR");
      return false;
    }
    const controller = new AbortController();
    inFlight.current = controller;
    let timedOut = false;
    const requestTimeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, REALTIME_DASHBOARD_REQUEST_TIMEOUT_MS);
    try {
      const endpoint = tvMode ? "/api/public/tempo" : publicMode ? "/api/public/tempo-real" : "/api/tempo-real";
      const fetchFront = async (selectedFront: RealtimeDashboardFront) => {
        const response = await fetch(`${endpoint}?front=${selectedFront}`, {
          cache: "no-store",
          ...(publicMode && !tvMode ? { headers: { Authorization: `Bearer ${publicToken}` } } : {}),
          signal: controller.signal,
        });
        if (!response.ok) {
          if (publicMode && response.status === 404 && !controller.signal.aborted) {
            setSnapshots(null);
            lastSuccessAt.current = null;
            setReceivedAt(null);
          }
          throw new Error(`HTTP_${response.status}`);
        }
        const payload = await response.json() as { result: RealtimeDashboardScreen | RealtimeDashboardSnapshot };
        return payload.result;
      };
      const [prospecting, advertising] = await Promise.all([fetchFront("PROSPECTING"), fetchFront("ADVERTISING")]);
      if (controller.signal.aborted) throw new Error("REQUEST_ABORTED");
      if (publicMode) setSnapshots({ PROSPECTING: prospecting as RealtimeDashboardSnapshot, ADVERTISING: advertising as RealtimeDashboardSnapshot });
      else {
        const screen = prospecting as RealtimeDashboardScreen;
        setSnapshots({ PROSPECTING: screen.snapshot, ADVERTISING: (advertising as RealtimeDashboardScreen).snapshot });
        setSharing(screen.sharing);
        setCanManageShare(screen.permissions.manageShare);
      }
      if (lastSuccessAt.current === null) setSlideStartedAt(Date.now());
      lastSuccessAt.current = Date.now();
      setReceivedAt(lastSuccessAt.current);
      failureCount.current = 0;
      setLoadState("LIVE");
      return true;
    } catch {
      if (controller.signal.aborted && !timedOut) return false;
      controller.abort();
      failureCount.current += 1;
      setLoadState(lastSuccessAt.current ? "STALE" : "ERROR");
      return false;
    } finally {
      window.clearTimeout(requestTimeout);
      if (inFlight.current === controller) inFlight.current = null;
    }
  }, [publicMode, publicToken, tvMode]);

  useEffect(() => {
    let active = true;
    let loadStartedHidden = false;
    let wakeAfterLoad = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = async () => {
      if (!active) return;
      if (inFlight.current) {
        if (loadStartedHidden && !document.hidden) wakeAfterLoad = true;
        return;
      }
      loadStartedHidden = document.hidden;
      wakeAfterLoad = false;
      if (timer) clearTimeout(timer);
      const ok = await load();
      if (!active) return;
      if (wakeAfterLoad) { void schedule(); return; }
      timer = setTimeout(schedule, nextRealtimePollDelay({
        succeeded: ok,
        failureCount: failureCount.current,
        hidden: document.hidden,
        fullscreen: Boolean(document.fullscreenElement),
        jitterMs: Math.floor(Math.random() * 1_500),
      }));
    };
    const wake = () => {
      if (!document.hidden || document.fullscreenElement) void schedule();
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("focus", wake);
    window.addEventListener("online", wake);
    void schedule();
    return () => {
      active = false;
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("focus", wake);
      window.removeEventListener("online", wake);
      if (timer) clearTimeout(timer);
      inFlight.current?.abort();
      inFlight.current = null;
    };
  }, [load]);

  const selectSlide = useCallback((index: number) => {
    setSlide(index);
    setRankingPage(0);
    setSlideStartedAt(Date.now());
  }, []);

  useEffect(() => {
    if (paused || dialogOpen || !hasSnapshot) return;
    const timer = window.setInterval(() => {
      setSlide((current) => (current + 1) % REALTIME_DASHBOARD_SLIDE_COUNT);
      setRankingPage(0);
      setSlideStartedAt(Date.now());
    }, REALTIME_DASHBOARD_SLIDE_DURATION_MS);
    return () => window.clearInterval(timer);
  }, [paused, dialogOpen, slideStartedAt, hasSnapshot]);

  useEffect(() => {
    if (paused || dialogOpen || !hasSnapshot || !ranking) return;
    const timer = window.setInterval(() => setRankingPage((current) => current + 1), 12_000);
    return () => window.clearInterval(timer);
  }, [paused, dialogOpen, hasSnapshot, ranking, slide]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = Date.now();
      setClock(now);
      if (lastSuccessAt.current && now - lastSuccessAt.current > REALTIME_DASHBOARD_STALE_AFTER_MS) setLoadState("STALE");
    }, 1_000);
    const onFullscreen = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFullscreen);
    return () => { window.clearInterval(timer); document.removeEventListener("fullscreenchange", onFullscreen); };
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (dialogOpen || event.altKey || event.ctrlKey || event.metaKey || event.target instanceof HTMLElement && event.target.closest("input, textarea, button, a")) return;
      if (event.key === "ArrowRight" || event.key === "ArrowLeft") { event.preventDefault(); selectSlide((slide + (event.key === "ArrowRight" ? 1 : REALTIME_DASHBOARD_SLIDE_COUNT - 1)) % REALTIME_DASHBOARD_SLIDE_COUNT); }
      if (event.code === "Space") { event.preventDefault(); setPaused((value) => !value); setSlideStartedAt(Date.now()); }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [dialogOpen, selectSlide, slide]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialogOpen && dialog && !dialog.open) dialog.showModal();
    else if (!dialogOpen && dialog?.open) dialog.close();
  }, [dialogOpen]);

  async function manageShare(action: "ROTATE" | "REVOKE") {
    setShareBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/tempo-real", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      if (!response.ok) throw new Error(`HTTP_${response.status}`);
      const payload = await response.json() as { result: { sharing: RealtimeShareState; shareUrl?: string } };
      setSharing(payload.result.sharing);
      const url = payload.result.shareUrl ? new URL(payload.result.shareUrl) : null;
      if (url && url.pathname !== "/tempo") url.searchParams.set("theme", theme);
      setShareUrl(url?.href ?? null);
      setCopied(false);
      setMessage(action === "ROTATE" ? url?.pathname === "/tempo" ? "Acesso público habilitado. O endereço da TV permanece o mesmo." : "Novo link gerado. O link anterior deixou de funcionar." : "Link público revogado imediatamente.");
    } catch { setMessage("Não foi possível alterar o link público. Tente novamente."); }
    finally { setShareBusy(false); }
  }

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await boardRef.current?.requestFullscreen();
    } catch { setMessage("Não foi possível abrir a tela cheia. Use a opção de tela cheia do navegador."); }
  }

  function closeDialog() { setSettingsOpen(false); setShareUrl(null); setCopied(false); setMessage(null); setSlideStartedAt(Date.now()); }

  async function copyShare() {
    if (!shareUrl) return;
    try { await navigator.clipboard.writeText(shareUrl); setCopied(true); }
    catch { setMessage("Selecione e copie o link no campo acima."); }
  }

  if (!snapshot) return <main className={styles.board} data-appearance={theme} aria-busy={loadState === "LOADING"}><div className={styles.emptyState} role={loadState === "ERROR" ? "alert" : "status"}><BrandMark /><h1>{loadState === "ERROR" ? publicMode ? "Placar indisponível" : "Não foi possível carregar o placar" : "Preparando o painel"}</h1><p>{loadState === "ERROR" ? publicMode ? "O link pode ter sido revogado ou substituído. Solicite um novo link ao responsável." : "Verifique a conexão. Uma nova tentativa será feita automaticamente." : "Conectando a equipe, os resultados e as conquistas."}</p>{!publicMode && loadState === "ERROR" ? <Link href="/">Voltar ao CRM</Link> : null}</div></main>;

  const qualityLabel = loadState === "STALE" || loadState === "ERROR" ? "Reconectando" : snapshot.quality.state === "LIVE" ? "Ao vivo" : snapshot.quality.state === "PARTIAL" ? "Cobertura parcial" : "Qualidade indisponível";
  const secondsLeft = Math.min(60, Math.max(0, Math.ceil((REALTIME_DASHBOARD_SLIDE_DURATION_MS - (clock - slideStartedAt)) / 1_000)));
  const statusTone = loadState === "LIVE" ? snapshot.quality.state.toLowerCase() : loadState.toLowerCase();
  const workspaceInitials = snapshot.workspaceName.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("");

  return <main ref={boardRef} className={styles.board} data-appearance={theme} data-fullscreen={fullscreen || undefined} aria-label="TEMPO REAL" data-front={front}>
    <div className={styles.frame}>
      <nav className={styles.rail} aria-label="Controles do painel de TV">
        {!publicMode ? <Link className={styles.brandLink} href="/" aria-label="Voltar ao CRM"><BrandMark /></Link> : <span className={styles.brandLink}><BrandMark /></span>}
        <div className={styles.railViews}><button type="button" aria-label="Prospecção Ativa" title="Tempo Real · Prospecção Ativa" aria-pressed={front === "PROSPECTING"} onClick={() => selectSlide(0)}><Icon name="grid" /></button><button type="button" aria-label="Anúncios" title="Tempo Real · Anúncios" aria-pressed={front === "ADVERTISING"} onClick={() => selectSlide(2)}><Icon name="target" /></button><button type="button" aria-label={paused ? "Retomar apresentação" : "Pausar apresentação"} title={paused ? "Retomar apresentação" : "Pausar apresentação"} onClick={() => { setPaused((value) => !value); setSlideStartedAt(Date.now()); }}><Icon name={paused ? "play" : "pause"} /></button><button type="button" aria-label={fullscreen ? "Sair da tela cheia" : "Tela cheia"} title="Tela cheia" onClick={() => void toggleFullscreen()}><Icon name="expand" /></button></div>
        <div className={styles.railBottom}>{!publicMode && canManageShare ? <button type="button" aria-label="Compartilhar painel" title="Compartilhar painel" onClick={() => setSettingsOpen(true)}><Icon name="link" /></button> : null}{!publicMode ? <Link href="/" aria-label="Sair do painel de TV" title="Voltar ao CRM"><Icon name="exit" /></Link> : null}</div>
      </nav>
      <div className={styles.presentation}>
        <header className={styles.topbar}><div className={styles.screenName}><span>TEMPO REAL / {frontLabel.toLocaleUpperCase("pt-BR")}</span><h1>TEMPO REAL</h1></div><div className={styles.topbarRight}><span className={styles.liveStatus} data-state={statusTone} title={snapshot.quality.reason}><i />{qualityLabel}</span><div className={styles.themeSwitch} role="group" aria-label="Aparência do painel"><button type="button" aria-label="Tema escuro" aria-pressed={theme === "dark"} onClick={() => setRealtimeTheme("dark")}><Icon name="moon" />Escuro</button><button type="button" aria-label="Tema claro" aria-pressed={theme === "light"} onClick={() => setRealtimeTheme("light")}><Icon name="sun" />Claro</button></div><span className={styles.workspaceProfile}><Avatar initials={workspaceInitials} /><strong>{snapshot.workspaceName}</strong></span></div></header>
        <div className={styles.viewHeading}><div><h2>{!ranking ? "O ritmo da equipe. O resultado de todos." : "Cada vendedor. Cada avanço."}</h2><p>{!ranking ? "Hoje e semana lado a lado, com atividade real e metas verificadas." : "Ranking semanal com resultados e metas diárias e semanais por profissional."}</p></div><div className={styles.viewTabs} role="group" aria-label="Visualização"><button type="button" aria-pressed={!ranking} onClick={() => selectSlide(front === "PROSPECTING" ? 0 : 2)}><Icon name="grid" />Geral</button><button type="button" aria-pressed={ranking} onClick={() => selectSlide(front === "PROSPECTING" ? 1 : 3)}><Icon name="trophy" />Ranking</button></div></div>
        <DashboardSummary snapshot={snapshot} front={front} />
        <section className={styles.stage} key={slide} aria-label={`Slide ${slide + 1} de ${REALTIME_DASHBOARD_SLIDE_COUNT}`}>
          {!ranking ? <Overview snapshot={snapshot} front={front} /> : <Leaderboard snapshot={snapshot} page={rankingPage} front={front} />}
        </section>
        <footer className={styles.footer}><div className={styles.footerStatus}><span>{relativeFreshness(receivedAt, clock)}</span><i />{snapshot.timeZone}<i /><span>{frontLabel} · Logs · Indicadores · contatos únicos por período</span></div><div className={styles.slideIndicator}><span>{paused ? "Apresentação pausada" : dialogOpen ? "Controles abertos" : `Próxima tela em ${secondsLeft}s`}</span>{Array.from({ length: REALTIME_DASHBOARD_SLIDE_COUNT }, (_, index) => <b key={index} data-active={slide === index} />)}<small>0{slide + 1} / 04</small></div></footer>
      </div>
    </div>
    {loadState === "STALE" || loadState === "ERROR" ? <div className={styles.connectionNotice} role="status">Conexão interrompida. Exibindo a última atualização enquanto reconectamos.</div> : null}
    {message && !dialogOpen ? <div className={styles.connectionNotice} role="status">{message}<button aria-label="Fechar aviso" onClick={() => setMessage(null)}><Icon name="close" /></button></div> : null}
    <dialog ref={dialogRef} className={styles.shareDialog} aria-labelledby="share-title" onCancel={closeDialog} onClick={(event) => { if (event.target === event.currentTarget) closeDialog(); }}>
      <div className={styles.dialogContent}><button className={styles.dialogClose} type="button" aria-label="Fechar compartilhamento" onClick={closeDialog}><Icon name="close" /></button><span className={styles.dialogEyebrow}>PAINEL NA TV</span><h2 id="share-title">{shareUrl ? "Seu link está pronto" : "Compartilhar painel"}</h2><p>Abra este link no navegador da TV. Qualquer pessoa que acessar o endereço poderá acompanhar o painel até você revogar o acesso.</p>
        {shareUrl ? <label className={styles.shareField}>Link público<input aria-label="Link público" readOnly value={shareUrl} onFocus={(event) => event.currentTarget.select()} /><small>{new URL(shareUrl).pathname === "/tempo" ? "Endereço fixo, sem login. Revogar acesso desativa o painel público." : "Copie agora. Por segurança, este link só é exibido uma vez."}</small></label> : <div className={styles.shareState}><i data-active={sharing.active} />{sharing.active ? `Acesso público ativo · revisão ${sharing.revision}` : "Acesso público desativado"}</div>}
        {message ? <p className={styles.dialogMessage} role="status">{message}</p> : null}
        <div className={styles.dialogActions}>{sharing.active ? <button disabled={shareBusy} type="button" onClick={() => void manageShare("REVOKE")}>Revogar acesso</button> : null}{shareUrl ? <button type="button" className={styles.primaryButton} onClick={() => void copyShare()}><Icon name={copied ? "check" : "copy"} />{copied ? "Link copiado" : "Copiar link"}</button> : <button disabled={shareBusy} type="button" className={styles.primaryButton} onClick={() => void manageShare("ROTATE")}><Icon name="link" />{shareBusy ? "Gerando…" : sharing.active ? "Gerar novo link" : "Gerar link público"}</button>}</div>
      </div>
    </dialog>
  </main>;
}
