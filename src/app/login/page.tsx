import Image from "next/image";

import { LoginForm } from "@/app/login/login-form";
import politizaiMark from "../../../public/brand/politizai-mark.png";

export default function LoginPage() {
  return (
    <main className="login-shell">
      <section className="login-context" aria-labelledby="product-title">
        <div className="login-brand">
          <span><Image alt="" priority src={politizaiMark} /></span>
          <strong>POLITIZAI <small>CRM comercial</small></strong>
        </div>
        <h2 id="product-title">Operação comercial com contexto e próxima ação.</h2>
        <p>Leads, SLA, reuniões e oportunidades em uma fonte única e auditável.</p>
        <ul aria-label="Princípios do produto">
          <li><span aria-hidden="true">01</span> Prioridade explicável</li>
          <li><span aria-hidden="true">02</span> Histórico persistido</li>
          <li><span aria-hidden="true">03</span> Decisão humana</li>
        </ul>
      </section>
      <section className="login-panel" aria-labelledby="login-title">
        <div className="login-brand login-brand--mobile">
          <span><Image alt="" priority src={politizaiMark} /></span>
          <strong>POLITIZAI <small>CRM comercial</small></strong>
        </div>
        <p className="eyebrow">Acesso local seguro</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight" id="login-title">Entrar</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">Use o workspace, o e-mail e a senha fornecidos pelo administrador.</p>
        <LoginForm />
      </section>
    </main>
  );
}
