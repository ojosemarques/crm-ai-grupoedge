"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { PUBLIC_AGENDA_MINUTES, PUBLIC_AGENDA_TITLE, PUBLIC_AGENDA_ZONE } from "@/modules/marketing-forms/domain/public-agenda";
import mark from "../../../../../public/brand/politizai-mark.png";
import styles from "./agenda.module.css";

type ConfirmationRedirect = { kind: "WHATSAPP" | "URL"; url: string };

type Availability = { today: string; days: string[]; booked: boolean; redirect?: ConfirmationRedirect; slots: { day: string; startsAt: string }[] };

const dateLabel = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" });
const monthLabel = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", month: "long", year: "numeric" });
const clock = new Intl.DateTimeFormat("pt-BR", { timeZone: PUBLIC_AGENDA_ZONE, hour: "2-digit", minute: "2-digit" });
const weekdays = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function asDay(day: string) { return new Date(`${day}T00:00:00Z`); }

function Icon({ name }: { name: "clock" | "phone" | "globe" }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    {name === "clock" ? <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>
      : name === "phone" ? <path d="M7 3H4a1 1 0 0 0-1 1 17 17 0 0 0 17 17 1 1 0 0 0 1-1v-3l-5-2-2 2a13 13 0 0 1-7-7l2-2-2-5Z" />
        : <><circle cx="12" cy="12" r="9" /><ellipse cx="12" cy="12" rx="4" ry="9" /><path d="M3 12h18M5 7h14M5 17h14" /></>}
  </svg>;
}

export function AgendaPicker({ receipt }: { receipt: string }) {
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [selectedDay, setDay] = useState<string | null>(null);
  const [shownMonth, setMonth] = useState<string | null>(null);
  const [selectedTime, setTime] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [loadError, setLoadError] = useState("");
  const [bookingError, setBookingError] = useState("");
  const [booking, setBooking] = useState(false);
  const [booked, setBooked] = useState(false);
  const [redirect, setRedirect] = useState<ConfirmationRedirect | null>(null);
  const [confirmedTime, setConfirmedTime] = useState<string | null>(null);
  const endpoint = `/api/public/agenda/${encodeURIComponent(receipt)}`;

  useEffect(() => {
    const controller = new AbortController();
    fetch(endpoint, { signal: controller.signal, cache: "no-store" }).then(async (response) => {
      if (!response.ok) throw new Error(response.status === 404 ? "Este link de agendamento não está disponível." : "Não foi possível carregar os horários.");
      const data: Availability = await response.json();
      if (controller.signal.aborted) return;
      setAvailability(data);
      setDay((day) => day && data.days.includes(day) ? day : data.today);
      setMonth((month) => month && data.days.some((day) => day.startsWith(month)) ? month : data.today.slice(0, 7));
      setBooked(data.booked);
      setRedirect(data.redirect ?? null);
      setLoadError("");
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setLoadError(error instanceof Error ? error.message : "Não foi possível carregar os horários.");
    });
    return () => controller.abort();
  }, [endpoint, revision]);

  useEffect(() => {
    if (!redirect) return;
    const timer = window.setTimeout(() => {
      try {
        (window.top ?? window).location.href = redirect.url;
      } catch {
        // An embedded form may be prevented from navigating the parent page.
      }
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [redirect]);

  async function confirm(time: string) {
    setBooking(true);
    setBookingError("");
    try {
      const response = await fetch(endpoint, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startsAt: time }),
      });
      if (!response.ok) {
        if (response.status === 409) {
          setTime(null);
          setRevision((value) => value + 1);
          setBookingError("Este horário não está mais disponível. Escolha outro.");
        } else {
          setBookingError(response.status === 404 ? "Este link de agendamento não está disponível." : "Não foi possível confirmar. Tente novamente.");
        }
        return;
      }
      const result: { startsAt?: string; redirect?: ConfirmationRedirect } = await response.json();
      setConfirmedTime(result.startsAt ?? null);
      setBooked(true);
      setRedirect(result.redirect ?? null);
    } catch {
      setBookingError("Não foi possível confirmar. Tente novamente.");
    } finally {
      setBooking(false);
    }
  }

  const monthStart = shownMonth ? asDay(`${shownMonth}-01`) : null;
  const numberOfDays = monthStart ? new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 0)).getUTCDate() : 0;
  const months = [...new Set(availability?.days.map((day) => day.slice(0, 7)))];
  const monthIndex = shownMonth ? months.indexOf(shownMonth) : -1;
  const times = availability?.slots.filter(({ day }) => day === selectedDay) ?? [];

  return <main className={styles.shell}>
    <div className={styles.card}>
      <aside className={styles.summary} aria-label="Sobre a reunião">
        <div className={styles.brand}><Image src={mark} width={120} height={120} alt="Politizai" priority unoptimized /></div>
        <div className={styles.details}>
          <p className={styles.host}>Equipe Politizai</p>
          <h1>{PUBLIC_AGENDA_TITLE}</h1>
          <p className={styles.fact}><Icon name="clock" /> {PUBLIC_AGENDA_MINUTES} min</p>
          <p className={styles.fact}><Icon name="phone" /> Conversa com um especialista</p>
          <p className={styles.description}>Vamos conhecer suas necessidades e mostrar como a Politizai pode ajudar. Não é preciso preparar nada para a conversa.</p>
        </div>
      </aside>
      <section className={styles.scheduler} aria-label="Agendamento">
        {booked ? <div className={styles.success} role="status">
          <span aria-hidden="true">✓</span>
          <h2>Reunião agendada</h2>
          <p>{confirmedTime && selectedDay
            ? `${dateLabel.format(asDay(selectedDay))}, às ${clock.format(new Date(confirmedTime))} (horário de Brasília).`
            : "Já existe uma reunião para este cadastro."}</p>
          {redirect && <a className={styles.continue} href={redirect.url} target="_blank" rel="noopener noreferrer">
            {redirect.kind === "WHATSAPP" ? "Abrir WhatsApp" : "Continuar para o link"}
          </a>}
        </div> : <>
          <h2>Selecione uma data e horário</h2>
          {loadError ? <div role="alert"><p>{loadError}</p><button type="button" onClick={() => { setLoadError(""); setRevision((value) => value + 1); }}>Tentar novamente</button></div>
            : !availability || !monthStart ? <p role="status">Carregando horários…</p>
              : <div className={styles.picker}>
                <div className={styles.calendar}>
                  <div className={styles.month}>
                    <button type="button" aria-label="Mês anterior" disabled={booking || monthIndex <= 0} onClick={() => setMonth(months[monthIndex - 1]!)}>‹</button>
                    <strong>{monthLabel.format(monthStart)}</strong>
                    <button type="button" aria-label="Próximo mês" disabled={booking || monthIndex >= months.length - 1} onClick={() => setMonth(months[monthIndex + 1]!)}>›</button>
                  </div>
                  <div className={styles.grid}>
                    {weekdays.map((day) => <span className={styles.weekday} key={day}>{day}</span>)}
                    {Array.from({ length: monthStart.getUTCDay() }, (_, index) => <span key={`blank-${index}`} />)}
                    {Array.from({ length: numberOfDays }, (_, index) => {
                      const day = `${shownMonth}-${String(index + 1).padStart(2, "0")}`;
                      const inWindow = availability.days.includes(day);
                      const open = availability.slots.some((slot) => slot.day === day);
                      return <button type="button" key={day} aria-label={dateLabel.format(asDay(day))}
                        aria-current={day === availability.today ? "date" : undefined} aria-pressed={day === selectedDay}
                        disabled={!inWindow || booking} data-open={open}
                        onClick={() => { setDay(day); setTime(null); setBookingError(""); }}>
                        {index + 1}
                      </button>;
                    })}
                  </div>
                  <p className={styles.zone}><strong>Fuso horário</strong><span><Icon name="globe" /> Horário de Brasília</span></p>
                </div>
                <div className={styles.times} aria-label="Horários disponíveis">
                  {selectedDay && <h3>{dateLabel.format(asDay(selectedDay))}</h3>}
                  {!times.length && <p>Sem horários disponíveis neste dia.</p>}
                  {times.map(({ startsAt }) => <div className={styles.timeRow} key={startsAt}>
                    <button type="button" aria-pressed={selectedTime === startsAt} disabled={booking}
                      onClick={() => { setTime(startsAt); setBookingError(""); }}>{clock.format(new Date(startsAt))}</button>
                    {selectedTime === startsAt && <button type="button" className={styles.confirm} disabled={booking} onClick={() => void confirm(startsAt)}>
                      {booking ? "Confirmando…" : "Confirmar"}
                    </button>}
                  </div>)}
                  {bookingError && <p className={styles.error} role="alert">{bookingError}</p>}
                </div>
              </div>}
        </>}
      </section>
    </div>
  </main>;
}
