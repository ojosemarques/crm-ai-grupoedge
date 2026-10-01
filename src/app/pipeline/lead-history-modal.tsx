"use client";

import { useRouter } from "next/navigation";
import { useCallback, type ReactNode } from "react";

import { AccessibleDialog } from "@/components/ui/accessible-dialog";
import styles from "@/app/pipeline/lead-history-modal.module.css";

export function LeadHistoryModal({ children }: Readonly<{ children: ReactNode }>) {
  const router = useRouter();
  const close = useCallback(() => router.back(), [router]);

  return (
    <AccessibleDialog
      backdropClassName={styles.backdrop ?? ""}
      className={styles.dialog ?? ""}
      labelledBy="pipeline-lead-history-title"
      onDismiss={close}
    >
      <header className={styles.toolbar}>
        <h2 className="sr-only" id="pipeline-lead-history-title">Ficha completa do lead</h2>
        <p>Ficha completa do lead</p>
        <button aria-label="Fechar ficha e voltar ao pipeline" onClick={close} type="button">×</button>
      </header>
      <div className={styles.content}>{children}</div>
    </AccessibleDialog>
  );
}
