"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  pactoStatusLabels,
  pactoStatuses,
  type QualificationEvidenceOriginKey,
  type PactoDimensionView,
  type PactoQualificationView,
  type PactoStatusKey,
} from "@/modules/qualification/domain/pacto-contracts";

type EditableDimension = Readonly<{
  dimension: PactoDimensionView["dimension"];
  status: PactoStatusKey;
  note: string;
  evidence: string;
  origin: QualificationEvidenceOriginKey | "";
}>;

const inputClass =
  "mt-1.5 h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60";
const textareaClass =
  "mt-1.5 min-h-20 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60";

function editableDimensions(view: PactoQualificationView): EditableDimension[] {
  return view.dimensions.map((dimension) => ({
    dimension: dimension.dimension,
    status: dimension.status,
    note: dimension.note ?? "",
    evidence: dimension.evidence ?? "",
    origin:
      dimension.origin === "FORM" ||
      dimension.origin === "SDR" ||
      dimension.origin === "CLOSER" ||
      dimension.origin === "AI"
        ? dimension.origin
        : "",
  }));
}

function formatDate(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone,
  }).format(new Date(value));
}

async function responseResult(response: Response) {
  const body = (await response.json().catch(() => ({}))) as {
    result?: unknown;
    error?: { message?: string };
  };
  if (!response.ok) {
    throw new Error(body.error?.message ?? "Não foi possível salvar a qualificação.");
  }
  return body.result;
}

export function PactoWorkspace({
  initialPacto,
  onCommitted,
  onUpdated,
}: Readonly<{
  initialPacto: PactoQualificationView;
  onCommitted: () => Promise<void>;
  onUpdated: (pacto: PactoQualificationView) => void;
}>) {
  const [pacto, setPacto] = useState(initialPacto);
  const [dimensions, setDimensions] = useState(() => editableDimensions(initialPacto));
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<
    Readonly<{ kind: "success" | "error"; message: string }> | null
  >(null);

  function updateDimension(
    dimension: EditableDimension["dimension"],
    field: "status" | "note" | "evidence" | "origin",
    value: string,
  ) {
    setDimensions((current) =>
      current.map((item) =>
        item.dimension === dimension
          ? {
              ...item,
              [field]: value,
              ...(field === "status" && value === "UNKNOWN"
                ? { evidence: "", origin: "" }
                : {}),
            } as EditableDimension
          : item,
      ),
    );
  }

  async function refresh() {
    const response = await fetch(`/api/leads/${pacto.leadId}/qualification`, {
      cache: "no-store",
    });
    const result = (await responseResult(response)) as PactoQualificationView;
    setPacto(result);
    setDimensions(editableDimensions(result));
    onUpdated(result);
  }

  async function submit(action: "SAVE_DRAFT" | "VALIDATE") {
    setPending(true);
    setNotice(null);
    try {
      const response = await fetch(`/api/leads/${pacto.leadId}/qualification`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          data: {
            expectedRevision: pacto.revision,
            dimensions: dimensions.map((item) => ({
              dimension: item.dimension,
              status: item.status,
              note: item.note || null,
              evidence: item.evidence || null,
              origin: item.origin || null,
            })),
          },
        }),
      });
      await responseResult(response);
      await refresh();
      await onCommitted();
      setNotice({
        kind: "success",
        message:
          action === "VALIDATE"
            ? "PACTO validado com responsabilidade humana."
            : "Rascunho PACTO salvo; ele ainda não está validado.",
      });
    } catch (error) {
      setNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "Falha inesperada.",
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <div
      aria-labelledby="tab-pacto"
      className="space-y-6"
      id="panel-pacto"
      role="tabpanel"
    >
      <section className="surface-panel surface-panel--accent p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">Qualificação PACTO</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
              Ausência de dado significa “Não investigado”, nunca uma resposta negativa.
              Salvar rascunho não valida; a validação é uma ação humana explícita.
            </p>
          </div>
          <div className="rounded-md border px-3 py-2 text-sm">
            <p className="font-semibold">
              {pacto.investigatedDimensions} de {pacto.minimumRequiredDimensions} dimensões mínimas
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {pacto.aggregateStatus === "COMPLETED"
                ? pacto.isQualificationReady
                  ? "Validado e apto à qualificação"
                  : "Validado, mas há dimensão desqualificante"
                : pacto.aggregateStatus === "IN_PROGRESS"
                  ? "Rascunho em andamento"
                  : "Ainda não iniciado"}
            </p>
            <progress
              aria-label={`${pacto.investigatedDimensions} de ${pacto.dimensions.length} dimensões PACTO investigadas`}
              aria-valuemax={pacto.dimensions.length}
              aria-valuemin={0}
              aria-valuenow={pacto.investigatedDimensions}
              className="pacto-progress mt-3"
              max={pacto.dimensions.length}
              value={pacto.investigatedDimensions}
            />
          </div>
        </div>

        {pacto.missingDimensions.length > 0 ? (
          <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
            <p className="font-semibold">Campos ainda não investigados</p>
            <p className="mt-1">
              {pacto.missingDimensions
                .map((dimension) => pacto.dimensions.find((item) => item.dimension === dimension)?.label)
                .join(", ")}
            </p>
          </div>
        ) : null}
        {pacto.validatedAt ? (
          <p className="mt-4 text-sm text-emerald-800">
            Validação mais recente por {pacto.validatedBy} em {formatDate(pacto.validatedAt, pacto.timeZone)}.
          </p>
        ) : null}
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        {pacto.dimensions.map((dimension, index) => {
          const editable = dimensions[index]!;
          const investigated = editable.status !== "UNKNOWN";
          return (
            <article className="pacto-dimension surface-panel p-5" data-pacto-status={editable.status} key={dimension.dimension}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold">{dimension.label}</h3>
                  <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{dimension.guidance}</p>
                </div>
                <span className="rounded-full border px-2.5 py-1 text-xs">
                  {pactoStatusLabels[editable.status]}
                </span>
              </div>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <label className="text-sm">
                  Status — {dimension.label}
                  <select
                    className={inputClass}
                    disabled={!pacto.canWrite || pending}
                    onChange={(event) =>
                      updateDimension(dimension.dimension, "status", event.target.value)
                    }
                    value={editable.status}
                  >
                    {pactoStatuses.map((status) => (
                      <option key={status} value={status}>{pactoStatusLabels[status]}</option>
                    ))}
                  </select>
                </label>
                <label className="text-sm">
                  Origem da evidência — {dimension.label}
                  <select
                    className={inputClass}
                    disabled={!pacto.canWrite || pending || !investigated}
                    onChange={(event) =>
                      updateDimension(dimension.dimension, "origin", event.target.value)
                    }
                    value={editable.origin}
                  >
                    <option value="">Selecione</option>
                    <option value="FORM">Formulário</option>
                    <option value="SDR">SDR</option>
                    <option value="CLOSER">Closer</option>
                    <option value="AI">IA (requer validação humana)</option>
                  </select>
                </label>
                <label className="text-sm md:col-span-2">
                  Evidência — {dimension.label}
                  <textarea
                    className={textareaClass}
                    disabled={!pacto.canWrite || pending || !investigated}
                    onChange={(event) =>
                      updateDimension(dimension.dimension, "evidence", event.target.value)
                    }
                    placeholder="Registre a evidência observável e, quando relevante, as palavras do lead."
                    value={editable.evidence}
                  />
                </label>
                <label className="text-sm md:col-span-2">
                  Nota de contexto — {dimension.label}
                  <textarea
                    className={textareaClass}
                    disabled={!pacto.canWrite || pending}
                    onChange={(event) =>
                      updateDimension(dimension.dimension, "note", event.target.value)
                    }
                    value={editable.note}
                  />
                </label>
              </div>
            </article>
          );
        })}
      </section>

      {notice ? (
        <div
          className={`rounded-md border p-3 text-sm ${notice.kind === "error" ? "border-red-300 bg-red-50 text-red-900" : "border-emerald-300 bg-emerald-50 text-emerald-950"}`}
          role={notice.kind === "error" ? "alert" : "status"}
        >
          {notice.message}
        </div>
      ) : null}

      <section className="surface-panel flex flex-wrap gap-3 p-5">
        {pacto.canWrite ? (
          <>
            <Button disabled={pending} onClick={() => void submit("SAVE_DRAFT")} type="button" variant="secondary">
              {pending ? "Salvando…" : "Salvar rascunho"}
            </Button>
            <Button disabled={pending} onClick={() => void submit("VALIDATE")} type="button">
              Validar PACTO
            </Button>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Seu perfil possui acesso somente para leitura desta qualificação.</p>
        )}
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <article className="surface-panel p-5">
          <h2 className="text-lg font-semibold">Pré-qualificação do formulário</h2>
          <p className="mt-1 text-sm text-muted-foreground">Sinal separado; não substitui a validação humana.</p>
          {pacto.formPrequalification.length === 0 ? (
            <p className="mt-4 rounded-md border border-dashed p-4 text-sm text-muted-foreground">Nenhum sinal estruturado do formulário foi registrado.</p>
          ) : (
            <ul className="mt-4 space-y-3">
              {pacto.formPrequalification.map((item) => (
                <li className="rounded-md border p-3 text-sm" key={item.id}>
                  <p className="font-medium">{item.label} · {pactoStatusLabels[item.status]}</p>
                  <p className="mt-1">{item.evidence}</p>
                </li>
              ))}
            </ul>
          )}
        </article>
        <article className="surface-panel bg-[var(--surface-subtle)] p-5">
          <h2 className="text-lg font-semibold">Sugestões da IA</h2>
          <p className="mt-1 text-sm text-muted-foreground">Local reservado para sugestão; nunca altera o status vigente.</p>
          {pacto.aiSuggestions.length === 0 ? (
            <p className="mt-4 rounded-md border border-dashed p-4 text-sm text-muted-foreground">Nenhuma sugestão de IA foi registrada.</p>
          ) : (
            <ul className="mt-4 space-y-3">
              {pacto.aiSuggestions.map((item) => (
                <li className="rounded-md border p-3 text-sm" key={item.id}>
                  <p className="font-medium">{item.label} · {pactoStatusLabels[item.status]}</p>
                  <p className="mt-1">{item.evidence}</p>
                </li>
              ))}
            </ul>
          )}
        </article>
      </section>

      <section className="surface-panel p-5">
        <h2 className="text-lg font-semibold">Histórico da qualificação</h2>
        <p className="mt-1 text-sm text-muted-foreground">Cada salvamento gera uma revisão; fatos anteriores não são apagados.</p>
        {pacto.history.length === 0 ? (
          <p className="mt-4 rounded-md border border-dashed p-4 text-sm text-muted-foreground">Nenhuma revisão de PACTO registrada.</p>
        ) : (
          <ol className="mt-4 space-y-3">
            {pacto.history.map((revision) => (
              <li className="rounded-md border p-4" key={revision.id}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold">Revisão {revision.revisionNumber} · {revision.kind === "VALIDATED" ? "Validada" : "Rascunho"}</p>
                  <span className="text-xs text-muted-foreground">{revision.createdBy} · {formatDate(revision.createdAt, pacto.timeZone)}</span>
                </div>
                <p className="mt-2 text-sm">{revision.investigatedDimensions} investigadas · prontidão: {revision.isQualificationReady ? "sim" : "não"}</p>
                <ul className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                  {revision.dimensions.map((item) => (
                    <li className="rounded border px-2 py-1" key={item.dimension}>{item.label}: {pactoStatusLabels[item.status]}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
