"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { parseWorkspaceLocalDateTime } from "@/shared/core/time/workspace-time";
import { AccessibleDialog } from "@/components/ui/accessible-dialog";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import styles from "./post-sales.module.css";

type FieldOptions = Readonly<{ minLength?: number; options?: readonly Readonly<{ value: string; label: string }>[] } & ({ type?: "date" | "number" } | { type: "datetime-local"; timeZone: string })>;
type Request = Readonly<{ kind: "prompt" | "confirm"; message: string; initial: string; key: number; field: FieldOptions }>;

export function usePostSalesActionDialog() {
  const [request, setRequest] = useState<Request | null>(null);
  const [error, setError] = useState<string | null>(null);
  const resolveRef = useRef<((value: string | null) => void) | null>(null);
  const sequence = useRef(0);
  const titleId = useId();
  const resolve = useCallback((value: string | null) => {
    const pending = resolveRef.current;
    resolveRef.current = null;
    setRequest(null);
    pending?.(value);
  }, []);
  useEffect(() => () => { resolveRef.current?.(null); }, []);

  function open(kind: Request["kind"], message: string, initial = "", field: FieldOptions = {}) {
    setError(null);
    return new Promise<string | null>((done) => {
      resolveRef.current?.(null);
      resolveRef.current = done;
      setRequest({ kind, message, initial, field, key: ++sequence.current });
    });
  }

  const dialog = request ? (
    <AccessibleDialog className="max-w-lg" key={request.key} labelledBy={titleId} onDismiss={() => resolve(null)}>
      <div className={styles.actionHeading}><span><Icon name="vendas" size={20} /></span><div><p>ATUALIZAR CLIENTE</p><h2 id={titleId}>{request.kind === "confirm" ? "Confirmar alteração" : "Registrar informação"}</h2></div></div>
      <form onSubmit={(event) => {
        event.preventDefault();
        const value = String(new FormData(event.currentTarget).get("answer") ?? "");
        if (request.kind === "confirm") { resolve("confirmed"); return; }
        if (request.field.type === "datetime-local") {
          try { resolve(parseWorkspaceLocalDateTime(value, request.field.timeZone).toISOString()); }
          catch (caught) { setError(caught instanceof Error ? caught.message : "Informe uma data válida."); }
        } else resolve(value);
      }}>
        {request.kind === "prompt" ? <label className={styles.actionField}>{request.message}{request.field.options ? <select autoFocus defaultValue={request.initial} name="answer" required>{request.field.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select> : request.field.type ? <input autoFocus defaultValue={request.initial} min={request.field.type === "number" ? "0" : undefined} name="answer" required step={request.field.type === "number" ? "1" : undefined} type={request.field.type} /> : <textarea autoFocus defaultValue={request.initial} minLength={request.field.minLength ?? 1} name="answer" required rows={3} />}</label> : <p className={styles.confirmMessage}>{request.message}</p>}
        {request.field.type === "datetime-local" ? <p className="mt-2 text-xs text-muted-foreground">Horário em {request.field.timeZone}.</p> : null}
        {error ? <p className="mt-2 text-sm text-danger" role="alert">{error}</p> : null}
        <div className={styles.dialogActions}><Button onClick={() => resolve(null)} type="button" variant="secondary">Cancelar</Button><Button type="submit">{request.kind === "confirm" ? "Confirmar" : "Continuar"}</Button></div>
      </form>
    </AccessibleDialog>
  ) : null;

  return { dialog, prompt: (message: string, initial = "", field: FieldOptions = {}) => open("prompt", message, initial, field), confirm: async (message: string) => (await open("confirm", message)) !== null };
}
