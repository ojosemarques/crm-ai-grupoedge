import { ChangePasswordForm } from "@/app/perfil/change-password-form";
import { PageHeader } from "@/components/layout/page-header";
import { requirePageAuthentication } from "@/modules/auth/http/authentication-guards";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const context = await requirePageAuthentication();
  return (
    <main className="page-canvas">
      <PageHeader eyebrow="Minha conta" title="Segurança da conta" description="Altere sua senha de acesso ao workspace." meta={context.displayName} />
      <section className="surface-panel mt-6 max-w-xl p-6">
        <h2 className="text-lg font-semibold">Alterar senha</h2>
        <p className="mt-2 text-sm text-muted-foreground">Depois da alteração, todas as sessões serão encerradas. Entre novamente com a nova senha.</p>
        <ChangePasswordForm />
      </section>
    </main>
  );
}
