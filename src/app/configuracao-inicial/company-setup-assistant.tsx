"use client";

import Link from "next/link";
import { useState } from "react";
import type { CompanySetupScreen, CompanySetupStep, CompanySetupStepKey } from "@/modules/users/domain/company-setup-contracts";
import styles from "./company-setup.module.css";

const labels = { READY: "Pronto", ACTION_REQUIRED: "Precisa de ação", OPTIONAL: "Opcional", SKIPPED: "Para depois" } as const;

export function CompanySetupAssistant({ initial }: Readonly<{ initial: CompanySetupScreen }>) {
  const [screen, setScreen] = useState(initial);
  const [busyStep, setBusyStep] = useState<CompanySetupStepKey | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function setStep(step: CompanySetupStep, state: "SKIPPED" | "PENDING") {
    setBusyStep(step.key); setError(null);
    try {
      const response = await fetch("/api/hub/setup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "SET_STEP_STATE", stepKey: step.key, state, idempotencyKey: crypto.randomUUID(), confirmed: true }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "Não foi possível salvar esta escolha.");
      setScreen(body.result);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível salvar esta escolha."); }
    finally { setBusyStep(null); }
  }

  return <div className={styles.workspace}>
    <section className={styles.summary} aria-labelledby="setup-progress-title">
      <div><p className={styles.eyebrow}>PROGRESSO DA CONFIGURAÇÃO</p><h2 id="setup-progress-title">{screen.requiredComplete ? "A empresa está pronta para operar" : "Termine os pontos essenciais"}</h2><p>{screen.completedCount} de {screen.totalCount} etapas concluídas. Você pode sair e continuar depois.</p></div>
      <div className={styles.progress}><strong>{screen.progressPercent}%</strong><progress aria-label="Progresso da configuração" max="100" value={screen.progressPercent} /></div>
    </section>
    {error ? <p className={styles.error} role="alert">{error}</p> : null}
    <ol className={styles.steps} aria-label="Etapas de configuração da empresa">
      {screen.steps.map((step, index) => <li className={styles.step} data-current={screen.nextStepKey === step.key || undefined} data-state={step.state} key={step.key}>
        <div className={styles.stepNumber} aria-hidden="true">{step.state === "READY" ? "✓" : index + 1}</div>
        <div className={styles.stepBody}><div className={styles.stepTitle}><h3>{step.title}</h3><span>{labels[step.state]}</span></div><p>{step.description}</p><small>{step.detail}</small>
          <div className={styles.actions}>
            <Link className={styles.primary} href={step.href}>{step.actionLabel} <span aria-hidden="true">→</span></Link>
            {step.canSkip && step.state !== "READY" && step.state !== "SKIPPED" ? <button disabled={busyStep === step.key} onClick={() => void setStep(step, "SKIPPED")} type="button">{busyStep === step.key ? "Salvando…" : step.key === "TEAM" ? "Começar sozinho" : "Configurar depois"}</button> : null}
            {step.canSkip && step.state === "SKIPPED" ? <button disabled={busyStep === step.key} onClick={() => void setStep(step, "PENDING")} type="button">Retomar esta etapa</button> : null}
          </div>
        </div>
      </li>)}
    </ol>
    <section className={styles.finish} data-ready={screen.requiredComplete || undefined}><div><h2>{screen.requiredComplete ? "Tudo pronto para a equipe começar" : "Continue de onde parou"}</h2><p>{screen.requiredComplete ? "As etapas essenciais estão concluídas. Integrações opcionais podem ser adicionadas quando você precisar." : "Conclua a próxima etapa recomendada. O assistente reconhece automaticamente as mudanças feitas em cada área."}</p></div><Link href="/">Ir para o CRM <span aria-hidden="true">→</span></Link></section>
  </div>;
}
