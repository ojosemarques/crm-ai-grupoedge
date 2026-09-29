"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { LogoutButton } from "@/components/auth/logout-button";
import { GlobalSearch } from "@/components/layout/global-search";
import { Icon, type IconName } from "@/components/ui/icon";
import { cn } from "@/shared/core/ui/class-names";
import politizaiMark from "../../../public/brand/politizai-mark.png";

type SessionView = Readonly<{
  user: Readonly<{
    displayName: string;
    role: Readonly<{ key: string; name: string }>;
  }>;
  workspace: Readonly<{ slug: string }>;
}>;

type NavigationItem = Readonly<{
  href: string;
  icon: IconName;
  label: string;
  roles?: readonly string[];
}>;

const publicRoutes = new Set(["/login", "/acesso-negado", "/sessao-expirada"]);
const operationalRoles = ["administrator", "commercial_manager", "sdr"] as const;
const commercialRoles = ["administrator", "commercial_manager", "closer", "viewer"] as const;
const leadRoles = ["administrator", "commercial_manager", "sdr", "viewer"] as const;
const managerRoles = ["administrator", "commercial_manager"] as const;

const navigationGroups: ReadonlyArray<Readonly<{
  label: string;
  items: readonly NavigationItem[];
}>> = [
  {
    label: "Principal",
    items: [
      { href: "/", icon: "meu-dia", label: "Início" },
      { href: "/dashboard", icon: "dashboard", label: "Dashboard" },
      { href: "/metas", icon: "dashboard", label: "Metas" },
      { href: "/forecast", icon: "receita", label: "Forecast", roles: commercialRoles },
      { href: "/metricas-receita", icon: "dashboard", label: "Métricas de receita", roles: commercialRoles },
      { href: "/meu-dia", icon: "meu-dia", label: "Meu Dia", roles: operationalRoles },
      { href: "/inbox", icon: "inbox", label: "Inbox" },
      { href: "/leads", icon: "leads", label: "Leads", roles: leadRoles },
      { href: "/contas", icon: "equipe", label: "Contas", roles: commercialRoles },
      { href: "/pipeline", icon: "pipeline", label: "Pipeline", roles: leadRoles },
      { href: "/agenda", icon: "agenda", label: "Agenda" },
      { href: "/oportunidades", icon: "vendas", label: "Vendas", roles: commercialRoles },
      { href: "/contratos", icon: "receita", label: "Contratos", roles: commercialRoles },
      { href: "/onboarding", icon: "pipeline", label: "Onboarding", roles: commercialRoles },
      { href: "/customer-success", icon: "equipe", label: "Customer Success", roles: commercialRoles },
      { href: "/customer-service", icon: "inbox", label: "Atendimento", roles: commercialRoles },
      { href: "/farmer", icon: "receita", label: "Farmer", roles: commercialRoles },
      { href: "/receita", icon: "receita", label: "Receita", roles: commercialRoles },
      { href: "/pagamentos", icon: "receita", label: "Pagamentos", roles: commercialRoles },
    ],
  },
  {
    label: "Ferramentas",
    items: [
      { href: "/leads/entrada", icon: "entrada", label: "Entrada de leads", roles: operationalRoles },
      { href: "/copilot", icon: "copilot", label: "Copilot gerencial", roles: managerRoles },
      { href: "/governanca-ia", icon: "copilot", label: "Governança de IA", roles: managerRoles },
      { href: "/notificacoes", icon: "notificacoes", label: "Notificações" },
    ],
  },
  {
    label: "Gestão",
    items: [
      { href: "/administracao", icon: "equipe", label: "Pessoas e equipes", roles: managerRoles },
      { href: "/automacoes", icon: "automacoes", label: "Automações", roles: managerRoles },
      { href: "/auditoria", icon: "auditoria", label: "Auditoria e saúde", roles: managerRoles },
      { href: "/qualidade-dados", icon: "auditoria", label: "Qualidade de dados", roles: managerRoles },
      { href: "/operacoes", icon: "auditoria", label: "Operações e segurança", roles: managerRoles },
      { href: "/privacidade", icon: "auditoria", label: "Privacidade", roles: managerRoles },
      { href: "/integracoes", icon: "configuracoes", label: "Integrações", roles: managerRoles },
      { href: "/aquisicao", icon: "dashboard", label: "Aquisição", roles: managerRoles },
      { href: "/inteligencia-geografica", icon: "dashboard", label: "Geografia", roles: managerRoles },
      { href: "/configuracoes", icon: "configuracoes", label: "Configurações", roles: ["administrator"] },
    ],
  },
];

const routeTitles: readonly Readonly<{ prefix: string; title: string }>[] = [
  { prefix: "/leads/entrada", title: "Entrada de leads" },
  { prefix: "/leads/", title: "Lead 360" },
  { prefix: "/meu-dia", title: "Meu Dia" },
  { prefix: "/metas", title: "Metas e quotas" },
  { prefix: "/forecast", title: "Forecast comercial" },
  { prefix: "/metricas-receita", title: "Métricas de receita" },
  { prefix: "/inbox", title: "Inbox" },
  { prefix: "/leads", title: "Leads" },
  { prefix: "/contas", title: "Contas" },
  { prefix: "/pipeline", title: "Pré-vendas" },
  { prefix: "/agenda", title: "Agenda" },
  { prefix: "/oportunidades", title: "Vendas" },
  { prefix: "/contratos", title: "Contratos comerciais" },
  { prefix: "/onboarding", title: "Handoff e onboarding" },
  { prefix: "/customer-success", title: "Customer Success" },
  { prefix: "/customer-service", title: "Atendimento ao cliente" },
  { prefix: "/farmer", title: "Farmer" },
  { prefix: "/receita", title: "Assinaturas e receita" },
  { prefix: "/pagamentos", title: "Cobranças e pagamentos" },
  { prefix: "/dashboard", title: "Dashboard" },
  { prefix: "/copilot", title: "Copilot gerencial" },
  { prefix: "/governanca-ia", title: "Governança de IA" },
  { prefix: "/notificacoes", title: "Notificações" },
  { prefix: "/administracao", title: "Pessoas e equipes" },
  { prefix: "/automacoes", title: "Automações" },
  { prefix: "/auditoria", title: "Auditoria e saúde" },
  { prefix: "/qualidade-dados", title: "Qualidade de dados" },
  { prefix: "/operacoes", title: "Operações, segurança e privacidade" },
  { prefix: "/privacidade", title: "Privacidade e retenção" },
  { prefix: "/integracoes/whatsapp", title: "WhatsApp" },
  { prefix: "/integracoes/email", title: "E-mail" },
  { prefix: "/integracoes/telefonia", title: "Telefonia" },
  { prefix: "/integracoes", title: "Integrações" },
  { prefix: "/aquisicao", title: "Aquisição e atribuição" },
  { prefix: "/inteligencia-geografica", title: "Inteligência geográfica" },
  { prefix: "/configuracoes", title: "Configurações" },
  { prefix: "/contatos/", title: "Contact 360" },
  { prefix: "/", title: "Início" },
];

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  if (href === "/leads") {
    return pathname === "/leads" || (pathname.startsWith("/leads/") && !pathname.startsWith("/leads/entrada"));
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

function initials(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export function AppShell({ children }: Readonly<{ children: ReactNode }>) {
  const pathname = usePathname();
  const [session, setSession] = useState<SessionView | null | undefined>(undefined);
  const [menuOpen, setMenuOpen] = useState(false);
  const publicRoute = publicRoutes.has(pathname);

  useEffect(() => {
    if (publicRoute) return;
    let active = true;
    void fetch("/api/auth/session", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return null;
        const body = await response.json() as { session?: SessionView };
        return body.session ?? null;
      })
      .then((value) => {
        if (active) setSession(value);
      })
      .catch(() => {
        if (active) setSession(null);
      });
    return () => {
      active = false;
    };
  }, [publicRoute]);

  useEffect(() => {
    if (!menuOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuOpen]);

  if (publicRoute) return children;

  const currentTitle = routeTitles.find((route) => pathname.startsWith(route.prefix))?.title ?? "Politizai CRM";
  const roleKey = session?.user.role.key;
  const canCreateLead = roleKey ? operationalRoles.some((role) => role === roleKey) : false;

  return (
    <>
      <a className="skip-link" href="#conteudo-principal">Pular para o conteúdo</a>
      <div className="app-shell">
        <button
          aria-label="Fechar menu de navegação"
          className={cn("app-shell__backdrop", menuOpen && "is-visible")}
          onClick={() => setMenuOpen(false)}
          tabIndex={menuOpen ? 0 : -1}
          type="button"
        />
        <aside className={cn("app-sidebar", menuOpen && "is-open")} id="menu-principal">
          <div className="app-brand">
            <span aria-hidden="true" className="app-brand__mark">
              <Image alt="" priority src={politizaiMark} />
            </span>
            <span><strong>POLITIZAI</strong><small>CRM comercial</small></span>
          </div>

          {session === undefined ? (
            <div aria-label="Carregando navegação" className="app-nav-skeleton" role="status">
              {Array.from({ length: 8 }, (_, index) => <span key={index} />)}
            </div>
          ) : (
            <nav aria-label="Navegação principal" className="app-nav">
              {navigationGroups.map((group) => {
                const items = group.items.filter((item) => !item.roles || (roleKey && item.roles.includes(roleKey)));
                if (items.length === 0) return null;
                return (
                  <section key={group.label}>
                    <p className="app-nav__label">{group.label}</p>
                    <div className="app-nav__items">
                      {items.map((item) => (
                        <Link
                          aria-current={isActive(pathname, item.href) ? "page" : undefined}
                          className="app-nav__link"
                          href={item.href}
                          key={item.href}
                          onClick={() => setMenuOpen(false)}
                        >
                          <span aria-hidden="true" className="app-nav__icon"><Icon name={item.icon} size={18} /></span>
                          <span>{item.label}</span>
                        </Link>
                      ))}
                    </div>
                  </section>
                );
              })}
            </nav>
          )}

          <div className="app-sidebar__account">
            <span aria-hidden="true" className="app-avatar">{initials(session?.user.displayName ?? "Usuário")}</span>
            <span><strong>{session?.user.displayName ?? "Sessão local"}</strong><small>{session?.user.role.name ?? "Carregando perfil…"}</small></span>
          </div>
        </aside>

        <div className="app-shell__main">
          <header className="app-topbar">
            <div className="flex min-w-0 items-center gap-3">
              <button
                aria-controls="menu-principal"
                aria-expanded={menuOpen}
                aria-label="Abrir menu de navegação"
                className="app-topbar__menu"
                onClick={() => setMenuOpen(true)}
                type="button"
              >
                <span aria-hidden="true">☰</span>
              </button>
              <div className="min-w-0"><p className="app-topbar__context">Politizai CRM</p><p className="app-topbar__title">{currentTitle}</p></div>
            </div>
            <div className="app-topbar__actions">
              {session ? <GlobalSearch /> : null}
              {canCreateLead ? (
                <Link className="app-topbar__primary-action" href="/leads/entrada">
                  <Icon name="mais" size={16} />
                  <span>Novo lead</span>
                </Link>
              ) : null}
              {session ? (
                <Link aria-label="Abrir notificações" className="app-topbar__icon-action" href="/notificacoes">
                  <Icon name="notificacoes" size={18} />
                </Link>
              ) : null}
              <span className="app-environment" title="Aplicação executada somente neste computador"><span aria-hidden="true" />Local</span>
              {session ? <span className="app-workspace">{session.workspace.slug}</span> : null}
              <LogoutButton />
            </div>
          </header>
          <div className="app-content" id="conteudo-principal" tabIndex={-1}>{children}</div>
        </div>
      </div>
    </>
  );
}
