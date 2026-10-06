import { LoginForm } from "@/app/login/login-form";
import { BrandLogo } from "@/components/ui/brand-logo";

function safeRedirect(value: string | string[] | undefined): string | undefined {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (
    !candidate
    || candidate.length > 4_096
    || !candidate.startsWith("/")
    || candidate.startsWith("//")
    || candidate.includes("\\")
    || /[\u0000-\u001F\u007F]/.test(candidate)
  ) return undefined;
  return candidate;
}

export default async function LoginPage({ searchParams }: Readonly<{ searchParams: Promise<{ next?: string | string[] }> }>) {
  const redirectTo = safeRedirect((await searchParams).next);
  return (
    <main className="login-shell">
      <div className="login-card">
        <section className="login-context" aria-labelledby="product-title">
          <div className="login-context__copy">
            <h2 id="product-title">Simplifique processos.<br />Acelere resultados.</h2>
            <p>As empresas do grupo, suas equipes e os resultados da operação em um só lugar.</p>
          </div>
        </section>

        <section className="login-panel" aria-labelledby="login-title">
          <header className="login-panel__header">
            <div className="login-brand">
              <BrandLogo appearance="light" />
            </div>
            <h1 id="login-title">Entre na sua conta</h1>
            <p>Entre com e-mail e senha. Depois, escolha sua empresa.</p>
          </header>

          <LoginForm {...(redirectTo ? { redirectTo } : {})} />
        </section>
      </div>
    </main>
  );
}
