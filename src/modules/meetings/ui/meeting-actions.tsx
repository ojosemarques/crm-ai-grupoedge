"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import type { MeetingListItem } from "@/modules/meetings/domain/meeting-contracts";

type Action = "RESCHEDULE" | "CANCEL" | "ATTENDED" | "NO_SHOW" | "EDIT";
type Notice = Readonly<{ kind: "success" | "error"; message: string }>;

const inputClass = "mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm";

function localDateTimeInput(value: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

async function readResponse(response: Response) {
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = body && typeof body === "object" && "error" in body && typeof body.error === "object" && body.error && "message" in body.error
      ? String(body.error.message)
      : "Não foi possível alterar a reunião.";
    throw new Error(message);
  }
}

export function MeetingActions({
  meeting,
  onCommitted,
}: Readonly<{ meeting: MeetingListItem; onCommitted: () => Promise<void> }>) {
  const [action, setAction] = useState<Action | null>(null);
  const [editStatus, setEditStatus] = useState(meeting.status);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const active = meeting.status === "SCHEDULED" || meeting.status === "CONFIRMED";

  async function post(payload: Record<string, unknown>) {
    setPending(true);
    setNotice(null);
    try {
      const response = await fetch(`/api/meetings/${meeting.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, expectedRevision: meeting.revision }),
      });
      await readResponse(response);
      setAction(null);
      setNotice({ kind: "success", message: "Reunião atualizada com histórico preservado." });
      await onCommitted();
    } catch (error) {
      setNotice({ kind: "error", message: error instanceof Error ? error.message : "Falha inesperada." });
    } finally {
      setPending(false);
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!action) return;
    const data = new FormData(event.currentTarget);
    const common = { action };
    if (action === "EDIT") {
      await post({
        ...common,
        title: data.get("title"),
        startsAtLocal: data.get("startsAtLocal"),
        durationMinutes: Number(data.get("durationMinutes")),
        status: data.get("status"),
        observation: data.get("observation") || null,
        outcome: data.get("outcome") || null,
        reason: data.get("reason"),
      });
      return;
    }
    if (action === "RESCHEDULE") {
      await post({
        ...common,
        startsAtLocal: data.get("startsAtLocal"),
        durationMinutes: Number(data.get("durationMinutes")),
        reason: data.get("reason"),
      });
      return;
    }
    const nextAction = {
      title: data.get("nextActionTitle"),
      dueAtLocal: data.get("nextActionDueAtLocal"),
    };
    await post({
      ...common,
      ...(action === "ATTENDED"
        ? { outcome: data.get("outcome") }
        : { reason: data.get("reason") }),
      nextAction,
    });
  }

  if (!meeting.canWrite) return null;

  return (
    <div className="mt-3 border-t pt-3">
      <div className="flex flex-wrap gap-2">
        {active && meeting.status === "SCHEDULED" ? (
          <Button disabled={pending} onClick={() => void post({ action: "CONFIRM" })} size="sm" type="button">
            Confirmar
          </Button>
        ) : null}
        {active ? <>
          <Button disabled={pending} onClick={() => setAction("RESCHEDULE")} size="sm" type="button" variant="secondary">Remarcar</Button>
          <Button disabled={pending} onClick={() => setAction("CANCEL")} size="sm" type="button" variant="secondary">Cancelar</Button>
          <Button disabled={pending} onClick={() => setAction("ATTENDED")} size="sm" type="button" variant="secondary">Compareceu</Button>
          <Button disabled={pending} onClick={() => setAction("NO_SHOW")} size="sm" type="button" variant="secondary">No-show</Button>
        </> : null}
        <Button disabled={pending} onClick={() => { setEditStatus(meeting.status); setAction("EDIT"); }} size="sm" type="button" variant="secondary">Editar reunião</Button>
      </div>
      {action ? (
        <form className="mt-3 grid gap-3 rounded-md border bg-muted/40 p-3 sm:grid-cols-2" onSubmit={submit}>
          {action === "EDIT" ? (
            <>
              <label className="text-sm sm:col-span-2">Título<input className={inputClass} defaultValue={meeting.title} name="title" required /></label>
              <label className="text-sm">Status{active ? <input name="status" type="hidden" value={editStatus} /> : null}<select className={inputClass} disabled={active} name={active ? undefined : "status"} onChange={(event) => setEditStatus(event.target.value as typeof meeting.status)} value={editStatus}><option value="SCHEDULED">Agendada</option><option value="CONFIRMED">Confirmada</option><option value="COMPLETED">Realizada</option><option value="CANCELLED">Cancelada</option><option value="NO_SHOW">No-show</option></select></label>
              <label className="text-sm">Data e hora<input className={inputClass} defaultValue={localDateTimeInput(meeting.startsAt, meeting.timeZone)} name="startsAtLocal" required type="datetime-local" /></label>
              <label className="text-sm">Duração<select className={inputClass} defaultValue={meeting.durationMinutes} name="durationMinutes"><option value="30">30 minutos</option><option value="40">40 minutos</option></select></label>
              <label className="text-sm">Resultado ou motivo final<textarea className={inputClass} defaultValue={meeting.outcome ?? ""} minLength={3} name="outcome" required={editStatus === "COMPLETED" || editStatus === "NO_SHOW"} /></label>
              <label className="text-sm sm:col-span-2">Observação<textarea className={inputClass} defaultValue={meeting.observation ?? ""} name="observation" /></label>
              <label className="text-sm sm:col-span-2">Motivo da correção<textarea className={inputClass} minLength={3} name="reason" required /></label>
              <p className="text-xs text-muted-foreground sm:col-span-2">A alteração gera uma nova revisão e preserva o registro anterior no histórico.</p>
            </>
          ) : action === "RESCHEDULE" ? (
            <>
              <label className="text-sm">Nova data e hora<input className={inputClass} name="startsAtLocal" required type="datetime-local" /></label>
              <label className="text-sm">Duração<select className={inputClass} defaultValue="30" name="durationMinutes"><option value="30">30 minutos</option><option value="40">40 minutos</option></select></label>
              <label className="text-sm sm:col-span-2">Motivo<textarea className={inputClass} name="reason" required /></label>
            </>
          ) : (
            <>
              <label className="text-sm sm:col-span-2">{action === "ATTENDED" ? "Resultado" : "Motivo"}<textarea className={inputClass} name={action === "ATTENDED" ? "outcome" : "reason"} required /></label>
              <label className="text-sm">Próxima ação<input className={inputClass} name="nextActionTitle" required /></label>
              <label className="text-sm">Prazo da próxima ação<input className={inputClass} name="nextActionDueAtLocal" required type="datetime-local" /></label>
              <p className="text-xs text-muted-foreground sm:col-span-2">A próxima ação é explícita para que o lead não fique sem acompanhamento.</p>
            </>
          )}
          <div className="flex gap-2 sm:col-span-2">
            <Button disabled={pending} size="sm" type="submit">{pending ? "Salvando…" : action === "EDIT" ? "Salvar alterações" : "Confirmar ação"}</Button>
            <Button onClick={() => setAction(null)} size="sm" type="button" variant="secondary">Voltar</Button>
          </div>
        </form>
      ) : null}
      {notice ? <p className={`mt-2 text-sm ${notice.kind === "error" ? "text-red-700" : "text-emerald-700"}`} role={notice.kind === "error" ? "alert" : "status"}>{notice.message}</p> : null}
    </div>
  );
}
