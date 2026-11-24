"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useMemo, useState, type FormEvent } from "react";
import { PUBLIC_AGENDA_MINUTES, PUBLIC_AGENDA_TITLE, PUBLIC_AGENDA_ZONE } from "@/modules/marketing-forms/domain/public-agenda";
import mark from "../../../../../public/brand/politizai-mark.png";
import styles from "./agenda.module.css";

type Confirmation = { startsAt: string; endsAt: string; durationMinutes: number; timeZone: string; title: string; status: string; canReschedule: boolean; whatsappUrl: string; googleCalendarUrl: string };
type Availability = { today: string; days: string[]; booked: boolean; rescheduling?: boolean; confirmation?: Confirmation; slots: { day: string; startsAt: string }[] };

const dateLabel = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" });
const monthLabel = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", month: "long", year: "numeric" });
const clock = new Intl.DateTimeFormat("pt-BR", { timeZone: PUBLIC_AGENDA_ZONE, hour: "2-digit", minute: "2-digit" });
const confirmationDate = new Intl.DateTimeFormat("pt-BR", { timeZone: PUBLIC_AGENDA_ZONE, weekday: "long", day: "numeric", month: "long" });
const shortMonth = new Intl.DateTimeFormat("pt-BR", { timeZone: PUBLIC_AGENDA_ZONE, month: "short" });
const dayNumber = new Intl.DateTimeFormat("pt-BR", { timeZone: PUBLIC_AGENDA_ZONE, day: "2-digit" });
const weekdays = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
function asDay(day: string) { return new Date(`${day}T00:00:00Z`); }

function Icon({ name }: { name: "clock" | "phone" | "globe" | "whatsapp" | "calendar" | "refresh" | "arrow" }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    {name === "clock" ? <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>
      : name === "phone" ? <path d="M7 3H4a1 1 0 0 0-1 1 17 17 0 0 0 17 17 1 1 0 0 0 1-1v-3l-5-2-2 2a13 13 0 0 1-7-7l2-2-2-5Z" />
        : name === "globe" ? <><circle cx="12" cy="12" r="9" /><ellipse cx="12" cy="12" rx="4" ry="9" /><path d="M3 12h18M5 7h14M5 17h14" /></>
          : name === "whatsapp" ? <><path d="M20 11.5a8 8 0 0 1-11.9 7L4 20l1.5-4A8 8 0 1 1 20 11.5Z" /><path d="M9 8.5c.5 2.4 2.2 4.1 4.6 4.8l1.2-1.2 1.7.8-.2 1.8c-4 .8-7.6-2.7-7.7-6.7l1.7-.3.8 1.7L9 10.5" /></>
            : name === "calendar" ? <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M8 3v4M16 3v4M3 10h18" /></>
              : name === "refresh" ? <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6 8a7 7 0 0 1 12-1l2 5M18 16a7 7 0 0 1-12 1l-2-5" /></>
                : <path d="m9 5 7 7-7 7" />}
  </svg>;
}

function useCountdown(startsAt: string) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1_000); return () => window.clearInterval(timer); }, [startsAt]);
  const total = Math.max(0, new Date(startsAt).getTime() - now);
  return { started: total === 0, days: Math.floor(total / 86_400_000), hours: Math.floor(total % 86_400_000 / 3_600_000), minutes: Math.floor(total % 3_600_000 / 60_000), seconds: Math.floor(total % 60_000 / 1_000) };
}

function ConfirmationScreen({ confirmation, onReschedule, loading, error }: { confirmation: Confirmation; onReschedule: () => void; loading: boolean; error: string }) {
  const startsAt = useMemo(() => new Date(confirmation.startsAt), [confirmation.startsAt]);
  const remaining = useCountdown(confirmation.startsAt);
  const month = shortMonth.format(startsAt).replace(".", "").toLocaleUpperCase("pt-BR");
  return <div className={styles.confirmationPage}>
    <section className={styles.confirmationCard} aria-labelledby="confirmation-title">
      <div className={styles.confirmationHeader}><h1 id="confirmation-title">Vaga garantida</h1><span className={styles.confirmedBadge}><i /> Confirmada</span></div>
      <div className={styles.meetingWhen}>
        <div className={styles.calendarBadge}><strong>{month}</strong><span>{dayNumber.format(startsAt)}</span></div>
        <div><h2>{confirmationDate.format(startsAt)}, às {clock.format(startsAt)}</h2><p>Ao vivo, {confirmation.durationMinutes} min · Brasília</p></div>
      </div>
      <div className={styles.warning} role="note"><strong>ATENÇÃO</strong><p>Sua reunião foi reservada na agenda de nossos consultores. Cancelamentos sem aviso prévio estão sujeitos a uma taxa de R$ 50,00.</p><p>Nosso time entrará em contato em instantes para confirmar o agendamento.</p></div>
      <p className={styles.countdownTitle}>{remaining.started ? "A reunião já começou" : "Começa em"}</p>
      {!remaining.started && <div className={styles.countdown} aria-live="polite">
        {remaining.days > 0 && <div><strong>{remaining.days}</strong><span>{remaining.days === 1 ? "dia" : "dias"}</span></div>}
        <div><strong>{String(remaining.hours).padStart(2, "0")}</strong><span>horas</span></div>
        <div><strong>{String(remaining.minutes).padStart(2, "0")}</strong><span>min</span></div>
        <div><strong>{String(remaining.seconds).padStart(2, "0")}</strong><span>seg</span></div>
      </div>}
    </section>
    <nav className={styles.actions} aria-label="Ações do agendamento">
      <a href={confirmation.whatsappUrl} target="_blank" rel="noopener noreferrer"><span className={`${styles.actionIcon} ${styles.whatsapp}`}><Icon name="whatsapp" /></span><span><strong>Entrar em contato agora</strong><small>Mandar os dados da reunião pelo WhatsApp</small></span><Icon name="arrow" /></a>
      <a href={confirmation.googleCalendarUrl} target="_blank" rel="noopener noreferrer"><span className={styles.actionIcon}><Icon name="calendar" /></span><span><strong>Salvar no Google Agenda</strong><small>Adicionar a reunião e receber lembretes</small></span><Icon name="arrow" /></a>
      {confirmation.canReschedule && <button type="button" onClick={onReschedule} disabled={loading}><span className={styles.actionIcon}><Icon name="refresh" /></span><span><strong>{loading ? "Carregando horários…" : "Trocar o horário"}</strong><small>O horário anterior será substituído</small></span><Icon name="arrow" /></button>}
    </nav>
    {error && <p className={styles.confirmationError} role="alert">{error}</p>}
  </div>;
}

type AgendaPickerProps = { receipt: string; native?: false } | { native: true; receipt?: never };
export function AgendaPicker({ receipt, native = false }: AgendaPickerProps) {
  const router = useRouter();
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [selectedDay, setDay] = useState<string | null>(null);
  const [shownMonth, setMonth] = useState<string | null>(null);
  const [selectedTime, setTime] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [loadError, setLoadError] = useState("");
  const [bookingError, setBookingError] = useState("");
  const [booking, setBooking] = useState(false);
  const [rescheduling, setRescheduling] = useState(false);
  const endpoint = native ? "/api/public/agenda/native" : `/api/public/agenda/${encodeURIComponent(receipt ?? "")}`;

  function applyAvailability(data: Availability) {
    setAvailability(data);
    const initialDay = data.days.includes(data.today) ? data.today : data.days[0] ?? data.today;
    setDay((day) => day && data.days.includes(day) ? day : initialDay);
    setMonth((month) => month && data.days.some((day) => day.startsWith(month)) ? month : initialDay.slice(0, 7));
    setRescheduling(data.rescheduling ?? false);
    setLoadError("");
  }

  useEffect(() => {
    const controller = new AbortController();
    fetch(endpoint, { signal: controller.signal, cache: "no-store" }).then(async (response) => {
      if (!response.ok) throw new Error(response.status === 404 ? "Este link de agendamento não está disponível." : "Não foi possível carregar os horários.");
      const data: Availability = await response.json();
      if (!controller.signal.aborted) applyAvailability(data);
    }).catch((error: unknown) => { if (!controller.signal.aborted) setLoadError(error instanceof Error ? error.message : "Não foi possível carregar os horários."); });
    return () => controller.abort();
  }, [endpoint, revision]);

  async function beginReschedule() {
    if (native) return;
    setBooking(true); setBookingError("");
    try {
      const response = await fetch(`${endpoint}?mode=reschedule`, { cache: "no-store" });
      if (!response.ok) throw new Error();
      applyAvailability(await response.json() as Availability); setTime(null);
    } catch { setBookingError("Não foi possível carregar novos horários. Tente novamente."); }
    finally { setBooking(false); }
  }

  async function confirm(time: string, identity?: { name: FormDataEntryValue | null; phone: FormDataEntryValue | null }) {
    setBooking(true); setBookingError("");
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ startsAt: time, ...(rescheduling ? { action: "RESCHEDULE" } : {}), ...identity }) });
      if (!response.ok) {
        if (response.status === 409) { setTime(null); setBookingError("Este horário não está mais disponível. Escolha outro."); if (!native) await beginReschedule(); }
        else setBookingError(response.status === 404 ? native ? "Confira o nome e o WhatsApp usados no formulário da Meta e tente novamente." : "Este link de agendamento não está disponível." : response.status === 429 ? "Aguarde um minuto e tente novamente." : "Não foi possível confirmar. Tente novamente.");
        return;
      }
      const result: { booked: true; confirmation: Confirmation; receipt?: string } = await response.json();
      applyAvailability({ today: "", days: [], booked: true, slots: [], confirmation: result.confirmation });
      if (native && result.receipt) {
        const confirmationUrl = `${window.location.origin}/f/agenda/${encodeURIComponent(result.receipt)}`;
        window.parent.postMessage({ type: "politizai:agenda-confirmada", confirmationUrl }, "https://site.politizai.com");
        router.replace(`/f/agenda/${encodeURIComponent(result.receipt)}`);
      }
    } catch { setBookingError("Não foi possível confirmar. Tente novamente."); }
    finally { setBooking(false); }
  }

  function confirmNative(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (!selectedTime || booking) return; const fields = new FormData(event.currentTarget); void confirm(selectedTime, { name: fields.get("name"), phone: fields.get("phone") }); }

  if (availability?.confirmation) return <main className={styles.confirmationShell}><ConfirmationScreen confirmation={availability.confirmation} onReschedule={() => void beginReschedule()} loading={booking} error={bookingError} /></main>;

  const monthStart = shownMonth ? asDay(`${shownMonth}-01`) : null;
  const numberOfDays = monthStart ? new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 0)).getUTCDate() : 0;
  const months = [...new Set(availability?.days.map((day) => day.slice(0, 7)))];
  const monthIndex = shownMonth ? months.indexOf(shownMonth) : -1;
  const times = availability?.slots.filter(({ day }) => day === selectedDay) ?? [];

  return <main className={styles.shell}><div className={styles.card}>
    <aside className={styles.summary} aria-label="Sobre a reunião"><div className={styles.brand}><Image src={mark} width={120} height={120} alt="Politizai" priority unoptimized /></div><div className={styles.details}><p className={styles.host}>Equipe Politizai</p><h1>{rescheduling ? "Escolha o novo horário" : PUBLIC_AGENDA_TITLE}</h1><p className={styles.fact}><Icon name="clock" /> {PUBLIC_AGENDA_MINUTES} min</p><p className={styles.fact}><Icon name="phone" /> Conversa com um especialista</p><p className={styles.description}>{rescheduling ? "Ao confirmar, o horário anterior será substituído. Você continuará com apenas uma reunião agendada." : "Vamos conhecer suas necessidades e mostrar como a Politizai pode ajudar. Não é preciso preparar nada para a conversa."}</p></div></aside>
    <section className={styles.scheduler} aria-label="Agendamento"><h2>{rescheduling ? "Selecione a nova data e horário" : "Selecione uma data e horário"}</h2>
      {loadError ? <div role="alert"><p>{loadError}</p><button type="button" onClick={() => { setLoadError(""); setRevision((value) => value + 1); }}>Tentar novamente</button></div> : !availability || !monthStart ? <p role="status">Carregando horários…</p> : <div className={styles.picker}>
        <div className={styles.calendar}><div className={styles.month}><button type="button" aria-label="Mês anterior" disabled={booking || monthIndex <= 0} onClick={() => setMonth(months[monthIndex - 1]!)}>‹</button><strong>{monthLabel.format(monthStart)}</strong><button type="button" aria-label="Próximo mês" disabled={booking || monthIndex >= months.length - 1} onClick={() => setMonth(months[monthIndex + 1]!)}>›</button></div>
          <div className={styles.grid}>{weekdays.map((day) => <span className={styles.weekday} key={day}>{day}</span>)}{Array.from({ length: monthStart.getUTCDay() }, (_, index) => <span key={`blank-${index}`} />)}{Array.from({ length: numberOfDays }, (_, index) => { const day = `${shownMonth}-${String(index + 1).padStart(2, "0")}`; const inWindow = availability.days.includes(day); const open = availability.slots.some((slot) => slot.day === day); return <button type="button" key={day} aria-label={dateLabel.format(asDay(day))} aria-current={day === availability.today ? "date" : undefined} aria-pressed={day === selectedDay} disabled={!inWindow || booking} data-open={open} onClick={() => { setDay(day); setTime(null); setBookingError(""); }}>{index + 1}</button>; })}</div>
          <p className={styles.zone}><strong>Fuso horário</strong><span><Icon name="globe" /> Horário de Brasília</span></p></div>
        <div className={styles.times} aria-label="Horários disponíveis">{selectedDay && <h3>{dateLabel.format(asDay(selectedDay))}</h3>}{!times.length && <p>Sem horários disponíveis neste dia.</p>}{times.map(({ startsAt }) => <Fragment key={startsAt}><div className={styles.timeRow}><button type="button" aria-pressed={selectedTime === startsAt} disabled={booking} onClick={() => { setTime(startsAt); setBookingError(""); }}>{clock.format(new Date(startsAt))}</button>{!native && selectedTime === startsAt && <button type="button" className={styles.confirm} disabled={booking} onClick={() => void confirm(startsAt)}>{booking ? "Confirmando…" : rescheduling ? "Trocar horário" : "Confirmar"}</button>}</div>
          {native && selectedTime === startsAt && <form className={styles.nativeConfirmation} method="post" onSubmit={confirmNative}><h4>Confirme o horário de {clock.format(new Date(startsAt))}</h4><p>Use o nome e o WhatsApp do formulário da Meta.</p><label>Nome completo<input name="name" autoComplete="name" minLength={3} maxLength={200} required /></label><label>WhatsApp com DDD<input name="phone" type="tel" autoComplete="tel" minLength={10} maxLength={25} required /></label>{bookingError && <p className={styles.error} role="alert">{bookingError}</p>}<button type="submit" className={styles.confirm} disabled={booking}>{booking ? "Confirmando…" : "Confirmar agendamento"}</button></form>}</Fragment>)}{bookingError && (!native || !selectedTime) && <p className={styles.error} role="alert">{bookingError}</p>}</div>
      </div>}
    </section>
  </div></main>;
}
