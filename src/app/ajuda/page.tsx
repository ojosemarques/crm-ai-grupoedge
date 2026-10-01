import Link from "next/link";

import { PageHeader } from "@/components/layout/page-header";
import { requirePageAuthentication } from "@/modules/auth/http/authentication-guards";

export const dynamic = "force-dynamic";

export default async function HelpPage() {
  await requirePageAuthentication();

  return (
    <main className="page-canvas">
      <PageHeader eyebrow="Conta" title="Ajuda e suporte" description="Atalhos para resolver as dúvidas mais comuns do CRM." />
      <section className="surface-panel mt-6 grid gap-4 p-6 md:grid-cols-2">
        <article>
          <h2 className="text-lg font-semibold">Operação comercial</h2>
          <p className="mt-2 text-sm text-muted-foreground">Acompanhe o trabalho do dia, atividades e negócios em andamento.</p>
          <div className="mt-4 flex flex-wrap gap-3"><Link className="inline-flex min-h-10 items-center rounded-lg border border-border px-4 text-sm font-medium" href="/meu-dia">Abrir Meu Dia</Link><Link className="inline-flex min-h-10 items-center rounded-lg border border-border px-4 text-sm font-medium" href="/pipeline">Abrir negócios</Link></div>
        </article>
        <article>
          <h2 className="text-lg font-semibold">Acesso e configuração</h2>
          <p className="mt-2 text-sm text-muted-foreground">Para permissões, dados da empresa ou suporte técnico, procure o administrador do seu workspace.</p>
          <div className="mt-4 flex flex-wrap gap-3"><Link className="inline-flex min-h-10 items-center rounded-lg border border-border px-4 text-sm font-medium" href="/perfil">Minha conta</Link><Link className="inline-flex min-h-10 items-center rounded-lg border border-border px-4 text-sm font-medium" href="/hub">Minhas empresas</Link></div>
        </article>
      </section>
    </main>
  );
}
