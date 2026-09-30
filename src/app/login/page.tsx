import { LoginForm } from "@/app/login/login-form";
import { BrandLogo } from "@/components/ui/brand-logo";

export default function LoginPage() {
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

          <LoginForm />

          <div className="login-panel__assurance">
            <p className="login-panel__divider"><span>Acesso às empresas do grupo</span></p>
            <div className="login-panel__assurance-pill"><span aria-hidden="true">✦</span> Seu acesso é individual e protegido</div>
            <div className="login-panel__assurance-pill"><span aria-hidden="true">●</span> Empresas disponíveis conforme suas permissões</div>
            <p className="login-panel__footnote">Ainda não tem acesso? Fale com o administrador.</p>
          </div>
        </section>
      </div>
    </main>
  );
}
