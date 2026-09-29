"use client";

import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { SectionHeader, Surface } from "@/components/ui/surface";
import type { NotificationScreen } from "@/modules/automations/application/notification-service";

function errorMessage(body: unknown) {
  if (body && typeof body === "object" && "error" in body && body.error && typeof body.error === "object" && "message" in body.error) {
    return String(body.error.message);
  }
  return "Não foi possível atualizar a notificação.";
}

export function NotificationCenter({ initialScreen }: Readonly<{ initialScreen: NotificationScreen }>) {
  const [screen, setScreen] = useState(initialScreen);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function markRead(id: string) {
    setBusyId(id);
    setNotice(null);
    try {
      const response = await fetch(`/api/notifications/${id}`, { method: "PATCH" });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(errorMessage(body));
      const readAt = new Date().toISOString();
      setScreen((current) => ({
        ...current,
        unread: Math.max(0, current.unread - 1),
        notifications: current.notifications.map((item) => item.id === id ? { ...item, readAt } : item),
      }));
      setNotice("Notificação marcada como lida.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Falha inesperada.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Surface className="p-5" aria-labelledby="notifications-title">
      <SectionHeader action={<StatusBadge tone={screen.unread > 0 ? "info" : "success"}>{screen.unread} não lidas</StatusBadge>} description="Somente avisos destinados ao membro autenticado neste workspace." eyebrow="Caixa de entrada" title="Central de notificações" titleId="notifications-title" />
      {notice ? <p className="mt-4 rounded-md border bg-muted px-3 py-2 text-sm" role="status">{notice}</p> : null}
      {screen.notifications.length === 0 ? (
        <EmptyState className="mt-5" description="Não existem avisos persistidos para o filtro selecionado." title="Nenhuma notificação neste recorte" />
      ) : (
        <ol className="mt-5 divide-y overflow-hidden rounded-[0.875rem] border bg-card">
          {screen.notifications.map((item) => (
            <li className={`p-4 ${item.readAt ? "bg-muted/35" : "bg-card"}`} key={item.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{item.title}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{item.body}</p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {new Date(item.createdAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}
                    {item.relatedLabel ? ` · ${item.relatedLabel}` : ""}
                    {item.automation ? ` · ${item.automation.ruleName}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  {item.href ? <Button asChild size="sm" variant="secondary"><Link href={item.href}>Abrir registro</Link></Button> : null}
                  {!item.readAt ? <Button disabled={busyId === item.id} onClick={() => void markRead(item.id)} size="sm" type="button">{busyId === item.id ? "Salvando…" : "Marcar como lida"}</Button> : <StatusBadge tone="success">Lida</StatusBadge>}
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Surface>
  );
}
