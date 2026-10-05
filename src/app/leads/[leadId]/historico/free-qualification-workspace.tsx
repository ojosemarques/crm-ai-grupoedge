"use client";

import { FormEvent, useState } from "react";

import { Button } from "@/components/ui/button";
import type { FreeQualificationScreen } from "@/modules/qualification/domain/free-qualification-contracts";

type Notice = Readonly<{ kind: "success" | "error"; message: string }> | null;

function formatDate(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone,
  }).format(new Date(value));
}

async function readResponse(response: Response) {
  const body = (await response.json().catch(() => ({}))) as {
    result?: FreeQualificationScreen;
    error?: { message?: string };
  };
  if (!response.ok || !body.result) {
    throw new Error(body.error?.message ?? "Não foi possível salvar a qualificação.");
  }
  return body.result;
}

export function FreeQualificationWorkspace({
  initialScreen,
  onCommitted,
}: Readonly<{
  initialScreen: FreeQualificationScreen;
  onCommitted?: () => void | Promise<void>;
}>) {
  const [screen, setScreen] = useState(initialScreen);
  const [content, setContent] = useState("");
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!content.trim()) {
      setNotice({ kind: "error", message: "Preencha a qualificação antes de salvar." });
      return;
    }
    setPending(true);
    setNotice(null);
    try {
      const response = await fetch(`/api/leads/${screen.leadId}/qualifications`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      const result = await readResponse(response);
      setScreen(result);
      setContent("");
      setNotice({ kind: "success", message: "Qualificação salva." });
      try {
        await onCommitted?.();
      } catch {
        setNotice({
          kind: "success",
          message: "Qualificação salva. Atualize o cartão para recarregar as demais informações.",
        });
      }
    } catch (error) {
      setNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "Não foi possível salvar a qualificação.",
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <section aria-labelledby="tab-qualification" className="space-y-5" id="panel-qualification" role="tabpanel">
      <article className="surface-panel p-5 sm:p-6">
        <div>
          <h2 className="text-lg font-semibold">Nova qualificação</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Registre livremente os detalhes do lead, da prospecção, dos retornos e dos próximos passos.
          </p>
        </div>

        {screen.canWrite ? (
          <form className="mt-5 space-y-3" onSubmit={submit}>
            <label className="block text-sm font-medium" htmlFor="free-qualification-content">
              Qualificação do lead
            </label>
            <textarea
              autoFocus
              className="min-h-44 w-full resize-y rounded-md border bg-background px-3 py-3 text-sm outline-none focus:ring-2 focus:ring-ring"
              id="free-qualification-content"
              maxLength={20_000}
              onChange={(event) => setContent(event.target.value)}
              placeholder="Escreva aqui tudo o que foi levantado sobre o lead, a prospecção, o retorno e o contexto comercial."
              required
              value={content}
            />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-xs text-muted-foreground">{content.length.toLocaleString("pt-BR")} / 20.000 caracteres</span>
              <Button disabled={pending || !content.trim()} type="submit">
                {pending ? "Salvando…" : "Salvar qualificação"}
              </Button>
            </div>
          </form>
        ) : (
          <p className="mt-5 rounded-md border border-dashed p-4 text-sm text-muted-foreground">
            Seu perfil possui acesso somente para leitura neste lead.
          </p>
        )}

        {notice ? (
          <p
            className={`mt-4 rounded-md border p-3 text-sm ${notice.kind === "error" ? "border-red-300 bg-red-50 text-red-900" : "border-emerald-300 bg-emerald-50 text-emerald-950"}`}
            role={notice.kind === "error" ? "alert" : "status"}
          >
            {notice.message}
          </p>
        ) : null}
      </article>

      <article className="surface-panel p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Qualificações salvas</h2>
            <p className="mt-1 text-sm text-muted-foreground">Histórico completo deste lead, da mais recente para a mais antiga.</p>
          </div>
          <span className="rounded-full border bg-muted/40 px-3 py-1 text-xs font-medium">
            {screen.entries.length} {screen.entries.length === 1 ? "registro" : "registros"}
          </span>
        </div>

        {screen.entries.length === 0 ? (
          <p className="mt-5 rounded-md border border-dashed p-5 text-sm text-muted-foreground">
            Nenhuma qualificação foi salva para este lead.
          </p>
        ) : (
          <ol className="mt-5 space-y-3">
            {screen.entries.map((entry) => (
              <li className="rounded-lg border bg-background p-4" key={entry.id}>
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{entry.createdBy}</span>
                  <time dateTime={entry.createdAt}>{formatDate(entry.createdAt, screen.timeZone)}</time>
                </div>
                <p className="mt-3 whitespace-pre-wrap text-sm leading-6">{entry.content}</p>
              </li>
            ))}
          </ol>
        )}
      </article>
    </section>
  );
}
