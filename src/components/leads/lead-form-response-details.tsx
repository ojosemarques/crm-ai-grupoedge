import type { MarketingFormResponseSummary } from "@/modules/marketing-forms/domain/marketing-form-response-summary";

function formatDate(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone,
  }).format(new Date(value));
}

export function LeadFormResponseDetails({
  responses,
  timeZone,
  compact = false,
}: Readonly<{
  responses: readonly MarketingFormResponseSummary[];
  timeZone: string;
  compact?: boolean;
}>) {
  if (responses.length === 0) return null;
  return (
    <div
      className={compact ? "mt-2 border-t pt-2 text-[9px]" : "min-w-72 text-xs"}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <details>
        <summary className="cursor-pointer font-semibold text-primary">
          {responses.length === 1 ? "Ver respostas do formulário" : `Ver ${responses.length} respostas do formulário`}
        </summary>
        <div className="mt-2 grid gap-3">
          {responses.map((response) => (
            <section className="grid gap-1 rounded-md border bg-muted/20 p-2" key={response.receiptId}>
              <p className="font-semibold">{response.formName} · {formatDate(response.submittedAt, timeZone)}</p>
              {response.answers.map((answer) => (
                <div className="grid gap-0.5" key={answer.questionKey}>
                  <span className="text-muted-foreground">{answer.question}</span>
                  <span className="whitespace-pre-wrap break-words text-foreground">{answer.displayValue || "—"}</span>
                </div>
              ))}
            </section>
          ))}
        </div>
      </details>
    </div>
  );
}
