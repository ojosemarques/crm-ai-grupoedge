"use client";

import Link from "next/link";
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
import { Avatar, BrandMark, Icon, Leaderboard, PerformanceDashboard } from "./realtime-dashboard-visuals";
import styles from "./realtime-dashboard.module.css";

type LoadState = "LOADING" | "LIVE" | "STALE" | "ERROR";
const initialSharing: RealtimeShareState = { active: false, revision: null, createdAt: null, rotatedAt: null, revokedAt: null };

function relativeFreshness(value: number | null, now: number) {
  if (value === null) return "Conectando…";
  const seconds = Math.max(0, Math.floor((now - value) / 1_000));
  return seconds < 5 ? "Atualizado agora" : seconds < 60 ? `Atualizado há ${seconds}s` : `Atualizado há ${Math.floor(seconds / 60)} min`;
}

export function RealtimeDashboard({ mode }: Readonly<{ mode: "private" | "public" }>) {
  const publicMode = mode === "public";
  const [snapshot, setSnapshot] = useState<RealtimeDashboardSnapshot | null>(null);
  const [sharing, setSharing] = useState<RealtimeShareState>(initialSharing);
  const [canManageShare, setCanManageShare] = useState(false);
  const [loadState, setLoadState] = useState<LoadState>("LOADING");
  const [message, setMessage] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareBusy, setShareBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [slide, setSlide] = useState<0 | 1>(0);
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
      if (!response.ok) {
        if (publicMode && response.status === 404 && !controller.signal.aborted) {
          setSnapshot(null);
          lastSuccessAt.current = null;
          setReceivedAt(null);
        }
        throw new Error(`HTTP_${response.status}`);
      }
      const payload = await response.json() as { result: RealtimeDashboardScreen | RealtimeDashboardSnapshot };
      if (controller.signal.aborted) return false;
      if (publicMode) setSnapshot(payload.result as RealtimeDashboardSnapshot);
      else {
        const screen = payload.result as RealtimeDashboardScreen;
        setSnapshot(screen.snapshot);
        setSharing(screen.sharing);
        setCanManageShare(screen.permissions.manageShare);
      }
      lastSuccessAt.current = Date.now();
      setReceivedAt(lastSuccessAt.current);
      failureCount.current = 0;
      setLoadState("LIVE");
      return true;
    } catch {
      if (controller.signal.aborted) return false;
      failureCount.current += 1;
      setLoadState(lastSuccessAt.current ? "STALE" : "ERROR");
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
      timer = setTimeout(schedule, nextRealtimePollDelay({
        succeeded: ok,
        failureCount: failureCount.current,
        hidden: document.hidden,
        fullscreen: Boolean(document.fullscreenElement),
        jitterMs: Math.floor(Math.random() * 1_500),
      }));
    };
    void schedule();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      inFlight.current?.abort();
      inFlight.current = null;
    };
  }, [load]);

  const selectSlide = useCallback((index: 0 | 1) => {
    setSlide(index);
    setSlideStartedAt(Date.now());
  }, []);

  useEffect(() => {
    if (paused || dialogOpen || !hasSnapshot) return;
    const timer = window.setInterval(() => {
      setSlide((current) => current === 0 ? 1 : 0);
      setSlideStartedAt(Date.now());
    }, REALTIME_DASHBOARD_SLIDE_DURATION_MS);
    return () => window.clearInterval(timer);
  }, [paused, dialogOpen, slideStartedAt, hasSnapshot]);

  useEffect(() => {
    if (paused || dialogOpen || !hasSnapshot || slide !== 0) return;
    const timer = window.setInterval(() => setRankingPage((current) => current + 1), 12_000);
    return () => window.clearInterval(timer);
  }, [paused, dialogOpen, hasSnapshot, slide]);

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
      if (event.key === "ArrowRight" || event.key === "ArrowLeft") { event.preventDefault(); selectSlide(slide === 0 ? 1 : 0); }
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
      setShareUrl(payload.result.shareUrl ?? null);
      setCopied(false);
      setMessage(action === "ROTATE" ? "Novo link gerado. O link anterior deixou de funcionar." : "Link público revogado imediatamente.");
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

  if (!snapshot) return <main className={styles.board} data-appearance="dark" aria-busy={loadState === "LOADING"}><div className={styles.emptyState} role={loadState === "ERROR" ? "alert" : "status"}><BrandMark /><h1>{loadState === "ERROR" ? publicMode ? "Placar indisponível" : "Não foi possível carregar o placar" : "Preparando o painel"}</h1><p>{loadState === "ERROR" ? publicMode ? "O link pode ter sido revogado ou substituído. Solicite um novo link ao responsável." : "Verifique a conexão. Uma nova tentativa será feita automaticamente." : "Conectando a equipe, os resultados e as conquistas."}</p>{!publicMode && loadState === "ERROR" ? <Link href="/">Voltar ao CRM</Link> : null}</div></main>;

  const isLight = slide === 1;
  const qualityLabel = loadState === "STALE" || loadState === "ERROR" ? "Reconectando" : snapshot.quality.state === "LIVE" ? "Ao vivo" : snapshot.quality.state === "PARTIAL" ? "Cobertura parcial" : "Qualidade indisponível";
  const secondsLeft = Math.min(60, Math.max(0, Math.ceil((REALTIME_DASHBOARD_SLIDE_DURATION_MS - (clock - slideStartedAt)) / 1_000)));
  const statusTone = loadState === "LIVE" ? snapshot.quality.state.toLowerCase() : loadState.toLowerCase();
  const workspaceInitials = snapshot.workspaceName.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("");

  return <main ref={boardRef} className={styles.board} data-appearance={isLight ? "light" : "dark"} data-fullscreen={fullscreen || undefined} aria-label="TEMPO REAL">
    <div className={styles.frame}>
      <nav className={styles.rail} aria-label="Controles do painel de TV">
        {!publicMode ? <Link className={styles.brandLink} href="/" aria-label="Voltar ao CRM"><BrandMark /></Link> : <span className={styles.brandLink}><BrandMark /></span>}
        <div className={styles.railViews}><button type="button" aria-label="Mostrar slide 1" title="Ranking da equipe" aria-pressed={slide === 0} onClick={() => selectSlide(0)}><Icon name="grid" /></button><button type="button" aria-label="Mostrar slide 2" title="Desempenho comercial" aria-pressed={slide === 1} onClick={() => selectSlide(1)}><Icon name="chart" /></button><button type="button" aria-label={paused ? "Retomar apresentação" : "Pausar apresentação"} title={paused ? "Retomar apresentação" : "Pausar apresentação"} onClick={() => { setPaused((value) => !value); setSlideStartedAt(Date.now()); }}><Icon name={paused ? "play" : "pause"} /></button><button type="button" aria-label={fullscreen ? "Sair da tela cheia" : "Tela cheia"} title="Tela cheia" onClick={() => void toggleFullscreen()}><Icon name="expand" /></button></div>
        <div className={styles.railBottom}>{!publicMode && canManageShare ? <button type="button" aria-label="Compartilhar painel" title="Compartilhar painel" onClick={() => setSettingsOpen(true)}><Icon name="link" /></button> : null}{!publicMode ? <Link href="/" aria-label="Sair do painel de TV" title="Voltar ao CRM"><Icon name="exit" /></Link> : null}</div>
      </nav>
      <div className={styles.presentation}>
        <header className={styles.topbar}><span className={styles.screenName}>TEMPO REAL <span>/</span> {isLight ? "Desempenho" : "Ranking"}</span><div className={styles.topbarRight}><span className={styles.liveStatus} data-state={statusTone} title={snapshot.quality.reason}><i />{qualityLabel}</span><span className={styles.workspaceProfile}><Avatar initials={workspaceInitials} /><strong>{snapshot.workspaceName}</strong></span></div></header>
        <section className={styles.stage} key={slide} aria-label={`Slide ${slide + 1} de 2`}>
          {slide === 0 ? <Leaderboard snapshot={snapshot} now={clock} page={rankingPage} /> : <PerformanceDashboard snapshot={snapshot} />}
        </section>
        <footer className={styles.footer}><div className={styles.footerStatus}><span>{relativeFreshness(receivedAt, clock)}</span><i />{snapshot.timeZone}</div><div className={styles.slideIndicator}><span>{paused ? "Apresentação pausada" : dialogOpen ? "Controles abertos" : `Próxima tela em ${secondsLeft}s`}</span><b data-active={slide === 0} /><b data-active={slide === 1} /><small>0{slide + 1} / 02</small></div></footer>
      </div>
    </div>
    {loadState === "STALE" || loadState === "ERROR" ? <div className={styles.connectionNotice} role="status">Conexão interrompida. Exibindo a última atualização enquanto reconectamos.</div> : null}
    {message && !dialogOpen ? <div className={styles.connectionNotice} role="status">{message}<button aria-label="Fechar aviso" onClick={() => setMessage(null)}><Icon name="close" /></button></div> : null}
    <dialog ref={dialogRef} className={styles.shareDialog} aria-labelledby="share-title" onCancel={closeDialog} onClick={(event) => { if (event.target === event.currentTarget) closeDialog(); }}>
      <div className={styles.dialogContent}><button className={styles.dialogClose} type="button" aria-label="Fechar compartilhamento" onClick={closeDialog}><Icon name="close" /></button><span className={styles.dialogEyebrow}>PAINEL NA TV</span><h2 id="share-title">{shareUrl ? "Seu link está pronto" : "Compartilhar painel"}</h2><p>Abra este link no navegador da TV. Quem tiver o link poderá acompanhar o painel até você revogar o acesso.</p>
        {shareUrl ? <label className={styles.shareField}>Link público<input aria-label="Link público" readOnly value={shareUrl} onFocus={(event) => event.currentTarget.select()} /><small>Copie agora. Por segurança, este link só é exibido uma vez.</small></label> : <div className={styles.shareState}><i data-active={sharing.active} />{sharing.active ? `Acesso público ativo · revisão ${sharing.revision}` : "Acesso público desativado"}</div>}
        {message ? <p className={styles.dialogMessage} role="status">{message}</p> : null}
        <div className={styles.dialogActions}>{sharing.active ? <button disabled={shareBusy} type="button" onClick={() => void manageShare("REVOKE")}>Revogar acesso</button> : null}{shareUrl ? <button type="button" className={styles.primaryButton} onClick={() => void copyShare()}><Icon name={copied ? "check" : "copy"} />{copied ? "Link copiado" : "Copiar link"}</button> : <button disabled={shareBusy} type="button" className={styles.primaryButton} onClick={() => void manageShare("ROTATE")}><Icon name="link" />{shareBusy ? "Gerando…" : sharing.active ? "Gerar novo link" : "Gerar link público"}</button>}</div>
      </div>
    </dialog>
  </main>;
}
