"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

type Review = Readonly<{
  id: string;
  normalizedName: string;
  reason: string;
  lead: Readonly<{ id: string; fullName: string; organizationName: string | null }>;
  candidates: readonly Readonly<{ account: Readonly<{ id: string; name: string }> | null }>[];
}>;

export function AccountReviewWorkspace({ initialReviews }: Readonly<{ initialReviews: readonly Review[] }>) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  async function decide(review: Review, decision: "CREATE_ACCOUNT" | "LINK_EXISTING" | "KEEP_UNLINKED" | "DISMISS", accountId?: string) {
    setPending(review.id);
    setMessage(null);
    const response = await fetch(`/api/accounts/reviews/${review.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision, accountId: accountId ?? null, reason: "Decisão humana registrada na fila de revisão de contas." }) });
    const body = await response.json().catch(() => ({})) as { error?: { message?: string } };
    setPending(null);
    if (!response.ok) return setMessage(body.error?.message ?? "Não foi possível registrar a decisão.");
    setMessage("Decisão registrada com auditoria.");
    router.refresh();
  }
  if (initialReviews.length === 0) return <EmptyState title="Nenhuma revisão aberta" description="Novos nomes de organização sem vínculo canônico aparecerão aqui." />;
  return <section className="space-y-3" aria-label="Revisões abertas">{message ? <p className="feedback-info" role="status">{message}</p> : null}{initialReviews.map((review) => <article className="surface-panel p-4" key={review.id}><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-semibold">{review.lead.organizationName ?? review.normalizedName}</h2><p className="text-sm text-muted-foreground">Lead: {review.lead.fullName} · {review.reason}</p></div><div className="flex flex-wrap gap-2"><Button disabled={pending === review.id} onClick={() => decide(review, "CREATE_ACCOUNT")} size="sm" type="button">Criar conta</Button>{review.candidates.map((candidate) => candidate.account ? <Button disabled={pending === review.id} key={candidate.account.id} onClick={() => decide(review, "LINK_EXISTING", candidate.account!.id)} size="sm" type="button" variant="secondary">Vincular a {candidate.account.name}</Button> : null)}<Button disabled={pending === review.id} onClick={() => decide(review, "KEEP_UNLINKED")} size="sm" type="button" variant="secondary">Manter sem vínculo</Button><Button disabled={pending === review.id} onClick={() => decide(review, "DISMISS")} size="sm" type="button" variant="ghost">Descartar candidato</Button></div></div></article>)}</section>;
}
