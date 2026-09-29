"use client";

import { FormEvent, useMemo, useState } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { SectionHeader, Surface } from "@/components/ui/surface";
import { parseCsv } from "@/modules/leads/domain/csv-parser";

type EntryOptions = Readonly<{
  timeZone: string;
  sources: readonly Readonly<{ key: string; name: string; type: string }>[];
  campaigns: readonly Readonly<{
    externalRef: string;
    name: string;
    creatives: readonly Readonly<{ externalRef: string; name: string }>[];
  }>[];
  priorityBands: readonly Readonly<{
    code: "P1" | "P2" | "P3";
    name: string;
    scoreMin: number;
    scoreMax: number;
    slaPolicy: Readonly<{
      name: string;
      firstResponseMinutes: number;
      healthyMaxSeconds: number;
      attentionMaxSeconds: number;
    }>;
  }>[];
}>;

type ApiError = { error?: { message?: string }; result?: { issues?: Array<{ message: string }> } };
type ResultState = { kind: "success" | "error"; title: string; body: unknown } | null;

type CsvPreview = Readonly<{
  counts: Readonly<{ total: number; valid: number; invalid: number; duplicate: number }>;
  rows: readonly Readonly<{
    rowNumber: number;
    status: "VALID" | "DUPLICATE" | "INVALID";
    normalizedPhone: string | null;
    issues: readonly Readonly<{ field: string; message: string }>[];
  }>[];
}>;

function importedJob(body: unknown): { id: string; failedRows: number } | null {
  if (!body || typeof body !== "object" || !("job" in body)) return null;
  const job = body.job;
  if (
    !job ||
    typeof job !== "object" ||
    !("id" in job) ||
    typeof job.id !== "string" ||
    !("failedRows" in job) ||
    typeof job.failedRows !== "number"
  ) {
    return null;
  }
  return { id: job.id, failedRows: job.failedRows };
}

const inputClass =
  "mt-1.5 h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring";
const textareaClass =
  "mt-1.5 min-h-24 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring";

const mappingFields = [
  ["fullName", "Nome *"],
  ["phone", "Telefone *"],
  ["email", "E-mail"],
  ["jobTitle", "Cargo/atuação"],
  ["organizationName", "Organização"],
  ["city", "Cidade"],
  ["stateCode", "UF"],
  ["interestSummary", "Dor/interesse"],
  ["budgetBrl", "Orçamento em reais"],
  ["sourceKey", "Chave da origem"],
  ["campaignExternalRef", "Referência da campanha"],
  ["creativeExternalRef", "Referência do criativo"],
  ["consent", "Consentimento"],
  ["doNotContact", "Não contatar"],
  ["priorityBandCode", "Prioridade"],
] as const;

type MappingKey = (typeof mappingFields)[number][0];
type CsvMapping = Record<MappingKey, string | undefined>;

async function readResponse(response: Response) {
  const body = (await response.json().catch(() => ({}))) as ApiError & Record<string, unknown>;
  if (!response.ok) {
    const issues = body.result?.issues?.map((issue) => issue.message).join(" ");
    throw new Error(issues || body.error?.message || "Não foi possível concluir a operação.");
  }
  return body;
}

function formValue(form: FormData, name: string): string | undefined {
  const value = String(form.get(name) ?? "").trim();
  return value || undefined;
}

function leadFromForm(form: FormData) {
  const consent = formValue(form, "consent");
  return {
    fullName: formValue(form, "fullName"),
    phone: formValue(form, "phone"),
    email: formValue(form, "email"),
    jobTitle: formValue(form, "jobTitle"),
    organizationName: formValue(form, "organizationName"),
    city: formValue(form, "city"),
    stateCode: formValue(form, "stateCode"),
    interestSummary: formValue(form, "interestSummary"),
    budgetBrl: formValue(form, "budgetBrl"),
    sourceKey: formValue(form, "sourceKey"),
    campaignExternalRef: formValue(form, "campaignExternalRef"),
    creativeExternalRef: formValue(form, "creativeExternalRef"),
    ...(consent === "granted" ? { consent: true } : consent === "denied" ? { consent: false } : {}),
    doNotContact: form.get("doNotContact") === "on",
    priorityBandCode: formValue(form, "priorityBandCode"),
  };
}

function ResultPanel({ state }: { state: ResultState }) {
  if (!state) return null;
  const leadId = findLeadId(state.body);
  return (
    <section
      className={`mt-5 rounded-md border p-4 text-sm ${
        state.kind === "error"
          ? "border-red-300 bg-red-50 text-red-900"
          : "border-emerald-300 bg-emerald-50 text-emerald-950"
      }`}
      role={state.kind === "error" ? "alert" : "status"}
    >
      <h3 className="font-semibold">{state.title}</h3>
      {state.kind === "success" && leadId ? (
        <Link
          className="mt-2 inline-block font-medium underline"
          href={`/leads/${leadId}/historico`}
        >
          Abrir histórico operacional do lead
        </Link>
      ) : null}
      <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words text-xs leading-5">
        {JSON.stringify(state.body, null, 2)}
      </pre>
    </section>
  );
}

function findLeadId(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  if ("leadId" in value && typeof value.leadId === "string") {
    return value.leadId;
  }
  if ("result" in value) return findLeadId(value.result);
  if (Array.isArray(value)) {
    for (const item of value) {
      const leadId = findLeadId(item);
      if (leadId) return leadId;
    }
  }
  if ("results" in value && Array.isArray(value.results)) {
    return findLeadId(value.results);
  }
  return null;
}

function SourceFields({ options, prefix = "" }: { options: EntryOptions; prefix?: string }) {
  return (
    <>
      <label className="text-sm font-medium">
        Origem
        <select className={inputClass} defaultValue={options.sources[0]?.key} name={`${prefix}sourceKey`} required>
          {options.sources.map((source) => (
            <option key={source.key} value={source.key}>{source.name}</option>
          ))}
        </select>
      </label>
      <label className="text-sm font-medium">
        Campanha
        <select className={inputClass} defaultValue="" name={`${prefix}campaignExternalRef`}>
          <option value="">Sem campanha</option>
          {options.campaigns.map((campaign) => (
            <option key={campaign.externalRef} value={campaign.externalRef}>{campaign.name}</option>
          ))}
        </select>
      </label>
      <label className="text-sm font-medium">
        Criativo
        <select className={inputClass} defaultValue="" name={`${prefix}creativeExternalRef`}>
          <option value="">Sem criativo</option>
          {options.campaigns.flatMap((campaign) =>
            campaign.creatives.map((creative) => (
              <option key={`${campaign.externalRef}:${creative.externalRef}`} value={creative.externalRef}>
                {creative.name} · {campaign.name}
              </option>
            )),
          )}
        </select>
      </label>
    </>
  );
}

function ManualEntry({ options }: { options: EntryOptions }) {
  const [result, setResult] = useState<ResultState>(null);
  const [pending, setPending] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setPending(true);
    setResult(null);
    try {
      const form = new FormData(formElement);
      const response = await fetch("/api/leads/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idempotencyKey, lead: leadFromForm(form) }),
      });
      const body = await readResponse(response);
      setResult({ kind: "success", title: "Entrada processada", body: body.result });
      formElement.reset();
      setIdempotencyKey(crypto.randomUUID());
    } catch (error) {
      setResult({ kind: "error", title: "Revise os dados", body: error instanceof Error ? error.message : error });
    } finally {
      setPending(false);
    }
  }

  return (
    <Surface className="p-5">
      <SectionHeader description="Erros não limpam o formulário. Um novo envio bem-sucedido recebe uma nova chave idempotente." eyebrow="Entrada direta" title="Cadastro manual" />
      <form className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3" onSubmit={submit}>
        <label className="text-sm font-medium">Nome<input className={inputClass} name="fullName" required /></label>
        <label className="text-sm font-medium">Telefone<input className={inputClass} name="phone" placeholder="(11) 98765-4321" required /></label>
        <label className="text-sm font-medium">E-mail<input className={inputClass} name="email" type="email" /></label>
        <label className="text-sm font-medium">Cargo ou atuação<input className={inputClass} name="jobTitle" /></label>
        <label className="text-sm font-medium">Organização<input className={inputClass} name="organizationName" /></label>
        <label className="text-sm font-medium">Cidade<input className={inputClass} name="city" /></label>
        <label className="text-sm font-medium">UF<input className={inputClass} maxLength={2} name="stateCode" /></label>
        <label className="text-sm font-medium">Orçamento (R$)<input className={inputClass} inputMode="decimal" name="budgetBrl" placeholder="6500,00" /></label>
        <label className="text-sm font-medium">Prioridade<select className={inputClass} defaultValue="P3" name="priorityBandCode">{options.priorityBands.map((band) => <option key={band.code} value={band.code}>{band.name}</option>)}</select></label>
        <p className="self-end text-xs text-muted-foreground">
          A seleção é apenas um fallback técnico. Quando há regra de scoring ativa, a prioridade é calculada pelos dados informados e explicada no cartão do lead.
        </p>
        <SourceFields options={options} />
        <label className="text-sm font-medium md:col-span-2 xl:col-span-3">Dor ou interesse<textarea className={textareaClass} name="interestSummary" /></label>
        <label className="text-sm font-medium">Consentimento
          <select className={inputClass} defaultValue="unknown" name="consent">
            <option value="unknown">Não informado</option>
            <option value="granted">Consentimento informado</option>
            <option value="denied">Consentimento negado</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm"><input name="doNotContact" type="checkbox" /> Não contatar</label>
        <div className="md:col-span-2 xl:col-span-3"><Button disabled={pending} type="submit">{pending ? "Processando…" : "Cadastrar lead"}</Button></div>
      </form>
      <ResultPanel state={result} />
    </Surface>
  );
}

function autoMapping(headers: readonly string[]): CsvMapping {
  const aliases: Record<MappingKey, readonly string[]> = {
    fullName: ["nome", "name", "full_name"], phone: ["telefone", "phone", "celular"],
    email: ["email", "e-mail"], jobTitle: ["cargo", "atuacao", "atuação"],
    organizationName: ["organizacao", "organização", "empresa"], city: ["cidade"],
    stateCode: ["uf", "estado"], interestSummary: ["dor", "interesse"],
    budgetBrl: ["orcamento", "orçamento", "capacidade"], sourceKey: ["origem", "source"],
    campaignExternalRef: ["campanha"], creativeExternalRef: ["criativo"],
    consent: ["consentimento"], doNotContact: ["nao_contatar", "não_contatar"],
    priorityBandCode: ["prioridade", "priority"],
  };
  return Object.fromEntries(mappingFields.map(([key]) => [key, headers.find((header) => aliases[key].includes(header.toLocaleLowerCase("pt-BR")))])) as CsvMapping;
}

function CsvImport({ options }: { options: EntryOptions }) {
  const [fileName, setFileName] = useState("");
  const [content, setContent] = useState("");
  const [headers, setHeaders] = useState<readonly string[]>([]);
  const [mapping, setMapping] = useState<CsvMapping>({ fullName: undefined, phone: undefined } as CsvMapping);
  const [preview, setPreview] = useState<CsvPreview | null>(null);
  const [result, setResult] = useState<ResultState>(null);
  const [pending, setPending] = useState(false);
  const [defaults, setDefaults] = useState({ sourceKey: options.sources[0]?.key ?? "", campaignExternalRef: "", creativeExternalRef: "", priorityBandCode: "P3" });

  async function selectFile(file: File | undefined) {
    setPreview(null);
    setResult(null);
    if (!file) return;
    try {
      const text = await file.text();
      const table = parseCsv(text);
      setFileName(file.name);
      setContent(text);
      setHeaders(table.headers);
      setMapping(autoMapping(table.headers));
    } catch (error) {
      setResult({ kind: "error", title: "CSV inválido", body: error instanceof Error ? error.message : error });
    }
  }

  const requestBody = useMemo(() => ({ fileName, content, mapping, defaults }), [fileName, content, mapping, defaults]);

  async function requestPreview() {
    setPending(true); setResult(null);
    try {
      const response = await fetch("/api/leads/imports/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(requestBody) });
      const body = await readResponse(response);
      setPreview(body.preview as CsvPreview);
    } catch (error) {
      setResult({ kind: "error", title: "Não foi possível gerar o preview", body: error instanceof Error ? error.message : error });
    } finally { setPending(false); }
  }

  async function confirmImport() {
    if (!preview) return;
    if (preview.counts.invalid > 0 && !window.confirm(`${preview.counts.invalid} linha(s) inválida(s) serão rejeitadas e constarão no relatório. Importar as demais?`)) return;
    setPending(true); setResult(null);
    try {
      const response = await fetch("/api/leads/imports", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(requestBody) });
      const body = await readResponse(response);
      setResult({ kind: "success", title: "Importação concluída", body });
    } catch (error) {
      setResult({ kind: "error", title: "Falha na importação", body: error instanceof Error ? error.message : error });
    } finally { setPending(false); }
  }

  const job = result?.kind === "success" ? importedJob(result.body) : null;

  return (
    <Surface className="p-5" tone="subtle">
      <SectionHeader description="Limite local: 2 MiB e 2.000 linhas. O preview não grava leads." eyebrow="Entrada em lote" title="Importação por CSV" />
      <label className="mt-4 grid gap-1 text-sm font-medium">Arquivo CSV<input accept=".csv,text/csv" className={`${inputClass} mt-0 pt-2`} onChange={(event) => void selectFile(event.target.files?.[0])} type="file" /></label>
      {headers.length ? (
        <div className="mt-5">
          <h3 className="font-semibold">Mapeamento de colunas</h3>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            {mappingFields.map(([key, label]) => (
              <label className="text-sm" key={key}>{label}<select className={inputClass} onChange={(event) => { setMapping((current) => ({ ...current, [key]: event.target.value || undefined })); setPreview(null); }} value={mapping[key] ?? ""}><option value="">Não mapear</option>{headers.map((header) => <option key={header} value={header}>{header}</option>)}</select></label>
            ))}
            <label className="text-sm">Origem padrão<select className={inputClass} onChange={(event) => { setDefaults((current) => ({ ...current, sourceKey: event.target.value })); setPreview(null); }} value={defaults.sourceKey}>{options.sources.map((source) => <option key={source.key} value={source.key}>{source.name}</option>)}</select></label>
            <label className="text-sm">Prioridade padrão<select className={inputClass} onChange={(event) => { setDefaults((current) => ({ ...current, priorityBandCode: event.target.value })); setPreview(null); }} value={defaults.priorityBandCode}>{options.priorityBands.map((band) => <option key={band.code} value={band.code}>{band.code}</option>)}</select></label>
          </div>
          <div className="mt-4 flex gap-3"><Button disabled={pending || !mapping.fullName || !mapping.phone} onClick={() => void requestPreview()} type="button">{pending ? "Validando…" : "Gerar preview"}</Button>{preview ? <Button disabled={pending} onClick={() => void confirmImport()} type="button" variant="secondary">Confirmar importação</Button> : null}</div>
        </div>
      ) : null}
      {preview ? (
        <div className="mt-5 overflow-x-auto rounded-md border p-4">
          <p className="text-sm font-semibold">{preview.counts.total} linhas · {preview.counts.valid} válidas · {preview.counts.duplicate} duplicadas · {preview.counts.invalid} inválidas</p>
          <table className="mt-3 w-full text-left text-xs"><thead><tr><th className="py-2">Linha</th><th>Status</th><th>Telefone normalizado</th><th>Erros</th></tr></thead><tbody>{preview.rows.slice(0, 100).map((row) => <tr className="border-t" key={row.rowNumber}><td className="py-2">{row.rowNumber}</td><td>{row.status}</td><td>{row.normalizedPhone ?? "—"}</td><td>{row.issues.map((issue) => issue.message).join(" ") || "—"}</td></tr>)}</tbody></table>
          {preview.rows.length > 100 ? <p className="mt-2 text-xs text-muted-foreground">Preview visual limitado às primeiras 100 linhas; todas serão processadas pelo servidor.</p> : null}
        </div>
      ) : null}
      {job && job.failedRows > 0 ? <a className="mt-4 inline-block text-sm font-medium underline" href={`/api/leads/imports/${job.id}/errors`}>Baixar relatório de erros</a> : null}
      <ResultPanel state={result} />
    </Surface>
  );
}

function WebhookLocal({ options, initialEventId }: { options: EntryOptions; initialEventId: string }) {
  const [payload, setPayload] = useState(() => JSON.stringify({ eventId: initialEventId, eventType: "lead.received", lead: { fullName: "Lead local de teste", phone: "+5511987654321", sourceKey: options.sources[0]?.key, priorityBandCode: "P2", interestSummary: "Payload fictício enviado pelo simulador local." } }, null, 2));
  const [result, setResult] = useState<ResultState>(null);
  const [pending, setPending] = useState(false);

  async function send() {
    setPending(true); setResult(null);
    try {
      const response = await fetch("/api/local/webhooks/leads", { method: "POST", headers: { "Content-Type": "application/json" }, body: payload });
      const body = await readResponse(response);
      setResult({ kind: "success", title: "Evento local processado", body: body.result });
    } catch (error) {
      setResult({ kind: "error", title: "Webhook rejeitado", body: error instanceof Error ? error.message : error });
    } finally { setPending(false); }
  }

  return (
    <Surface className="p-5">
      <SectionHeader description="Exige sessão, mesma origem e host local. Não é uma integração externa." eyebrow="POST /api/local/webhooks/leads" title="Webhook local" />
      <label className="mt-4 block text-sm font-medium">Payload JSON<textarea className={`${textareaClass} min-h-64 font-mono text-xs`} onChange={(event) => setPayload(event.target.value)} value={payload} /></label>
      <Button className="mt-4" disabled={pending} onClick={() => void send()} type="button">{pending ? "Enviando…" : "Enviar evento local"}</Button>
      <ResultPanel state={result} />
    </Surface>
  );
}

function Simulator({ options }: { options: EntryOptions }) {
  const [result, setResult] = useState<ResultState>(null);
  const [pending, setPending] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true); setResult(null);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/leads/simulator", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scenario: formValue(form, "scenario"), count: Number(formValue(form, "count")), seed: formValue(form, "seed"), sourceKey: formValue(form, "sourceKey"), campaignExternalRef: formValue(form, "campaignExternalRef"), creativeExternalRef: formValue(form, "creativeExternalRef"), city: formValue(form, "city"), stateCode: formValue(form, "stateCode") }) });
      const body = await readResponse(response);
      setResult({ kind: "success", title: "Simulação concluída — dados fictícios", body: body.result });
    } catch (error) {
      setResult({ kind: "error", title: "Simulação rejeitada", body: error instanceof Error ? error.message : error });
    } finally { setPending(false); }
  }
  return (
    <Surface className="border-amber-300 bg-amber-50/50 p-5">
      <p className="text-xs font-bold uppercase tracking-wider text-amber-800">Simulação local — não representa dados reais</p>
      <h2 className="mt-1 text-xl font-semibold">Gerador controlado</h2>
      <form className="mt-5 grid gap-4 md:grid-cols-3" onSubmit={submit}>
        <label className="text-sm font-medium">Cenário<select className={inputClass} defaultValue="P1" name="scenario"><option>P1</option><option>P2</option><option>P3</option><option value="DUPLICATE">Duplicado</option></select></label>
        <label className="text-sm font-medium">Quantidade<input className={inputClass} defaultValue="1" max="20" min="1" name="count" type="number" /></label>
        <label className="text-sm font-medium">Semente reprodutível<input className={inputClass} defaultValue="demonstracao-crm07" name="seed" required /></label>
        <SourceFields options={options} />
        <label className="text-sm font-medium">Cidade<input className={inputClass} defaultValue="São Paulo" name="city" /></label>
        <label className="text-sm font-medium">UF<input className={inputClass} defaultValue="SP" maxLength={2} name="stateCode" /></label>
        <div className="md:col-span-3"><Button disabled={pending} type="submit">{pending ? "Gerando…" : "Simular chegada"}</Button></div>
      </form>
      <ResultPanel state={result} />
    </Surface>
  );
}

export function LeadEntryWorkspace({ options, initialWebhookEventId }: { options: EntryOptions; initialWebhookEventId: string }) {
  return (
    <div className="space-y-6">
      <Surface className="p-4 text-sm" tone="accent">
        <strong>Política ativa:</strong> {options.priorityBands[0]?.slaPolicy.name ?? "não configurada"}. Saudável até {options.priorityBands[0]?.slaPolicy.healthyMaxSeconds ?? "—"}s; atenção até {options.priorityBands[0]?.slaPolicy.attentionMaxSeconds ?? "—"}s; acima disso, crítico.
      </Surface>
      <ManualEntry options={options} />
      <CsvImport options={options} />
      <WebhookLocal initialEventId={initialWebhookEventId} options={options} />
      <Simulator options={options} />
    </div>
  );
}
