"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";

import { AccessibleDialog } from "@/components/ui/accessible-dialog";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/ui/icon";
import { DataTableShell, SectionHeader, StatCard, Surface } from "@/components/ui/surface";
import styles from "./portability-workspace.module.css";

type EntityType = "CONTACT" | "ACCOUNT" | "LEAD" | "OPPORTUNITY";
type FieldType = "TEXT" | "NUMBER" | "DATE" | "BOOLEAN" | "SELECT" | "MULTI_SELECT";

type TagView = Readonly<{
  id: string;
  name: string;
  color: string;
  entityTypes: readonly EntityType[];
  usageCount: number;
  active: boolean;
}>;

type FieldView = Readonly<{
  id: string;
  key: string;
  label: string;
  entityType: EntityType;
  dataType: FieldType;
  required: boolean;
  active: boolean;
  options: readonly string[];
  usageCount: number;
}>;

type PortabilityScreen = Readonly<{
  generatedAt: string;
  counts: Readonly<{ contacts: number; opportunities: number; tags: number; fields: number }>;
  permissions: Readonly<{ canExport: boolean; canBulk: boolean; canConfigure: boolean }>;
  tags: readonly TagView[];
  fields: readonly FieldView[];
}>;

type BulkPreview = Readonly<{
  operationId: string;
  fingerprint: string;
  total: number;
  eligible: number;
  unchanged: number;
  blocked: number;
  expiresAt: string | null;
  items: readonly Readonly<{ id: string; label: string; outcome: string; reason: string | null }>[];
}>;

type Notice = Readonly<{ kind: "success" | "error"; message: string }> | null;

const inputClass = styles.input;
const emptyScreen: PortabilityScreen = {
  generatedAt: new Date(0).toISOString(),
  counts: { contacts: -1, opportunities: -1, tags: 0, fields: 0 },
  permissions: { canExport: false, canBulk: false, canConfigure: false },
  tags: [],
  fields: [],
};

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function booleanValue(value: unknown): boolean {
  return value === true;
}

function entityType(value: unknown): EntityType {
  return value === "ACCOUNT" || value === "LEAD" || value === "OPPORTUNITY" ? value : "CONTACT";
}

function entityLabel(value: EntityType): string {
  return { CONTACT: "Contato", ACCOUNT: "Conta", LEAD: "Lead", OPPORTUNITY: "Negócio" }[value];
}

function normalizeScreen(payload: unknown): PortabilityScreen {
  const root = objectValue(payload);
  const result = objectValue(root.result ?? root);
  const counts = objectValue(result.counts ?? result.summary);
  const permissions = objectValue(result.permissions);
  const rawTags = Array.isArray(result.tags) ? result.tags : [];
  const rawFields = Array.isArray(result.fields) ? result.fields : Array.isArray(result.fieldDefinitions) ? result.fieldDefinitions : [];
  const tags = rawTags.map((value): TagView => {
    const row = objectValue(value);
    const rawEntities = Array.isArray(row.entityTypes) ? row.entityTypes : Array.isArray(row.appliesTo) ? row.appliesTo : [];
    return {
      id: stringValue(row.id),
      name: stringValue(row.name, "Tag sem nome"),
      color: stringValue(row.color, "#64748b"),
      entityTypes: rawEntities.length ? rawEntities.map(entityType) : ["CONTACT", "ACCOUNT", "LEAD", "OPPORTUNITY"],
      usageCount: numberValue(row.usageCount ?? row.recordsInUse),
      active: row.active !== false,
    };
  });
  const fields = rawFields.map((value): FieldView => {
    const row = objectValue(value);
    const dataType = ["TEXT", "NUMBER", "DATE", "BOOLEAN", "SELECT", "MULTI_SELECT"].includes(stringValue(row.dataType))
      ? stringValue(row.dataType) as FieldType
      : "TEXT";
    return {
      id: stringValue(row.id),
      key: stringValue(row.key),
      label: stringValue(row.label ?? row.name, "Campo sem nome"),
      entityType: entityType(row.entityType),
      dataType,
      required: booleanValue(row.required),
      active: row.active !== false,
      options: Array.isArray(row.options) ? row.options.filter((item): item is string => typeof item === "string") : [],
      usageCount: numberValue(row.usageCount ?? row.recordsInUse),
    };
  });
  return {
    generatedAt: stringValue(result.generatedAt, new Date().toISOString()),
    counts: {
      contacts: counts.contacts === undefined && counts.contactCount === undefined ? -1 : numberValue(counts.contacts ?? counts.contactCount),
      opportunities: counts.opportunities === undefined && counts.opportunityCount === undefined ? -1 : numberValue(counts.opportunities ?? counts.opportunityCount),
      tags: numberValue(counts.tags) || tags.length,
      fields: numberValue(counts.fields ?? counts.fieldDefinitions) || fields.length,
    },
    permissions: {
      canExport: permissions.canExport === undefined || booleanValue(permissions.canExport),
      canBulk: permissions.canBulk === undefined || booleanValue(permissions.canBulk),
      canConfigure: permissions.canConfigure === undefined || booleanValue(permissions.canConfigure),
    },
    tags,
    fields,
  };
}

function normalizePreview(payload: unknown): BulkPreview {
  const root = objectValue(payload);
  const result = objectValue(root.result ?? root);
  const counts = objectValue(result.counts);
  const rawItems = Array.isArray(result.items) ? result.items : [];
  return {
    operationId: stringValue(result.operationId ?? result.token ?? result.previewToken),
    fingerprint: stringValue(result.fingerprint),
    total: numberValue(result.total ?? result.count ?? counts.total),
    eligible: numberValue(result.eligible ?? result.count ?? counts.eligible),
    unchanged: numberValue(result.unchanged ?? counts.unchanged),
    blocked: numberValue(result.blocked ?? counts.blocked),
    expiresAt: stringValue(result.expiresAt) || null,
    items: rawItems.map((value) => {
      const row = objectValue(value);
      return {
        id: stringValue(row.id),
        label: stringValue(row.label ?? row.name, stringValue(row.id)),
        outcome: stringValue(row.outcome, "ELIGIBLE"),
        reason: stringValue(row.reason) || null,
      };
    }),
  };
}

async function jsonResponse(response: Response): Promise<unknown> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const root = objectValue(body);
    const error = objectValue(root.error);
    throw new Error(stringValue(error.message, "Não foi possível concluir a operação."));
  }
  return body;
}

function idsFromText(value: string): string[] {
  return [...new Set(value.split(/[\s,;]+/).map((item) => item.trim()).filter(Boolean))];
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function PortabilityWorkspace() {
  const [screen, setScreen] = useState<PortabilityScreen>(emptyScreen);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [preview, setPreview] = useState<BulkPreview | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [bulkEntity, setBulkEntity] = useState<EntityType>("CONTACT");
  const [bulkAction, setBulkAction] = useState("APPLY_TAG");
  const [bulkTarget, setBulkTarget] = useState("");
  const [bulkValue, setBulkValue] = useState("");
  const [bulkIds, setBulkIds] = useState("");
  const [bulkReason, setBulkReason] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await fetch("/api/portability", { cache: "no-store" });
      setScreen(normalizeScreen(await jsonResponse(response)));
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Não foi possível carregar a portabilidade comercial.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void fetch("/api/portability", { cache: "no-store" })
      .then(jsonResponse)
      .then((body) => { if (active) setScreen(normalizeScreen(body)); })
      .catch((error: unknown) => { if (active) setLoadError(error instanceof Error ? error.message : "Não foi possível carregar a portabilidade comercial."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const targetOptions = useMemo(() => bulkAction.includes("TAG")
    ? screen.tags.filter((tag) => tag.active && tag.entityTypes.includes(bulkEntity)).map((tag) => ({ id: tag.id, label: tag.name }))
    : screen.fields.filter((field) => field.active && field.entityType === bulkEntity).map((field) => ({ id: field.id, label: field.label })), [bulkAction, bulkEntity, screen.fields, screen.tags]);

  async function exportCsv(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const requestedEntity = entityType(form.get("entityType"));
    const reason = stringValue(form.get("reason")).trim();
    setPending("export"); setNotice(null);
    try {
      const response = await fetch("/api/portability/export", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/csv, application/json" },
        body: JSON.stringify({ kind: requestedEntity === "CONTACT" ? "CONTACTS" : "OPPORTUNITIES", reason }),
      });
      const contentType = response.headers.get("content-type") ?? "";
      if (!response.ok || contentType.includes("application/json")) {
        const body = objectValue(await jsonResponse(response));
        const result = objectValue(body.result ?? body);
        const content = stringValue(result.content ?? result.csv);
        const fileName = stringValue(result.fileName, requestedEntity === "CONTACT" ? "contatos.csv" : "negocios.csv");
        if (!content) throw new Error("A exportação foi aceita, mas o arquivo não foi retornado.");
        downloadBlob(new Blob([content], { type: "text/csv;charset=utf-8" }), fileName);
      } else {
        const disposition = response.headers.get("content-disposition") ?? "";
        const matchedName = disposition.match(/filename\*?=(?:UTF-8'')?["']?([^"';]+)/i)?.[1];
        downloadBlob(await response.blob(), decodeURIComponent(matchedName ?? (requestedEntity === "CONTACT" ? "contatos.csv" : "negocios.csv")));
      }
      setNotice({ kind: "success", message: "Exportação autorizada e arquivo CSV gerado." });
    } catch (error) {
      setNotice({ kind: "error", message: error instanceof Error ? error.message : "Falha ao exportar." });
    } finally { setPending(null); }
  }

  async function saveTag(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending("tag"); setNotice(null);
    try {
      await jsonResponse(await fetch("/api/portability/tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "CREATE", name: form.get("name"), color: form.get("color") }),
      }));
      event.currentTarget.reset();
      setNotice({ kind: "success", message: "Tag salva para o workspace." });
      await load();
    } catch (error) {
      setNotice({ kind: "error", message: error instanceof Error ? error.message : "Falha ao salvar a tag." });
    } finally { setPending(null); }
  }

  async function saveField(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const options = stringValue(form.get("options")).split("\n").map((item) => item.trim()).filter(Boolean);
    setPending("field"); setNotice(null);
    try {
      await jsonResponse(await fetch("/api/portability/fields", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entityType: form.get("entityType"), key: form.get("key"), name: form.get("label"), dataType: form.get("dataType"), required: form.get("required") === "on", ...(options.length ? { options } : {}) }),
      }));
      event.currentTarget.reset();
      setNotice({ kind: "success", message: "Campo personalizado salvo para o workspace." });
      await load();
    } catch (error) {
      setNotice({ kind: "error", message: error instanceof Error ? error.message : "Falha ao salvar o campo." });
    } finally { setPending(null); }
  }

  function bulkPayload() {
    return {
      entityType: bulkEntity,
      action: bulkAction === "APPLY_TAG" ? "ADD_TAG" : bulkAction,
      entityIds: idsFromText(bulkIds),
      payload: bulkAction.includes("TAG") ? { tagId: bulkTarget } : { definitionId: bulkTarget, value: bulkValue },
      reason: bulkReason.trim(),
    };
  }

  async function previewBulk(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending("preview"); setNotice(null); setPreview(null);
    try {
      const body = await jsonResponse(await fetch("/api/portability/bulk/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bulkPayload()),
      }));
      const nextPreview = normalizePreview(body);
      if (!nextPreview.operationId || !nextPreview.fingerprint) throw new Error("A prévia não retornou os identificadores de confirmação.");
      setPreview(nextPreview);
      setNotice({ kind: "success", message: "Prévia concluída sem alterar registros." });
    } catch (error) {
      setNotice({ kind: "error", message: error instanceof Error ? error.message : "Falha ao gerar a prévia." });
    } finally { setPending(null); }
  }

  async function executeBulk() {
    if (!preview) return;
    setPending("execute"); setNotice(null);
    try {
      const body = objectValue(await jsonResponse(await fetch("/api/portability/bulk/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operationId: preview.operationId, fingerprint: preview.fingerprint }),
      })));
      const result = objectValue(body.result ?? body);
      const changed = numberValue(result.changed ?? result.executed);
      setNotice({ kind: "success", message: `${changed} registro(s) atualizado(s) com auditoria.` });
      setPreview(null); setConfirming(false); setBulkIds(""); setBulkReason("");
      await load();
    } catch (error) {
      setConfirming(false);
      setNotice({ kind: "error", message: error instanceof Error ? error.message : "Falha ao executar a ação em massa." });
    } finally { setPending(null); }
  }

  if (loading) return <Surface className={styles.loading} aria-live="polite"><Icon name="relogio" /><p>Carregando regras e permissões do workspace…</p></Surface>;
  if (loadError) return <Surface tone="critical"><SectionHeader title="Não foi possível carregar a portabilidade" description={loadError} action={<Button onClick={() => void load()} type="button" variant="secondary">Tentar novamente</Button>} /></Surface>;

  return (
    <div className={styles.workspace}>
      <div className={styles.stats}>
        <StatCard label="Contatos" value={screen.counts.contacts >= 0 ? screen.counts.contacts : "—"} hint="Disponíveis no workspace" />
        <StatCard label="Negócios" value={screen.counts.opportunities >= 0 ? screen.counts.opportunities : "—"} hint="Oportunidades comerciais" />
        <StatCard label="Tags" value={screen.counts.tags} hint="Marcadores configurados" />
        <StatCard label="Campos" value={screen.counts.fields} hint="Definições personalizadas" />
      </div>

      {notice ? <p className={styles.notice} data-kind={notice.kind} role={notice.kind === "error" ? "alert" : "status"}>{notice.message}</p> : null}

      <div className={styles.topGrid}>
        <Surface tone="accent">
          <SectionHeader eyebrow="Entrada" title="Importar CSV" description="Use o intake existente para mapear colunas, validar duplicidades e revisar erros antes de gravar." />
          <div className={styles.featureList}><span><Icon name="auditoria" size={15} /> Prévia sem gravação</span><span><Icon name="leads" size={15} /> Deduplicação controlada</span><span><Icon name="entrada" size={15} /> Relatório de erros</span></div>
          <Button asChild><Link href="/leads/entrada">Abrir importação existente <Icon name="seta-direita" size={14} /></Link></Button>
        </Surface>

        <Surface>
          <SectionHeader eyebrow="Saída autorizada" title="Exportar CSV" description="O arquivo contém apenas registros visíveis para seu escopo e gera evento de auditoria." />
          {screen.permissions.canExport ? <form className={styles.form} onSubmit={exportCsv}>
            <label>Entidade<select className={inputClass} name="entityType"><option value="CONTACT">Contatos</option><option value="OPPORTUNITY">Negócios</option></select></label>
            <label>Motivo da exportação<textarea className={inputClass} minLength={3} name="reason" placeholder="Informe a finalidade comercial autorizada" required /></label>
            <Button disabled={pending !== null} type="submit">{pending === "export" ? "Gerando…" : "Gerar CSV"}</Button>
          </form> : <p className={styles.restricted}>Seu perfil não possui permissão para exportar dados comerciais.</p>}
        </Surface>
      </div>

      <Surface>
        <SectionHeader eyebrow="Alteração controlada" title="Ações em massa" description="A prévia é obrigatória. O servidor revalida escopo, token e conteúdo antes da confirmação." />
        {screen.permissions.canBulk ? <form className={styles.bulkForm} onSubmit={previewBulk}>
          <label>Entidade<select className={inputClass} onChange={(event) => { setBulkEntity(entityType(event.target.value)); setBulkTarget(""); setBulkValue(""); setPreview(null); }} value={bulkEntity}><option value="CONTACT">Contatos</option><option value="ACCOUNT">Contas</option><option value="LEAD">Leads</option><option value="OPPORTUNITY">Negócios</option></select></label>
          <label>Ação<select className={inputClass} onChange={(event) => { setBulkAction(event.target.value); setBulkTarget(""); setBulkValue(""); setPreview(null); }} value={bulkAction}><option value="APPLY_TAG">Aplicar tag</option><option value="REMOVE_TAG">Remover tag</option><option value="SET_CUSTOM_FIELD">Definir campo personalizado</option></select></label>
          <label>Destino<select className={inputClass} onChange={(event) => { setBulkTarget(event.target.value); setPreview(null); }} required value={bulkTarget}><option value="">Selecione</option>{targetOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
          {bulkAction === "SET_CUSTOM_FIELD" ? <label>Valor<input className={inputClass} onChange={(event) => { setBulkValue(event.target.value); setPreview(null); }} required value={bulkValue} /></label> : null}
          <label className={styles.wide}>IDs dos registros<textarea className={inputClass} onChange={(event) => { setBulkIds(event.target.value); setPreview(null); }} placeholder="Cole UUIDs separados por vírgula, espaço ou linha" required rows={4} value={bulkIds} /></label>
          <label className={styles.wide}>Motivo obrigatório<textarea className={inputClass} minLength={3} onChange={(event) => { setBulkReason(event.target.value); setPreview(null); }} placeholder="Descreva por que a alteração é necessária" required rows={3} value={bulkReason} /></label>
          <div className={styles.wide}><Button disabled={pending !== null || idsFromText(bulkIds).length === 0 || !bulkTarget || bulkReason.trim().length < 3} type="submit">{pending === "preview" ? "Calculando…" : "Gerar prévia"}</Button></div>
        </form> : <p className={styles.restricted}>Seu perfil não possui permissão para executar ações em massa.</p>}

        {preview ? <div className={styles.preview}>
          <div className={styles.previewHeading}><div><p>Prévia pronta</p><h3>{preview.total} registro(s) analisado(s)</h3></div>{preview.expiresAt ? <small>Válida até {new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(preview.expiresAt))}</small> : null}</div>
          <div className={styles.previewStats}><span><strong>{preview.eligible}</strong> elegíveis</span><span><strong>{preview.unchanged}</strong> sem alteração</span><span><strong>{preview.blocked}</strong> bloqueados</span></div>
          {preview.items.length ? <DataTableShell><table><thead><tr><th>Registro</th><th>Resultado</th><th>Motivo</th></tr></thead><tbody>{preview.items.slice(0, 100).map((item) => <tr key={item.id}><td>{item.label}</td><td>{item.outcome}</td><td>{item.reason ?? "—"}</td></tr>)}</tbody></table></DataTableShell> : null}
          <Button disabled={preview.eligible === 0 || pending !== null} onClick={() => setConfirming(true)} type="button">Confirmar {preview.eligible} alteração(ões)</Button>
        </div> : null}
      </Surface>

      <div className={styles.configGrid}>
        <Surface>
          <SectionHeader eyebrow="Classificação" title="Tags" description="Crie marcadores reutilizáveis e restrinja as entidades às quais podem ser aplicados." />
          {screen.permissions.canConfigure ? <form className={styles.form} onSubmit={saveTag}><label>Nome<input className={inputClass} name="name" required /></label><label>Cor<input className={inputClass} defaultValue="#2563eb" name="color" type="color" /></label><p className="text-xs text-muted-foreground">A tag poderá ser usada em contatos e negócios deste workspace.</p><Button disabled={pending !== null} type="submit">{pending === "tag" ? "Salvando…" : "Criar tag"}</Button></form> : null}
          <div className={styles.chips}>{screen.tags.filter((tag) => tag.active).map((tag) => <span key={tag.id}><i style={{ backgroundColor: tag.color }} />{tag.name}<small>{tag.usageCount}</small></span>)}</div>
          {!screen.permissions.canConfigure && screen.tags.length === 0 ? <EmptyState compact title="Nenhuma tag visível" description="As tags configuradas para este workspace aparecerão aqui." /> : null}
        </Surface>

        <Surface>
          <SectionHeader eyebrow="Modelo de dados" title="Campos personalizados" description="Cada definição pertence a uma entidade e mantém chave estável para importação e exportação." />
          {screen.permissions.canConfigure ? <form className={styles.form} onSubmit={saveField}><div className={styles.twoColumns}><label>Entidade<select className={inputClass} name="entityType"><option value="CONTACT">Contato</option><option value="ACCOUNT">Conta</option><option value="LEAD">Lead</option><option value="OPPORTUNITY">Negócio</option></select></label><label>Tipo<select className={inputClass} name="dataType"><option value="TEXT">Texto</option><option value="NUMBER">Número</option><option value="DATE">Data</option><option value="BOOLEAN">Sim/Não</option><option value="SELECT">Lista</option><option value="MULTI_SELECT">Lista múltipla</option></select></label></div><div className={styles.twoColumns}><label>Chave<input className={inputClass} name="key" pattern="[a-z][a-z0-9_]*" placeholder="ex.: mandato_atual" required /></label><label>Rótulo<input className={inputClass} name="label" required /></label></div><label>Opções da lista<textarea className={inputClass} name="options" placeholder="Uma opção por linha; use somente para campos Lista" rows={3} /></label><label className={styles.check}><input name="required" type="checkbox" /> Obrigatório</label><Button disabled={pending !== null} type="submit">{pending === "field" ? "Salvando…" : "Criar campo"}</Button></form> : null}
          {screen.fields.length ? <DataTableShell><table><thead><tr><th>Campo</th><th>Entidade</th><th>Tipo</th><th>Uso</th></tr></thead><tbody>{screen.fields.filter((field) => field.active).map((field) => <tr key={field.id}><td><strong>{field.label}</strong><small>{field.key}</small></td><td>{entityLabel(field.entityType)}</td><td>{field.dataType}{field.required ? " · obrigatório" : ""}</td><td>{field.usageCount}</td></tr>)}</tbody></table></DataTableShell> : <EmptyState compact title="Nenhum campo configurado" description="Crie a primeira definição para enriquecer contatos ou negócios." />}
        </Surface>
      </div>

      {confirming && preview ? <AccessibleDialog busy={pending === "execute"} className="max-w-lg" describedBy="bulk-confirm-description" labelledBy="bulk-confirm-title" onDismiss={() => setConfirming(false)}>
        <h2 className="text-xl font-semibold" id="bulk-confirm-title">Confirmar ação em massa</h2>
        <p className="mt-2 text-sm text-muted-foreground" id="bulk-confirm-description">Serão alterados {preview.eligible} de {preview.total} registros. A operação usará a prévia atual, preservará os bloqueados e registrará o motivo na auditoria.</p>
        <p className={styles.reasonSummary}><strong>Motivo</strong>{bulkReason}</p>
        <div className="mt-5 flex justify-end gap-2"><Button disabled={pending !== null} onClick={() => setConfirming(false)} type="button" variant="secondary">Cancelar</Button><Button disabled={pending !== null} onClick={() => void executeBulk()} type="button">{pending === "execute" ? "Executando…" : "Executar alterações"}</Button></div>
      </AccessibleDialog> : null}
    </div>
  );
}
