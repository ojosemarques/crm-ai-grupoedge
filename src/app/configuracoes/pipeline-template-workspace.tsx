"use client";

import { useEffect, useState, type FormEvent } from "react";

import { AccessibleDialog } from "@/components/ui/accessible-dialog";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

type Row = Readonly<Record<string, unknown>>;
type MigrationPreview = Readonly<{
  command: Record<string, unknown>;
  token: Row;
  title: string;
  summary: string;
  affectedCards: number;
  mappings: readonly Readonly<{ from: string; to: string; count: number }>[];
  warnings: readonly string[];
  rollbackAvailable: boolean;
}>;

const inputClass = "mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm";
const panelClass = "surface-panel p-5";

function object(value: unknown): Row { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Row : {}; }
function rows(value: unknown): readonly Row[] { return Array.isArray(value) ? value.map(object) : []; }
function text(value: unknown, fallback = ""): string { return typeof value === "string" ? value : fallback; }
function number(value: unknown, fallback = 0): number { return typeof value === "number" && Number.isFinite(value) ? value : fallback; }
function bool(value: unknown, fallback = false): boolean { return typeof value === "boolean" ? value : fallback; }
function id(row: Row): string { return text(row.id); }
function label(row: Row): string { return text(row.name, text(row.label, text(row.key, "Sem nome"))); }
function list(screen: Row, ...keys: string[]): readonly Row[] { for (const key of keys) { const value = rows(screen[key]); if (value.length) return value; } return []; }

async function request(command?: Record<string, unknown>, method: "POST" | "PATCH" = "POST") {
  const response = await fetch("/api/pipeline-templates", command ? {
    method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(command),
  } : { cache: "no-store" });
  const body: unknown = await response.json().catch(() => null);
  const envelope = object(body);
  if (!response.ok) {
    const error = object(envelope.error);
    throw new Error(text(error.message, "Não foi possível concluir a operação."));
  }
  return object(envelope.result);
}

function parsePreview(result: Row, command: Record<string, unknown>): MigrationPreview {
  const impacts = rows(result.impacts);
  const affectedCards = rows(result.affectedCards);
  const explicitMappings = rows(result.stageMappings ?? result.mappings).map((item) => ({
    from: text(item.fromName, text(item.sourceStageName, "Etapa atual")),
    to: text(item.toName, text(item.targetStageName, "Etapa de destino")),
    count: number(item.cardCount, number(item.count)),
  }));
  const grouped = new Map<string, { from: string; to: string; count: number }>();
  for (const card of affectedCards) {
    const key = `${text(card.oldStageId)}:${text(card.targetStableKey)}`;
    const current = grouped.get(key) ?? { from: text(card.oldStageName, text(card.oldStageId, "Etapa atual")), to: text(card.targetStageName, text(card.targetStableKey, "Destino")), count: 0 };
    current.count += 1; grouped.set(key, current);
  }
  const mappings = explicitMappings.length ? explicitMappings : [...grouped.values()];
  return {
    command,
    token: result,
    title: text(result.title, "Prévia da migração"),
    summary: text(result.summary, "Revise o mapeamento antes de migrar o pipeline."),
    affectedCards: affectedCards.length || number(result.cardCount, impacts.reduce((total, item) => total + number(item.count), 0)),
    mappings,
    warnings: Array.isArray(result.warnings) ? result.warnings.filter((item): item is string => typeof item === "string") : [],
    rollbackAvailable: bool(result.rollbackAvailable, true),
  };
}

export function PipelineTemplateWorkspace({ active }: Readonly<{ active: boolean }>) {
  const [screen, setScreen] = useState<Row>({});
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [notice, setNotice] = useState<string | null>(null);
  const [preview, setPreview] = useState<MigrationPreview | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [migrationPipelineId, setMigrationPipelineId] = useState("");
  const [bootstrapPipelineId, setBootstrapPipelineId] = useState("");
  const [selectedGroupId, setSelectedGroupId] = useState("");

  async function refresh() {
    setState("loading"); setNotice(null);
    try { setScreen(await request()); setState("ready"); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Falha inesperada."); setState("error"); }
  }
  useEffect(() => {
    if (!active || state !== "idle") return;
    let cancelled = false;
    void request().then((result) => { if (!cancelled) { setScreen(result); setState("ready"); } }, (error: unknown) => { if (!cancelled) { setNotice(error instanceof Error ? error.message : "Falha inesperada."); setState("error"); } });
    return () => { cancelled = true; };
  }, [active, state]);

  const templates = list(screen, "templates", "pipelineTemplates");
  const groupers = list(screen, "originGroups", "groupers", "groups");
  const origins = list(screen, "sources").length ? list(screen, "sources") : groupers.flatMap((group) => rows(group.sources));
  const pipelines = list(screen, "pipelines", "pipelineOptions");
  const history = list(screen, "migrations", "migrationHistory");
  const selected = templates.find((item) => id(item) === selectedTemplateId) ?? templates[0];
  const selectedVersion = object(selected?.latestVersion ?? rows(selected?.versions)[0]);
  const stages = rows(selectedVersion.stages ?? selected?.stages);
  const selectedGroup = groupers.find((item) => id(item) === selectedGroupId);
  const selectedGroupSourceIds = new Set(rows(selectedGroup?.sources).map(id));
  const migrationPipeline = pipelines.find((item) => id(item) === migrationPipelineId);
  const currentStages = rows(migrationPipeline?.stages);

  async function command(payload: Record<string, unknown>, success: string, method: "POST" | "PATCH" = "POST") {
    setState("loading"); setNotice(null);
    try { await request(payload, method); setScreen(await request()); setNotice(success); setState("ready"); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Falha inesperada."); setState("error"); }
  }

  function saveTemplate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    const stagePayload = stages.map((stage, position) => ({
      name: String(form.get(`stageName:${id(stage)}`) ?? label(stage)),
      position,
      type: text(stage.type, "OPEN"),
      requiredFields: String(form.get(`requiredFields:${id(stage)}`) ?? "").split(",").map((value) => value.trim()).filter(Boolean).map((fieldKey) => ({ fieldKey, label: fieldKey, offerTemplateId: String(form.get(`requiredOffer:${id(stage)}`) ?? "") || null })),
      activities: [{
        activityType: String(form.get(`activityType:${id(stage)}`) ?? "TASK"),
        title: `Atividade de ${String(form.get(`stageName:${id(stage)}`) ?? label(stage))}`,
        script: String(form.get(`activityScript:${id(stage)}`) ?? "").trim() || null,
        dueOffsetDays: Number(form.get(`activityDue:${id(stage)}`) ?? 1),
        position: 0,
        required: true,
      }],
      stableKey: text(stage.stableKey, id(stage)),
      leadStageCode: stage.leadStageCode,
      opportunityStageCode: stage.opportunityStageCode,
    }));
    void command({ action: "SAVE_TEMPLATE", templateId: selected ? id(selected) : undefined,
      expectedVersion: number(selectedVersion.version) || undefined, key: text(selected?.key) || undefined,
      name: form.get("name"), entityType: text(selected?.entityType, "OPPORTUNITY"),
      mode: form.get("scope") === "SHARED" ? "UPDATE_SHARED" : "SAVE_AS_NEW",
      changeReason: form.get("changeReason"), pipelineIds: form.getAll("pipelineIds").map(String), stages: stagePayload }, "Modelo salvo como nova revisão auditável.");
  }

  function copyTemplate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selected) return; const form = new FormData(event.currentTarget);
    const pipelineId = String(form.get("pipelineId") ?? "");
    const pipeline = pipelines.find((item) => id(item) === pipelineId);
    void command({ action: "COPY_TEMPLATE", sourceTemplateVersionId: id(selectedVersion), pipelineId,
      key: form.get("copyKey"), name: form.get("copyName"), changeReason: form.get("copyReason"), expectedRevision: number(object(pipeline?.application).revision) }, "Cópia local criada sem alterar o modelo compartilhado.");
  }

  async function previewMigration(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    const pipelineId = migrationPipelineId;
    const pipeline = pipelines.find((item) => id(item) === pipelineId);
    const mappings = Object.fromEntries(currentStages.map((stage) => [id(stage), String(form.get(`map:${id(stage)}`) ?? "")]));
    if (Object.values(mappings).some((target) => !target)) { setNotice("Mapeie todas as etapas. Cards nunca são excluídos durante a migração."); return; }
    const payload = { action: "PREVIEW_MIGRATION", expectedRevision: number(object(pipeline?.application).revision), pipelineId,
      toTemplateVersionId: id(selectedVersion), reason: form.get("reason"), stageMapping: mappings };
    setState("loading"); setNotice(null);
    try { setPreview(parsePreview(await request(payload), payload)); setState("ready"); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Falha inesperada."); setState("error"); }
  }

  async function applyMigration() {
    if (!preview) return;
    await command({ action: "APPLY_MIGRATION", expectedRevision: preview.command.expectedRevision,
      migrationId: preview.token.migrationId ?? preview.token.id }, "Migração aplicada. O histórico e o rollback foram preservados.");
    setPreview(null);
  }

  if ((state === "idle" || state === "loading") && Object.keys(screen).length === 0) return <section className={panelClass}><p className="text-sm text-muted-foreground">Carregando origens e modelos…</p></section>;
  if (state === "error" && Object.keys(screen).length === 0) return <section className={panelClass}><p role="alert" className="text-sm">{notice}</p><Button className="mt-4" onClick={() => void refresh()} variant="secondary">Tentar novamente</Button></section>;

  return <div className="grid gap-6">
    {notice ? <p className="feedback-banner rounded-md border p-3 text-sm" role="status">{notice}</p> : null}
    <section className={panelClass}>
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-semibold">Origens, agrupadores e modelos</h2><p className="mt-1 text-sm text-muted-foreground">Modelos compartilhados propagam revisões; cópias locais permanecem independentes.</p></div><Button disabled={state === "loading"} onClick={() => void refresh()} size="sm" variant="secondary">Atualizar</Button></div>
      <div className="mt-5 grid gap-3 md:grid-cols-3">
        <Summary title="Origens" rows={origins} empty="Nenhuma origem configurada" />
        <Summary title="Agrupadores" rows={groupers} empty="Nenhum agrupador configurado" />
        <Summary title="Modelos" rows={templates} empty="Nenhum modelo configurado" />
      </div>
      <div className="mt-5 grid gap-4 lg:grid-cols-2"><form className="rounded-md border bg-background p-4" key={selectedGroupId || "new-group"} onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void command({ action: "SAVE_ORIGIN_GROUP", id: selectedGroup ? id(selectedGroup) : null, name: form.get("name"), teamId: form.get("teamId") || null, sourceIds: form.getAll("sourceIds").map(String), active: form.get("active") === "on" }, "Agrupador de origens salvo."); }}><h3 className="font-medium">Criar ou editar agrupador</h3><label className="mt-3 block text-sm">Agrupador<select className={inputClass} value={selectedGroupId} onChange={(event) => setSelectedGroupId(event.target.value)}><option value="">Novo agrupador</option>{groupers.map((item) => <option key={id(item)} value={id(item)}>{label(item)}</option>)}</select></label><label className="mt-3 block text-sm">Nome<input className={inputClass} defaultValue={selectedGroup ? label(selectedGroup) : ""} name="name" required /></label><label className="mt-3 block text-sm">Equipe<select className={inputClass} defaultValue={text(selectedGroup?.teamId)} name="teamId"><option value="">Sem equipe exclusiva</option>{list(screen, "teams").map((item) => <option key={id(item)} value={id(item)}>{label(item)}</option>)}</select></label><fieldset className="mt-3"><legend className="text-sm">Origens</legend><div className="mt-2 grid gap-2 sm:grid-cols-2">{list(screen, "sources").map((item) => <label className="flex items-center gap-2 text-sm" key={id(item)}><input defaultChecked={selectedGroupSourceIds.has(id(item))} name="sourceIds" type="checkbox" value={id(item)} />{label(item)}</label>)}</div></fieldset><label className="mt-3 flex items-center gap-2 text-sm"><input defaultChecked={bool(selectedGroup?.active, true)} name="active" type="checkbox" />Agrupador ativo</label><Button className="mt-4" disabled={state === "loading"} type="submit" size="sm">Salvar agrupador</Button></form><form className="rounded-md border bg-background p-4" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void command({ action: "SAVE_ACCESS_RULE", id: null, sourceId: form.get("sourceId"), teamId: form.get("teamId"), canRead: form.get("canRead") === "on", canDistribute: form.get("canDistribute") === "on", canReassign: form.get("canReassign") === "on", canTransition: form.get("canTransition") === "on" }, "Permissões da origem salvas."); }}><h3 className="font-medium">Permissões por origem e equipe</h3><p className="mt-1 text-xs text-muted-foreground">Salvar novamente a mesma origem e equipe atualiza a regra vigente.</p><div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="text-sm">Origem<select className={inputClass} name="sourceId" required><option value="">Selecione</option>{list(screen, "sources").map((item) => <option key={id(item)} value={id(item)}>{label(item)}</option>)}</select></label><label className="text-sm">Equipe<select className={inputClass} name="teamId" required><option value="">Selecione</option>{list(screen, "teams").map((item) => <option key={id(item)} value={id(item)}>{label(item)}</option>)}</select></label></div><div className="mt-3 grid grid-cols-2 gap-2 text-sm"><label><input className="mr-2" defaultChecked name="canRead" type="checkbox" />Visualizar</label><label><input className="mr-2" name="canDistribute" type="checkbox" />Distribuir</label><label><input className="mr-2" name="canReassign" type="checkbox" />Reatribuir</label><label><input className="mr-2" name="canTransition" type="checkbox" />Mover etapa</label></div><Button className="mt-4" disabled={state === "loading"} type="submit" size="sm">Salvar acesso</Button></form></div>
    </section>

    {templates.length ? <section className={panelClass}>
      <label className="text-sm">Modelo<select className={inputClass} value={selected ? id(selected) : ""} onChange={(event) => setSelectedTemplateId(event.target.value)}>{templates.map((item) => <option key={id(item)} value={id(item)}>{label(item)} · {text(item.scope, "SHARED") === "SHARED" ? "compartilhado" : "cópia local"}</option>)}</select></label>
      {selected ? <form className="mt-5 grid gap-4" key={`${id(selected)}:${text(selectedVersion.createdAt)}`} onSubmit={saveTemplate}>
        <div className="grid gap-3 md:grid-cols-2"><label className="text-sm">Nome<input className={inputClass} defaultValue={label(selectedVersion) || label(selected)} name="name" required /></label><label className="text-sm">Modo<select className={inputClass} defaultValue="SHARED" name="scope"><option value="SHARED">Propagar ao modelo compartilhado</option><option value="LOCAL_COPY">Salvar como novo modelo</option></select></label><fieldset className="rounded-md border p-3 text-sm md:col-span-2"><legend className="px-1">Aplicar como compartilhado em</legend><div className="grid gap-2 sm:grid-cols-2">{pipelines.filter((item) => text(item.entityType) === text(selected.entityType)).map((item) => <label className="flex items-center gap-2" key={id(item)}><input name="pipelineIds" type="checkbox" value={id(item)} />{label(item)}</label>)}</div></fieldset><label className="text-sm md:col-span-2">Motivo da alteração<textarea className={inputClass} minLength={8} name="changeReason" required /></label></div>
        <div className="grid gap-3">{stages.map((stage) => { const activity = rows(stage.activities)[0] ?? {}; const requiredFields = rows(stage.requiredFields); return <fieldset className="rounded-md border p-4" key={id(stage)}><legend className="px-1 text-sm font-medium">{label(stage)}</legend><div className="grid gap-3 md:grid-cols-2"><label className="text-sm">Nome da etapa<input className={inputClass} defaultValue={label(stage)} name={`stageName:${id(stage)}`} required /></label><label className="text-sm">Campos obrigatórios<input className={inputClass} defaultValue={requiredFields.map((field) => text(field.fieldKey)).filter(Boolean).join(", ")} name={`requiredFields:${id(stage)}`} placeholder="email, telefone, orçamento" /></label><label className="text-sm">Oferta dos campos<select className={inputClass} defaultValue={text(requiredFields[0]?.offerTemplateId)} name={`requiredOffer:${id(stage)}`}><option value="">Todas as ofertas</option>{list(screen, "offerTemplates").map((offer) => <option key={id(offer)} value={id(offer)}>{label(offer)}</option>)}</select></label><label className="text-sm">Atividade<select className={inputClass} defaultValue={text(activity.activityType, "TASK")} name={`activityType:${id(stage)}`}><option value="TASK">Tarefa</option><option value="CALL">Ligação</option><option value="EMAIL">E-mail</option><option value="MEETING">Reunião</option></select></label><label className="text-sm">Prazo relativo em dias<input className={inputClass} defaultValue={number(activity.dueOffsetDays, 1)} min="0" name={`activityDue:${id(stage)}`} type="number" /></label><label className="text-sm md:col-span-2">Script da atividade<textarea className={inputClass} defaultValue={text(activity.script)} name={`activityScript:${id(stage)}`} /></label></div></fieldset>; })}</div>
        <Button disabled={state === "loading"} type="submit">Salvar nova revisão</Button>
      </form> : null}
      {selected ? <form className="mt-6 grid gap-3 rounded-md border bg-muted/30 p-4 md:grid-cols-2" onSubmit={copyTemplate}><label className="text-sm">Pipeline/origem a desacoplar<select className={inputClass} name="pipelineId" required><option value="">Selecione</option>{pipelines.map((item) => <option key={id(item)} value={id(item)}>{label(item)}</option>)}</select></label><label className="text-sm">Nome da cópia local<input className={inputClass} defaultValue={`${label(selected)} — cópia`} name="copyName" required /></label><label className="text-sm">Chave da cópia<input className={inputClass} defaultValue={`${text(selected.key, "pipeline")}_local`} name="copyKey" pattern="[a-z0-9][a-z0-9_-]{1,49}" required /></label><label className="text-sm">Motivo<textarea className={inputClass} minLength={3} name="copyReason" required /></label><Button disabled={state === "loading"} type="submit" variant="secondary">Desacoplar e criar cópia local</Button></form> : null}
    </section> : <section className={panelClass}><h2 className="text-lg font-semibold">Criar primeiro modelo compartilhado</h2><p className="mt-1 text-sm text-muted-foreground">Use as etapas de um pipeline existente como base. O modelo nasce versionado e vinculado ao pipeline escolhido.</p>{pipelines.length ? <form className="mt-5 grid gap-4 md:grid-cols-2" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const pipeline = pipelines.find((item) => id(item) === bootstrapPipelineId); const pipelineStages = rows(pipeline?.stages); void command({ action: "SAVE_TEMPLATE", templateId: null, expectedVersion: null, mode: "SAVE_AS_NEW", key: form.get("key"), name: form.get("name"), entityType: text(pipeline?.entityType, "OPPORTUNITY"), changeReason: form.get("changeReason"), pipelineIds: [bootstrapPipelineId], stages: pipelineStages.map((stage, position) => { const code = text(stage.leadStageCode, text(stage.opportunityStageCode)); return { stableKey: text(stage.stableKey, code.toLowerCase()), name: label(stage), position, type: text(stage.type, "OPEN"), leadStageCode: pipeline?.entityType === "LEAD" ? code : null, opportunityStageCode: pipeline?.entityType === "OPPORTUNITY" ? code : null, activities: [], requiredFields: [] }; }) }, "Primeiro modelo compartilhado criado e vinculado."); }}><label className="text-sm">Pipeline de referência<select className={inputClass} required value={bootstrapPipelineId} onChange={(event) => setBootstrapPipelineId(event.target.value)}><option value="">Selecione</option>{pipelines.map((item) => <option key={id(item)} value={id(item)}>{label(item)}</option>)}</select></label><label className="text-sm">Nome<input className={inputClass} name="name" required /></label><label className="text-sm">Chave<input className={inputClass} name="key" pattern="[a-z0-9][a-z0-9_-]{1,49}" placeholder="pipeline_comercial" required /></label><label className="text-sm">Motivo<input className={inputClass} minLength={3} name="changeReason" required /></label><Button disabled={state === "loading" || rows(pipelines.find((item) => id(item) === bootstrapPipelineId)?.stages).length < 2} type="submit">Criar modelo compartilhado</Button></form> : <EmptyState title="Nenhum pipeline disponível" description="Crie um pipeline com pelo menos duas etapas antes do primeiro modelo." />}</section>}

    {selected && pipelines.length ? <section className={panelClass}><h2 className="text-lg font-semibold">Migrar pipeline para este modelo</h2><p className="mt-1 text-sm text-muted-foreground">A prévia exige um destino para cada etapa atual e mostra todos os cards afetados.</p><form className="mt-5 grid gap-4" onSubmit={previewMigration}><label className="text-sm">Pipeline atual<select className={inputClass} name="pipelineId" required value={migrationPipelineId} onChange={(event) => setMigrationPipelineId(event.target.value)}><option value="">Selecione</option>{pipelines.map((item) => <option key={id(item)} value={id(item)}>{label(item)}</option>)}</select></label>{migrationPipelineId && currentStages.length === 0 ? <p className="rounded-md border p-3 text-sm text-muted-foreground">O servidor não retornou as etapas atuais deste pipeline; atualize a tela antes de migrar.</p> : currentStages.map((stage) => <label className="text-sm" key={id(stage)}>Destino para a etapa atual “{label(stage)}”<select className={inputClass} name={`map:${id(stage)}`} required><option value="">Selecione sem excluir cards</option>{stages.map((target) => <option key={id(target)} value={text(target.stableKey, id(target))}>{label(target)}</option>)}</select></label>)}<Button disabled={state === "loading" || currentStages.length === 0} type="submit">Gerar prévia segura</Button></form></section> : null}

    {history.length ? <section className={panelClass}><h2 className="text-lg font-semibold">Histórico imutável e rollback</h2><div className="mt-4 grid gap-2">{history.map((item) => { const pipeline = pipelines.find((row) => id(row) === text(item.pipelineId)); const application = object(pipeline?.application); const canRollback = text(item.status) === "APPLIED"; return <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3" key={id(item)}><div><p className="text-sm font-medium">Migração {text(item.fromVersion)} → {text(item.toVersion)}</p><p className="text-xs text-muted-foreground">{text(item.status)} · {number(item.affectedCount)} cards · {text(item.createdAt)}{item.expiresAt ? ` · expira ${text(item.expiresAt)}` : ""}</p></div>{canRollback ? <Button disabled={state === "loading"} onClick={() => void command({ action: "ROLLBACK_MIGRATION", expectedRevision: number(application.revision), migrationId: id(item), reason: "Rollback solicitado pela configuração do pipeline." }, "Rollback aplicado e registrado no histórico.")} size="sm" variant="secondary">Reverter migração</Button> : <span className="text-xs text-muted-foreground">Rollback indisponível</span>}</div>; })}</div></section> : null}

    {preview ? <AccessibleDialog busy={state === "loading"} labelledBy="migration-preview-title" onDismiss={() => setPreview(null)} className="max-w-2xl"><h2 className="text-xl font-semibold" id="migration-preview-title">{preview.title}</h2><p className="mt-2 text-sm text-muted-foreground">{preview.summary}</p><div className="mt-4 rounded-md border p-4"><strong className="text-2xl">{preview.affectedCards}</strong><p className="text-xs text-muted-foreground">cards afetados; nenhum será excluído</p></div>{preview.mappings.length ? <ul className="mt-4 grid gap-2">{preview.mappings.map((mapping) => <li className="rounded-md border p-3 text-sm" key={`${mapping.from}:${mapping.to}`}>{mapping.from} → {mapping.to} <strong className="float-right">{mapping.count}</strong></li>)}</ul> : null}{preview.warnings.length ? <ul className="mt-4 list-disc space-y-1 pl-5 text-sm">{preview.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : null}<p className="mt-4 text-sm">{preview.rollbackAvailable ? "A execução criará um ponto de rollback auditável." : "O servidor informou que esta migração não possui rollback automático."}</p><div className="mt-6 flex justify-end gap-2"><Button disabled={state === "loading"} onClick={() => setPreview(null)} variant="secondary">Cancelar</Button><Button disabled={state === "loading" || !preview.rollbackAvailable} onClick={() => void applyMigration()}>Aplicar migração</Button></div></AccessibleDialog> : null}
  </div>;
}

function Summary({ title, rows: items, empty }: Readonly<{ title: string; rows: readonly Row[]; empty: string }>) {
  return <section className="rounded-md border bg-background p-4"><h3 className="font-medium">{title}</h3>{items.length ? <ul className="mt-3 space-y-2 text-sm">{items.slice(0, 5).map((item) => <li className="flex items-center justify-between gap-2" key={id(item)}><span>{label(item)}</span><small className="text-muted-foreground">{text(item.scope) === "LOCAL_COPY" ? "local" : text(item.status, bool(item.active, true) ? "ativo" : "inativo")}</small></li>)}</ul> : <p className="mt-3 text-sm text-muted-foreground">{empty}</p>}</section>;
}
