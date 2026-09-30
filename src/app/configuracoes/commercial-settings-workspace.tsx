"use client";

import { useState, type FormEvent } from "react";

import { AccessibleDialog } from "@/components/ui/accessible-dialog";
import { Icon, type IconName } from "@/components/ui/icon";
import styles from "./settings-workspace.module.css";

import { Button } from "@/components/ui/button";
import type { CommercialSettingsScreen, SettingsPreview } from "@/modules/settings/domain/commercial-settings-contracts";

type PendingChange = Readonly<{ command: Record<string, unknown>; preview: SettingsPreview }>;
const inputClass = "mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm";
const sectionClass = `surface-panel ${styles.panel}`;
const settingSections: ReadonlyArray<{ key: string; label: string; detail: string; icon: IconName }> = [
  { key: "operation", label: "Operação", detail: "Qualificação e distribuição", icon: "equipe" },
  { key: "scoring", label: "Scoring e SLA", detail: "Prioridade e atendimento", icon: "tendencia" },
  { key: "catalog", label: "Catálogo comercial", detail: "Produtos, ofertas e motivos", icon: "vendas" },
  { key: "pipeline", label: "Pipelines e etapas", detail: "Jornada dos seus negócios", icon: "pipeline" },
];

function centsToReais(value: string) { return (Number(value) / 100).toFixed(2).replace(".", ","); }
function reaisToCents(value: FormDataEntryValue | null) {
  const normalized = String(value ?? "").trim().replace(/\./g, "").replace(",", ".");
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error("Informe um valor monetário válido.");
  return String(Math.round(parsed * 100));
}
function apiError(body: unknown, fallback: string) {
  if (body && typeof body === "object" && "error" in body && body.error && typeof body.error === "object" && "message" in body.error) return String(body.error.message);
  return fallback;
}

export function CommercialSettingsWorkspace({ initialScreen }: Readonly<{ initialScreen: CommercialSettingsScreen }>) {
  const [screen, setScreen] = useState(initialScreen);
  const [section, setSection] = useState("operation");
  const [pending, setPending] = useState<PendingChange | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function prepare(command: Record<string, unknown>) {
    setBusy(true); setNotice(null);
    try {
      const response = await fetch("/api/settings/commercial", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...command, confirmed: false }) });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok || !body || typeof body !== "object" || !("result" in body)) throw new Error(apiError(body, "Não foi possível calcular o impacto."));
      setPending({ command, preview: body.result as SettingsPreview });
    } catch (error) { setNotice(error instanceof Error ? error.message : "Falha inesperada."); }
    finally { setBusy(false); }
  }

  async function confirm() {
    if (!pending) return;
    setBusy(true); setNotice(null);
    try {
      const response = await fetch("/api/settings/commercial", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...pending.command, confirmed: true }) });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok || !body || typeof body !== "object" || !("result" in body)) throw new Error(apiError(body, "Não foi possível aplicar a alteração."));
      setScreen(body.result as CommercialSettingsScreen); setPending(null); setNotice("Configuração salva e auditada com sucesso.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Falha inesperada."); }
    finally { setBusy(false); }
  }

  function operationalSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    const max = String(data.get("maxOpenLeadsPerSdr") ?? "").trim();
    void prepare({ action: "SAVE_OPERATIONAL_POLICY", expectedRevision: screen.workspace.revision,
      pactoMinimumInvestigatedDimensions: Number(data.get("pactoMinimum")), defaultMeetingDurationMinutes: Number(data.get("meetingDuration")),
      distributionStrategy: "ROUND_ROBIN", maxOpenLeadsPerSdr: max ? Number(max) : null,
      leadStagnationDays: Number(data.get("stagnation")), leadWithoutActivityDays: Number(data.get("withoutActivity")),
      cadenceDayOffsets: String(data.get("cadence")).split(",").map((value) => Number(value.trim())), });
  }

  function scoringSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!screen.scoring) return; const data = new FormData(event.currentTarget);
    const number = (name: string) => Number(data.get(name));
    void prepare({ action: "SAVE_SCORING_SLA", expectedScoringVersion: screen.scoring.version,
      painMaxPoints: number("pain"), capacityMaxPoints: number("capacity"), decisionMaxPoints: number("decision"), intentMaxPoints: number("intent"), contextMaxPoints: number("context"),
      partialFactorBasisPoints: number("partial"), noCapacityPenalty: number("noCapacity"), noPainPenalty: number("noPain"), curiosityPenalty: number("curiosity"), invalidContactPenalty: number("invalidContact"), noDecisionAccessPenalty: number("noDecision"),
      capacityFullThresholdCents: reaisToCents(data.get("capacityThreshold")), p1Minimum: number("p1"), p2Minimum: number("p2"), healthyMaxSeconds: number("healthy"), attentionMaxSeconds: number("attention"), });
  }

  const band = screen.slaBands[0];
  return <div className={styles.workspace}>
    <nav aria-label="Seções de configuração" className={styles.navigation}><p>Workspace</p>{settingSections.map((item) => <button aria-current={section === item.key ? "page" : undefined} key={item.key} onClick={() => setSection(item.key)} type="button"><Icon name={item.icon} size={17} /><span>{item.label}<small>{item.detail}</small></span></button>)}</nav>
    <div className={styles.content}>
    {notice ? <div role="status" className="rounded-md border bg-muted px-4 py-3 text-sm">{notice}</div> : null}
    {pending ? <AccessibleDialog labelledBy="settings-confirm-title" busy={busy} onDismiss={() => setPending(null)}>
      <h2 id="settings-confirm-title" className="text-lg font-semibold">{pending.preview.title}</h2><p className="mt-2 text-sm text-muted-foreground">{pending.preview.summary}</p>
      {pending.preview.warnings.length ? <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">{pending.preview.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : null}
      {pending.preview.impacts.length ? <dl className="mt-4 grid gap-2 sm:grid-cols-2">{pending.preview.impacts.map((impact) => <div className="rounded border p-3" key={impact.key}><dt className="text-xs text-muted-foreground">{impact.label}</dt><dd className="mt-1 text-xl font-semibold">{impact.count}</dd></div>)}</dl> : <p className="mt-3 text-sm text-muted-foreground">Nenhum registro histórico será reescrito.</p>}
      <div className="mt-5 flex gap-3"><Button disabled={busy} onClick={() => void confirm()}>{busy ? "Salvando…" : "Confirmar alteração"}</Button><Button disabled={busy} variant="secondary" onClick={() => setPending(null)}>Cancelar</Button></div>
    </AccessibleDialog> : null}

    <div>
      <section className={sectionClass} hidden={section !== "operation"}><h2 className="text-xl font-semibold">Operação e qualificação</h2><p className="mt-1 text-sm text-muted-foreground">Revisão vigente {screen.workspace.revision}. Alterações criam nova versão.</p>
        <form key={screen.workspace.revision} className="mt-4 grid gap-4 sm:grid-cols-2" onSubmit={operationalSubmit}>
          <label className="text-sm">Mínimo PACTO<select className={inputClass} defaultValue={screen.workspace.pactoMinimumInvestigatedDimensions} name="pactoMinimum">{[1,2,3,4,5].map((n) => <option key={n} value={n}>{n} dimensões</option>)}</select></label>
          <label className="text-sm">Duração de reunião<select className={inputClass} defaultValue={screen.workspace.defaultMeetingDurationMinutes} name="meetingDuration"><option value="30">30 minutos</option><option value="40">40 minutos</option></select></label>
          <label className="text-sm">Máximo de leads abertos por SDR<input className={inputClass} defaultValue={screen.workspace.maxOpenLeadsPerSdr ?? ""} min="1" name="maxOpenLeadsPerSdr" placeholder="Sem limite" type="number" /></label>
          <label className="text-sm">Lead parado após (dias)<input className={inputClass} defaultValue={screen.workspace.leadStagnationDays} min="1" name="stagnation" required type="number" /></label>
          <label className="text-sm">Sem atividade após (dias)<input className={inputClass} defaultValue={screen.workspace.leadWithoutActivityDays} min="1" name="withoutActivity" required type="number" /></label>
          <label className="text-sm">Cadência em dias<input className={inputClass} defaultValue={screen.workspace.cadenceDayOffsets.join(", ")} name="cadence" required /></label>
          <p className="text-sm text-muted-foreground sm:col-span-2">Distribuição: round-robin. A Fila Geral continua sendo o fallback explícito.</p><Button disabled={busy} type="submit">Revisar impacto</Button>
        </form>
      </section>

      <section className={sectionClass} hidden={section !== "scoring"}><h2 className="text-xl font-semibold">Scoring e SLA</h2>{screen.scoring && band ? <form key={screen.scoring.version} className="mt-4 grid gap-3 sm:grid-cols-3" onSubmit={scoringSubmit}>
        {[["pain","Dor",screen.scoring.painMaxPoints],["capacity","Capacidade",screen.scoring.capacityMaxPoints],["decision","Decisor",screen.scoring.decisionMaxPoints],["intent","Intenção",screen.scoring.intentMaxPoints],["context","Contexto",screen.scoring.contextMaxPoints]].map(([name,label,value]) => <label className="text-sm" key={String(name)}>{label}<input className={inputClass} defaultValue={Number(value)} min="0" name={String(name)} type="number" /></label>)}
        <label className="text-sm">Fator parcial (basis points)<input className={inputClass} defaultValue={screen.scoring.partialFactorBasisPoints} name="partial" type="number" /></label>
        {[["noCapacity","Penalidade sem capacidade",screen.scoring.noCapacityPenalty],["noPain","Penalidade sem dor",screen.scoring.noPainPenalty],["curiosity","Penalidade curiosidade",screen.scoring.curiosityPenalty],["invalidContact","Contato inválido",screen.scoring.invalidContactPenalty],["noDecision","Sem acesso ao decisor",screen.scoring.noDecisionAccessPenalty]].map(([name,label,value]) => <label className="text-sm" key={String(name)}>{label}<input className={inputClass} defaultValue={Number(value)} min="0" name={String(name)} type="number" /></label>)}
        <label className="text-sm">Capacidade plena (R$)<input className={inputClass} defaultValue={centsToReais(screen.scoring.capacityFullThresholdCents)} name="capacityThreshold" /></label>
        <label className="text-sm">P1 a partir de<input className={inputClass} defaultValue={screen.scoring.p1Minimum} name="p1" type="number" /></label><label className="text-sm">P2 a partir de<input className={inputClass} defaultValue={screen.scoring.p2Minimum} name="p2" type="number" /></label>
        <label className="text-sm">Saudável até (s)<input className={inputClass} defaultValue={band.healthyMaxSeconds} name="healthy" type="number" /></label><label className="text-sm">Atenção até (s)<input className={inputClass} defaultValue={band.attentionMaxSeconds} name="attention" type="number" /></label>
        <p className="self-end text-sm font-medium">SLA imediato — 0 minutos</p><Button disabled={busy} type="submit">Revisar nova versão</Button>
      </form> : <p className="mt-4 text-sm text-muted-foreground">Nenhuma regra vigente. Execute o seed estrutural.</p>}</section>
    </div>

    <div hidden={section !== "catalog"}><CatalogEditor busy={busy} prepare={prepare} screen={screen} /></div>
    <div hidden={section !== "pipeline"}><PipelineEditor busy={busy} prepare={prepare} screen={screen} /></div>
  </div></div>;
}

function CatalogEditor({ busy, prepare, screen }: Readonly<{ busy: boolean; prepare: (command: Record<string, unknown>) => Promise<void>; screen: CommercialSettingsScreen }>) {
  const [productId, setProductId] = useState(""); const [templateId, setTemplateId] = useState("");
  const product = screen.products.find((item) => item.id === productId); const template = screen.offerTemplates.find((item) => item.id === templateId);
  function productSubmit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const data = new FormData(event.currentTarget); void prepare({ action: "SAVE_PRODUCT", id: product?.id ?? null, expectedUpdatedAt: product?.updatedAt ?? null, sku: data.get("sku"), name: data.get("name"), description: data.get("description") || null, listPriceCents: reaisToCents(data.get("price")) }); }
  function templateSubmit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const data = new FormData(event.currentTarget); void prepare({ action: "SAVE_OFFER_TEMPLATE", id: template?.id ?? null, expectedUpdatedAt: template?.updatedAt ?? null, productId: data.get("productId"), key: data.get("key"), name: data.get("name"), description: data.get("description") || null, priceCents: reaisToCents(data.get("price")), discountCents: reaisToCents(data.get("discount")), validDays: data.get("validDays") ? Number(data.get("validDays")) : null }); }
  return <div className="grid gap-6 xl:grid-cols-2">
    <section aria-label="Produtos" className={sectionClass}><h2 className="text-xl font-semibold">Produtos</h2><label className="mt-4 block text-sm">Editar item<select className={inputClass} value={productId} onChange={(event) => setProductId(event.target.value)}><option value="">Novo produto</option>{screen.products.map((item) => <option key={item.id} value={item.id}>{item.name}{item.active ? "" : " (inativo)"}</option>)}</select></label>
      <form key={product?.id ?? "new"} className="mt-4 grid gap-3" onSubmit={productSubmit}><label className="text-sm">SKU<input className={inputClass} defaultValue={product?.sku} name="sku" required /></label><label className="text-sm">Nome<input className={inputClass} defaultValue={product?.name} name="name" required /></label><label className="text-sm">Descrição<textarea className={inputClass} defaultValue={product?.description ?? ""} name="description" /></label><label className="text-sm">Preço de lista (R$)<input className={inputClass} defaultValue={product ? centsToReais(product.listPriceCents) : ""} name="price" required /></label><div className="flex flex-wrap gap-2"><Button disabled={busy} type="submit">Revisar {product ? "edição" : "criação"}</Button>{product ? <Button disabled={busy} type="button" variant="secondary" onClick={() => void prepare({ action: "SET_PRODUCT_ACTIVE", id: product.id, active: !product.active })}>{product.active ? "Inativar" : "Reativar"}</Button> : null}</div>{product ? <p className="text-xs text-muted-foreground">Em uso: {product.opportunitiesInUse} oportunidades e {product.offersInUse} propostas.</p> : null}</form>
    </section>
    <section className={sectionClass}><h2 className="text-xl font-semibold">Ofertas e planos</h2><label className="mt-4 block text-sm">Editar item<select className={inputClass} value={templateId} onChange={(event) => setTemplateId(event.target.value)}><option value="">Nova oferta/plano</option>{screen.offerTemplates.map((item) => <option key={item.id} value={item.id}>{item.name}{item.active ? "" : " (inativa)"}</option>)}</select></label>
      {screen.products.length ? <form key={template?.id ?? "new"} className="mt-4 grid gap-3" onSubmit={templateSubmit}><label className="text-sm">Produto<select className={inputClass} defaultValue={template?.productId} name="productId" required><option value="">Selecione</option>{screen.products.filter((item) => item.active || item.id === template?.productId).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="text-sm">Chave<input className={inputClass} defaultValue={template?.key} name="key" required /></label><label className="text-sm">Nome<input className={inputClass} defaultValue={template?.name} name="name" required /></label><label className="text-sm">Descrição<textarea className={inputClass} defaultValue={template?.description ?? ""} name="description" /></label><div className="grid grid-cols-2 gap-3"><label className="text-sm">Preço (R$)<input className={inputClass} defaultValue={template ? centsToReais(template.priceCents) : ""} name="price" required /></label><label className="text-sm">Desconto (R$)<input className={inputClass} defaultValue={template ? centsToReais(template.discountCents) : "0,00"} name="discount" required /></label></div><label className="text-sm">Validade em dias<input className={inputClass} defaultValue={template?.validDays ?? ""} min="1" name="validDays" type="number" /></label><div className="flex gap-2"><Button disabled={busy} type="submit">Revisar {template ? "edição" : "criação"}</Button>{template ? <Button disabled={busy} type="button" variant="secondary" onClick={() => void prepare({ action: "SET_OFFER_TEMPLATE_ACTIVE", id: template.id, active: !template.active })}>{template.active ? "Inativar" : "Reativar"}</Button> : null}</div></form> : <p className="mt-4 text-sm text-muted-foreground">Cadastre um produto antes de criar ofertas.</p>}
    </section>
    <ReasonEditor busy={busy} label="Motivos de perda" prepare={prepare} reasonType="LOSS_REASON" rows={screen.lossReasons} />
    <ReasonEditor busy={busy} label="Motivos de desqualificação" prepare={prepare} reasonType="DISQUALIFICATION_REASON" rows={screen.disqualificationReasons} />
  </div>;
}

type ReasonRow = CommercialSettingsScreen["lossReasons"][number];
function ReasonEditor({ busy, label, prepare, reasonType, rows }: Readonly<{ busy: boolean; label: string; prepare: (command: Record<string, unknown>) => Promise<void>; reasonType: "LOSS_REASON" | "DISQUALIFICATION_REASON"; rows: readonly ReasonRow[] }>) {
  const [id, setId] = useState(""); const selected = rows.find((row) => row.id === id);
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const data = new FormData(event.currentTarget); void prepare({ action: "SAVE_REASON", reasonType, id: selected?.id ?? null, expectedUpdatedAt: selected?.updatedAt ?? null, key: data.get("key"), name: data.get("name"), position: Number(data.get("position")) }); }
  return <section className={sectionClass}><h2 className="text-xl font-semibold">{label}</h2><label className="mt-4 block text-sm">Editar motivo<select className={inputClass} value={id} onChange={(event) => setId(event.target.value)}><option value="">Novo motivo</option>{rows.map((row) => <option key={row.id} value={row.id}>{row.name}{row.active ? "" : " (inativo)"}</option>)}</select></label><form key={selected?.id ?? "new"} className="mt-4 grid gap-3" onSubmit={submit}><label className="text-sm">Chave<input className={inputClass} defaultValue={selected?.key} name="key" required /></label><label className="text-sm">Nome<input className={inputClass} defaultValue={selected?.name} name="name" required /></label><label className="text-sm">Posição<input className={inputClass} defaultValue={selected?.position ?? rows.length} min="0" name="position" type="number" /></label><div className="flex gap-2"><Button disabled={busy} type="submit">Revisar {selected ? "edição" : "criação"}</Button>{selected ? <Button disabled={busy} type="button" variant="secondary" onClick={() => void prepare({ action: "SET_REASON_ACTIVE", reasonType, id: selected.id, active: !selected.active })}>{selected.active ? "Inativar" : "Reativar"}</Button> : null}</div>{selected ? <p className="text-xs text-muted-foreground">{selected.recordsInUse} registros históricos vinculados.</p> : null}</form></section>;
}

function PipelineEditor({ busy, prepare, screen }: Readonly<{ busy: boolean; prepare: (command: Record<string, unknown>) => Promise<void>; screen: CommercialSettingsScreen }>) {
  const [pipelineId, setPipelineId] = useState(screen.pipelines[0]?.id ?? ""); const pipeline = screen.pipelines.find((item) => item.id === pipelineId);
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (!pipeline) return; const data = new FormData(event.currentTarget); void prepare({ action: "SAVE_PIPELINE", pipelineId: pipeline.id, expectedUpdatedAt: pipeline.updatedAt, name: data.get("name"), stages: pipeline.stages.map((stage) => ({ id: stage.id, name: data.get(`name:${stage.id}`), position: Number(data.get(`position:${stage.id}`)) })) }); }
  return <section className={sectionClass}><h2 className="text-xl font-semibold">Pipelines, etapas e transições</h2>{screen.pipelines.length ? <><label className="mt-4 block max-w-md text-sm">Pipeline<select className={inputClass} value={pipelineId} onChange={(event) => setPipelineId(event.target.value)}>{screen.pipelines.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.entityType === "LEAD" ? "pré-vendas" : "vendas"}</option>)}</select></label>{pipeline ? <div className="mt-5 grid gap-6 xl:grid-cols-2"><form key={pipeline.id + pipeline.updatedAt} className="grid gap-3" onSubmit={submit}><label className="text-sm">Nome do pipeline<input className={inputClass} defaultValue={pipeline.name} name="name" /></label>{pipeline.stages.map((stage) => <div className="grid grid-cols-[1fr_90px] gap-3" key={stage.id}><label className="text-sm">{stage.code}<input className={inputClass} defaultValue={stage.name} name={`name:${stage.id}`} /></label><label className="text-sm">Ordem<input className={inputClass} defaultValue={stage.position} min="0" name={`position:${stage.id}`} type="number" /></label></div>)}<Button disabled={busy} type="submit">Revisar nomes e ordem</Button></form><div><h3 className="font-semibold">Transições permitidas</h3><div className="mt-3 grid gap-2">{pipeline.transitions.map((transition) => <div className="flex items-center justify-between gap-3 rounded border p-3 text-sm" key={transition.id}><span>{transition.fromName} → {transition.toName}</span><Button disabled={busy} size="sm" type="button" variant="secondary" onClick={() => void prepare({ action: "SET_TRANSITION_ACTIVE", transitionId: transition.id, active: !transition.active })}>{transition.active ? "Bloquear" : "Permitir"}</Button></div>)}</div></div></div> : null}</> : <p className="mt-4 text-sm text-muted-foreground">Nenhum pipeline configurado.</p>}</section>;
}
