"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { SectionHeader, Surface } from "@/components/ui/surface";
import type { MeetingBriefing } from "@/modules/meetings/domain/meeting-contracts";

type Transcript = MeetingBriefing["transcript"];

function formatDate(value: string | null) {
  return value ? new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }).format(new Date(value)) : "Sem registro";
}

function localDateTime(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function MeetingTranscriptPanel({ meetingId, transcript }: Readonly<{ meetingId: string; transcript: Transcript }>) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const retention = new Date();
  retention.setDate(retention.getDate() + 90);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setNotice(null);
    const data = new FormData(event.currentTarget);
    try {
      const response = await fetch(`/api/meetings/${meetingId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "RECORD_TRANSCRIPT",
          transcriptText: data.get("transcriptText") || null,
          summary: data.get("summary") || null,
          policyVersion: "meeting-transcript-policy/v1",
          consentConfirmed: data.get("consentConfirmed") === "on",
          consentEvidence: data.get("consentEvidence"),
          consentRecordedAt: new Date(String(data.get("consentRecordedAt"))).toISOString(),
          retentionUntil: new Date(String(data.get("retentionUntil"))).toISOString(),
        }),
      });
      const body = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "Não foi possível registrar o artefato.");
      setNotice({ tone: "success", text: "Artefato registrado com consentimento, retenção e auditoria." });
      setShowForm(false);
      router.refresh();
    } catch (error) {
      setNotice({ tone: "danger", text: error instanceof Error ? error.message : "Não foi possível registrar o artefato." });
    } finally { setPending(false); }
  }

  return <Surface className="p-5 lg:col-span-2">
    <div className="flex flex-wrap items-start justify-between gap-3"><SectionHeader eyebrow="Consentimento e acesso" title="Transcrição e resumo" description="O CRM não grava nem transcreve reuniões. Um artefato só pode ser registrado com consentimento comprovado, retenção definida e permissão própria." /><span className="status-badge" data-tone={transcript.status === "AVAILABLE" ? "success" : transcript.status === "RESTRICTED" || transcript.status === "EXPIRED" ? "warning" : "info"}>{transcript.status === "AVAILABLE" ? `Disponível · v${transcript.version}` : transcript.status === "RESTRICTED" ? "Acesso restrito" : transcript.status === "EXPIRED" ? "Retenção expirada" : "Ausente"}</span></div>

    {transcript.status === "AVAILABLE" && transcript.visible ? <div className="mt-4 grid gap-4 md:grid-cols-2"><article className="rounded-[var(--radius-control)] border bg-[var(--surface-subtle)] p-4"><h3 className="text-sm font-semibold">Resumo consentido</h3><p className="mt-2 whitespace-pre-wrap text-sm">{transcript.summary ?? "Sem resumo nesta versão."}</p></article><article className="rounded-[var(--radius-control)] border bg-[var(--surface-subtle)] p-4"><h3 className="text-sm font-semibold">Transcrição consentida</h3><details className="mt-2"><summary className="cursor-pointer text-sm font-medium">Exibir conteúdo</summary><p className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap text-sm">{transcript.transcriptText ?? "Sem transcrição nesta versão."}</p></details></article><p className="text-xs text-muted-foreground md:col-span-2">Consentimento: {formatDate(transcript.consentRecordedAt)} · retenção até {formatDate(transcript.retentionUntil)} · política {transcript.policyVersion}</p></div> : null}
    {transcript.status === "RESTRICTED" ? <p className="mt-4 rounded-[var(--radius-control)] border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Existe um artefato, mas seu perfil não possui a permissão específica para consultar transcrições.</p> : null}
    {transcript.status === "EXPIRED" ? <p className="mt-4 rounded-[var(--radius-control)] border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">O prazo de retenção terminou em {formatDate(transcript.retentionUntil)}. O conteúdo não é retornado.</p> : null}
    {transcript.status === "ABSENT" ? <p className="mt-4 text-sm text-muted-foreground">Nenhum artefato consentido foi registrado para esta reunião.</p> : null}
    {notice ? <p className="feedback-banner mt-4" data-tone={notice.tone} role={notice.tone === "danger" ? "alert" : "status"}>{notice.text}</p> : null}

    {transcript.canManage ? <div className="mt-4">{!showForm ? <Button onClick={() => setShowForm(true)} size="sm" variant="secondary">Registrar nova versão consentida</Button> : <form className="grid gap-4 rounded-[var(--radius-panel)] border bg-[var(--surface-subtle)] p-4 md:grid-cols-2" onSubmit={submit}><label className="space-y-1 text-sm md:col-span-2"><span className="font-semibold">Resumo</span><textarea className="w-full rounded-[var(--radius-control)] border bg-card px-3 py-2" minLength={10} name="summary" placeholder="Resumo produzido fora do CRM com consentimento válido" rows={4} /></label><label className="space-y-1 text-sm md:col-span-2"><span className="font-semibold">Transcrição opcional</span><textarea className="w-full rounded-[var(--radius-control)] border bg-card px-3 py-2" minLength={20} name="transcriptText" placeholder="Conteúdo consentido" rows={6} /></label><label className="space-y-1 text-sm"><span className="font-semibold">Consentimento registrado em</span><input className="w-full rounded-[var(--radius-control)] border bg-card px-3 py-2" defaultValue={localDateTime(new Date())} name="consentRecordedAt" required type="datetime-local" /></label><label className="space-y-1 text-sm"><span className="font-semibold">Reter até</span><input className="w-full rounded-[var(--radius-control)] border bg-card px-3 py-2" defaultValue={localDateTime(retention)} name="retentionUntil" required type="datetime-local" /></label><label className="space-y-1 text-sm md:col-span-2"><span className="font-semibold">Evidência do consentimento</span><textarea className="w-full rounded-[var(--radius-control)] border bg-card px-3 py-2" minLength={10} name="consentEvidence" placeholder="Onde, quando e como o consentimento foi obtido" required rows={3} /></label><label className="flex items-start gap-2 text-sm md:col-span-2"><input className="mt-1" name="consentConfirmed" required type="checkbox" /><span>Confirmo que o titular consentiu com este conteúdo e com o prazo de retenção informado.</span></label><div className="flex gap-2 md:col-span-2"><Button disabled={pending} type="submit">{pending ? "Registrando…" : "Registrar artefato"}</Button><Button disabled={pending} onClick={() => setShowForm(false)} type="button" variant="ghost">Cancelar</Button></div></form>}</div> : null}
  </Surface>;
}
