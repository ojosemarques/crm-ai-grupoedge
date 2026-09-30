"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import styles from "./agenda-workspace.module.css";
import { AccessibleDialog } from "@/components/ui/accessible-dialog";
import { Icon } from "@/components/ui/icon";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import type { AgendaScreen } from "@/modules/meetings/domain/meeting-contracts";
import { MeetingActions } from "@/modules/meetings/ui/meeting-actions";

const inputClass = "mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm";
const statusLabels = {
  SCHEDULED: "Agendada",
  CONFIRMED: "Confirmada",
  COMPLETED: "Realizada",
  CANCELLED: "Cancelada",
  NO_SHOW: "No-show",
  PENDING_STATUS: "Horário passou · resultado pendente",
} as const;

function statusTone(value: keyof typeof statusLabels): StatusTone {
  if (value === "COMPLETED") return "success";
  if (value === "CANCELLED" || value === "NO_SHOW") return "danger";
  if (value === "PENDING_STATUS") return "warning";
  return "info";
}

function formatDate(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone,
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

async function responseMessage(response: Response) {
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    if (body && typeof body === "object" && "error" in body && body.error && typeof body.error === "object" && "message" in body.error) {
      throw new Error(String(body.error.message));
    }
    throw new Error("Não foi possível salvar a reunião.");
  }
  return body;
}

export function AgendaWorkspace({ initialScreen }: Readonly<{ initialScreen: AgendaScreen }>) {
  const router = useRouter();
  const [updatedScreen, setScreen] = useState<AgendaScreen | null>(null);
  const screen = updatedScreen ?? initialScreen;
  const [display, setDisplay] = useState<"calendar" | "list">("calendar");
  const [showSchedule, setShowSchedule] = useState(false);
  const [scheduleLeadId, setScheduleLeadId] = useState("");
  const [selectedMeetingId, setSelectedMeetingId] = useState<string | null>(null);
  const [hiddenStatuses, setHiddenStatuses] = useState<string[]>([]);
  const selectedMeeting = screen.meetings.find((meeting) => meeting.id === selectedMeetingId);
  const visibleMeetings = screen.meetings.filter((meeting) => !hiddenStatuses.includes(meeting.operationalStatus));
  const selected = new Date(`${screen.selectedDate}T12:00:00Z`);
  const weekStart = addDays(screen.selectedDate, -((selected.getUTCDay() + 6) % 7));
  const days = screen.view === "day" ? [screen.selectedDate] : Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  const monthStart = `${screen.selectedDate.slice(0, 7)}-01`;
  const miniStart = addDays(monthStart, -((new Date(`${monthStart}T12:00:00Z`).getUTCDay() + 6) % 7));
  const today = localDate(screen.generatedAt, screen.timeZone);
  function navigate(date: string, view = screen.view, closerId = screen.closerId) {
    setScreen(null);
    const query = new URLSearchParams({ date, view });
    if (closerId) query.set("closerId", closerId);
    router.push(`/agenda?${query.toString()}`);
  }
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function refresh() {
    const query = new URLSearchParams({ view: screen.view, date: screen.selectedDate });
    if (screen.closerId) query.set("closerId", screen.closerId);
    const response = await fetch(`/api/meetings?${query.toString()}`, { cache: "no-store" });
    const body: unknown = await response.json();
    if (!response.ok || !body || typeof body !== "object" || !("result" in body)) throw new Error("Falha ao atualizar a agenda.");
    setScreen(body.result as AgendaScreen);
    router.refresh();
  }

  async function schedule(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setNotice(null);
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      const response = await fetch("/api/meetings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadId: data.get("leadId"),
          opportunityId: data.get("opportunityId") || null,
          closerId: data.get("closerId"),
          title: data.get("title"),
          startsAtLocal: data.get("startsAtLocal"),
          durationMinutes: Number(data.get("durationMinutes")),
          observation: data.get("observation") || null,
        }),
      });
      await responseMessage(response);
      form.reset();
      setScheduleLeadId("");
      setNotice("Reunião agendada, tarefa criada e pipeline atualizado.");
      await refresh();
      setShowSchedule(false);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Falha inesperada.");
    } finally {
      setPending(false);
    }
  }

  function meetingDetail(meeting: AgendaScreen["meetings"][number]) {
    return <div className={styles.meetingDetail}>
      <div className={styles.detailMeta}><StatusBadge tone={statusTone(meeting.operationalStatus)}>{statusLabels[meeting.operationalStatus]}</StatusBadge><span>{meeting.durationMinutes} minutos</span></div>
      <p><Icon name="agenda" size={16} />{formatDate(meeting.startsAt, screen.timeZone)}</p>
      <p><Icon name="leads" size={16} />{meeting.leadName} · {meeting.closerName}</p>
      {meeting.observation ? <p className={styles.observation}>{meeting.observation}</p> : null}
      <StatusBadge tone={meeting.calendarSync.state === "SYNCED" ? "success" : meeting.calendarSync.state === "CONFLICT" || meeting.calendarSync.state === "FAILED" ? "danger" : "info"}>Calendário: {meeting.calendarSync.state === "NOT_LINKED" ? "não conectado" : meeting.calendarSync.state.toLowerCase().replaceAll("_", " ")}</StatusBadge>
      <div className={styles.detailLinks}><Link href={`/agenda/reunioes/${meeting.id}`}>Abrir briefing do closer →</Link><Link href={`/integracoes/calendario?meetingId=${meeting.id}`}>Ver calendário</Link>{meeting.opportunityId ? <Link href={`/oportunidades?opportunityId=${meeting.opportunityId}`}>Abrir oportunidade</Link> : null}</div>
      <MeetingActions meeting={meeting} onCommitted={refresh} />
    </div>;
  }

  return (
    <div className={styles.workspace}>
      <aside className={styles.sidebar}>
        <Button onClick={() => setShowSchedule(true)}><Icon name="mais" size={16} /> Agendar reunião</Button>
        <section className={styles.miniCalendar} aria-label="Selecionar data">
          <div className={styles.miniHeader}><strong>{new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(selected)}</strong><button aria-label="Mês anterior" onClick={() => navigate(addDays(monthStart, -1))} type="button">‹</button><button aria-label="Próximo mês" onClick={() => navigate(new Date(Date.UTC(selected.getUTCFullYear(), selected.getUTCMonth() + 1, 1)).toISOString().slice(0, 10))} type="button">›</button></div>
          <div className={styles.miniGrid}>{["S", "T", "Q", "Q", "S", "S", "D"].map((day, index) => <span key={index}>{day}</span>)}{Array.from({ length: 42 }, (_, index) => addDays(miniStart, index)).map((day) => <button aria-label={new Intl.DateTimeFormat("pt-BR", { dateStyle: "full", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`))} aria-pressed={day === screen.selectedDate} className={day.slice(0, 7) !== screen.selectedDate.slice(0, 7) ? styles.outsideMonth : undefined} data-today={day === today} key={day} onClick={() => navigate(day)} type="button">{Number(day.slice(-2))}</button>)}</div>
        </section>
        {screen.canFilterCloser ? <label className={styles.closerLabel}>Agenda de<select className={inputClass} onChange={(event) => navigate(screen.selectedDate, screen.view, event.target.value)} value={screen.closerId}><option value="">Todos os closers</option>{screen.closerOptions.map((closer) => <option key={closer.id} value={closer.id}>{closer.name}</option>)}</select></label> : null}
        <section className={styles.calendars}><h2>Minhas reuniões</h2>{Object.entries(statusLabels).map(([status, label]) => <label key={status}><input checked={!hiddenStatuses.includes(status)} onChange={(event) => setHiddenStatuses((current) => event.target.checked ? current.filter((item) => item !== status) : [...current, status])} type="checkbox" /><span>{label}</span></label>)}</section>
        <Link className={styles.connectLink} href="/integracoes/calendario"><Icon name="mais" size={14} /> Abrir calendário local</Link>
        <p className={styles.timezone}>{screen.timeZone}</p>
      </aside>
      <section className={styles.main} aria-label="Compromissos">
        <div className={styles.toolbar}><div className={styles.periodControls}><button onClick={() => navigate(today)} type="button">Hoje</button><button aria-label="Período anterior" onClick={() => navigate(addDays(screen.selectedDate, screen.view === "week" ? -7 : -1))} type="button">‹</button><button aria-label="Próximo período" onClick={() => navigate(addDays(screen.selectedDate, screen.view === "week" ? 7 : 1))} type="button">›</button><h2>{new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(selected)}</h2></div><div className={styles.viewSwitch}><button aria-pressed={screen.view === "day" && display === "calendar"} onClick={() => { setDisplay("calendar"); navigate(screen.selectedDate, "day"); }} type="button">Dia</button><button aria-pressed={screen.view === "week" && display === "calendar"} onClick={() => { setDisplay("calendar"); navigate(screen.selectedDate, "week"); }} type="button">Semana</button><button aria-pressed={display === "list"} onClick={() => setDisplay("list")} type="button">Lista</button></div></div>
        <div className={styles.rangeSummary}><span>{screen.rangeLabel}</span><span>{visibleMeetings.length} reuniões no período</span></div>
        {notice ? <p className={styles.notice} role="status">{notice}</p> : null}
        {display === "calendar" ? <div className={styles.calendarScroll}><div className={styles.calendar} data-view={screen.view}>{days.map((day) => {
          const meetings = visibleMeetings.filter((meeting) => localDate(meeting.startsAt, screen.timeZone) === day).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
          return <section className={styles.dayColumn} data-today={day === today} key={day}><header><span>{new Intl.DateTimeFormat("pt-BR", { weekday: "short", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`))}</span><strong>{Number(day.slice(-2))}</strong></header><div className={styles.dayEvents}>{meetings.map((meeting) => <button className={styles.event} data-status={meeting.operationalStatus} key={meeting.id} onClick={() => setSelectedMeetingId(meeting.id)} type="button"><span className={styles.eventTime}>{new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: screen.timeZone }).format(new Date(meeting.startsAt))} · {meeting.durationMinutes} min</span><strong>{meeting.title}</strong><span>{meeting.leadName}</span><small>{meeting.closerName}</small></button>)}{meetings.length === 0 ? <p className={styles.freeDay}>Sem reuniões</p> : null}</div></section>;
        })}</div></div> : <div className={styles.meetingList}>{visibleMeetings.length ? visibleMeetings.map((meeting) => <article className={styles.listCard} key={meeting.id}><h3>{meeting.title}</h3>{meetingDetail(meeting)}</article>) : <EmptyState description="Selecione outro período ou ajuste os filtros da agenda." title="Nenhuma reunião neste período" />}</div>}
      </section>
      {selectedMeeting ? <AccessibleDialog className={styles.dialog!} labelledBy="meeting-title" onDismiss={() => setSelectedMeetingId(null)}><div className={styles.dialogHeader}><div><span>Reunião</span><h2 id="meeting-title">{selectedMeeting.title}</h2></div><button aria-label="Fechar detalhes" onClick={() => setSelectedMeetingId(null)} type="button">×</button></div>{meetingDetail(selectedMeeting)}</AccessibleDialog> : null}
      {showSchedule ? <AccessibleDialog busy={pending} className={styles.dialog!} labelledBy="schedule-title" onDismiss={() => setShowSchedule(false)}><div className={styles.dialogHeader}><div><span>Agenda</span><h2 id="schedule-title">Agendar reunião</h2></div><button aria-label="Fechar agendamento" disabled={pending} onClick={() => setShowSchedule(false)} type="button">×</button></div>{screen.canSchedule ? <form className={styles.scheduleForm} onSubmit={schedule}>
        <label>Lead qualificado<select className={inputClass} name="leadId" onChange={(event) => setScheduleLeadId(event.target.value)} required value={scheduleLeadId}><option value="">Selecione o lead</option>{screen.leadOptions.map((lead) => <option key={lead.id} value={lead.id}>{lead.name}</option>)}</select></label>
        <label>Closer<select className={inputClass} name="closerId" required><option value="">Selecione o responsável</option>{screen.closerOptions.map((closer) => <option key={closer.id} value={closer.id}>{closer.name}</option>)}</select></label>
        <label className={styles.fullWidth}>Oportunidade<select className={inputClass} name="opportunityId"><option value="">Sem vínculo explícito</option>{screen.leadOptions.find((lead) => lead.id === scheduleLeadId)?.opportunities.map((opportunity) => <option key={opportunity.id} value={opportunity.id}>{opportunity.name}</option>)}</select></label>
        <label className={styles.fullWidth}>Título<input className={inputClass} name="title" required /></label>
        <label>Data e horário<input className={inputClass} defaultValue={`${screen.selectedDate}T09:00`} name="startsAtLocal" required type="datetime-local" /></label>
        <label>Duração<select className={inputClass} defaultValue={screen.defaultDurationMinutes} name="durationMinutes"><option value="30">30 minutos</option><option value="40">40 minutos</option></select></label>
        <label className={styles.fullWidth}>Observação<textarea className={inputClass} name="observation" rows={3} /></label>
        <p className={styles.fullWidth}>Horários em {screen.timeZone}.</p><Button className={styles.fullWidth} disabled={pending} type="submit">{pending ? "Agendando…" : "Confirmar agendamento"}</Button>
      </form> : <EmptyState compact description="Qualifique um lead ou selecione outro closer disponível." title="Nenhum lead disponível para agendar" />}{notice ? <p className={styles.notice} role="status">{notice}</p> : null}</AccessibleDialog> : null}
    </div>
  );
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function localDate(value: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(value));
  return `${parts.find((part) => part.type === "year")!.value}-${parts.find((part) => part.type === "month")!.value}-${parts.find((part) => part.type === "day")!.value}`;
}
