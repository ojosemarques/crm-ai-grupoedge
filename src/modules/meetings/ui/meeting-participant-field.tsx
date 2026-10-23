"use client";

import { useRef, useState } from "react";
import { MAX_MEETING_PARTICIPANTS } from "@/modules/meetings/domain/meeting-participants";

export function MeetingParticipantField({
  className,
  inputClassName,
  defaultEmails = [],
}: Readonly<{ className?: string | undefined; inputClassName: string; defaultEmails?: readonly string[] }>) {
  const [rows, setRows] = useState(() => (defaultEmails.length ? defaultEmails : [""]).map((email, id) => ({ id, email })));
  const nextId = useRef(rows.length);
  return (
    <fieldset className={className}>
      <legend>Convidados (opcional)</legend>
      {rows.map((row, index) => <div className="mt-2 flex items-end gap-2" key={row.id}>
      <label className="min-w-0 flex-1">{index === 0 ? "E-mail do participante (opcional)" : `E-mail do convidado ${index + 1}`}
      <input
        autoComplete="email"
        className={inputClassName}
        defaultValue={row.email}
        maxLength={320}
        name="participantEmail"
        placeholder="participante@exemplo.com"
        type="email"
      />
      </label>
      {rows.length > 1 ? <button aria-label={`Remover convidado ${index + 1}`} className="rounded-md border px-2 py-2 text-sm" onClick={() => setRows((current) => current.filter((item) => item.id !== row.id))} type="button">Remover</button> : null}
      </div>)}
      <button className="mt-2 rounded-md border px-3 py-2 text-sm" disabled={rows.length >= MAX_MEETING_PARTICIPANTS} onClick={() => {
        const id = nextId.current++;
        setRows((current) => [...current, { id, email: "" }]);
      }} type="button">Adicionar convidado</button>
      <span className="mt-1 block text-xs text-muted-foreground">
        Cada convidado receberá o convite e os lembretes pelo MillionSend: 3h, 1h,
        30 min antes e na hora. O Google Agenda também enviará o convite quando
        o responsável tiver a conta conectada.
      </span>
    </fieldset>
  );
}
