"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";

import { CopilotDrawer } from "@/components/layout/copilot-drawer";
import { GlobalSearch } from "@/components/layout/global-search";
import { BrandLogo } from "@/components/ui/brand-logo";
import { Icon, type IconName } from "@/components/ui/icon";
import { cn } from "@/shared/core/ui/class-names";
import styles from "./app-shell.module.css";

type SessionView = Readonly<{
  user: Readonly<{
    displayName: string;
    role: Readonly<{ key: string; name: string }>;
    permissionKeys: readonly string[];
  }>;
  workspace: Readonly<{ slug: string }>;
}>;

type NavigationItem = Readonly<{
  href: string;
  icon: IconName;
  label: string;
  permission?: string;
  roles?: readonly string[];
}>;

const publicRoutes = new Set(["/login", "/acesso-negado", "/sessao-expirada"]);
const operationalRoles = ["administrator", "commercial_manager", "sdr", "closer"] as const;
const commercialRoles = ["administrator", "commercial_manager", "closer", "viewer"] as const;
const leadRoles = ["administrator", "commercial_manager", "sdr", "closer", "viewer"] as const;
const managerRoles = ["administrator", "commercial_manager"] as const;

const navigationGroups: ReadonlyArray<Readonly<{
  label: string;
  items: readonly NavigationItem[];
}>> = [
  {
    label: "Trabalho",
    items: [
      { href: "/meu-dia", icon: "meu-dia", label: "Meu Dia", roles: operationalRoles },
      { href: "/pipeline", icon: "pipeline", label: "Pipeline", roles: leadRoles },
      { href: "/oportunidades", icon: "receita", label: "Vendas e propostas", permission: "opportunities.read" },
      { href: "/leads", icon: "leads", label: "Leads", roles: leadRoles },
      { href: "/agenda", icon: "agenda", label: "Agenda" },
      { href: "/inbox", icon: "inbox", label: "Conversas" },
      { href: "/atividades", icon: "meu-dia", label: "Atividades", roles: commercialRoles },
      { href: "/automacoes", icon: "automacoes", label: "Automações", permission: "automations.read" },
    ],
  },
  {
    label: "Indicadores",
    items: [
      { href: "/dashboard", icon: "dashboard", label: "Visão geral", permission: "metrics.read" },
      { href: "/metas", icon: "dashboard", label: "Metas", permission: "metrics.read" },
      { href: "/forecast", icon: "receita", label: "Forecast", permission: "metrics.read" },
      { href: "/metricas-receita", icon: "dashboard", label: "Receita e retenção", permission: "metrics.read" },
      { href: "/receita", icon: "receita", label: "Receita", permission: "metrics.read" },
      { href: "/analises", icon: "dashboard", label: "Análises", permission: "metrics.read" },
    ],
  },
  {
    label: "Financeiro",
    items: [
      { href: "/financeiro", icon: "receita", label: "Financeiro", permission: "finance.read" },
      { href: "/pagamentos", icon: "receita", label: "Cobranças e pagamentos", permission: "payments.read" },
      { href: "/contratos", icon: "meu-dia", label: "Contratos", permission: "contracts.read" },
    ],
  },
  {
    label: "Clientes",
    items: [
      { href: "/contas", icon: "leads", label: "Clientes e empresas", permission: "accounts.read" },
      { href: "/onboarding", icon: "pipeline", label: "Onboarding", permission: "onboarding.read" },
      { href: "/customer-success", icon: "equipe", label: "Sucesso do cliente", permission: "customer_success.read" },
      { href: "/customer-service", icon: "inbox", label: "Atendimento e satisfação", permission: "customer_service.read" },
      { href: "/farmer", icon: "receita", label: "Renovações e expansão", permission: "farmer.read" },
    ],
  },
  {
    label: "Marketing",
    items: [
      { href: "/aquisicao/midia", icon: "dashboard", label: "Anúncios e funil", permission: "marketing.media.read" },
      { href: "/integracoes/meta-ads", icon: "configuracoes", label: "Meta Ads", permission: "integrations.read" },
      { href: "/integracoes/google-ads", icon: "configuracoes", label: "Google Ads", permission: "integrations.read" },
      { href: "/integracoes", icon: "configuracoes", label: "Integrações", permission: "integrations.read" },
    ],
  },
  {
    label: "Assistentes",
    items: [
      { href: "/copilot", icon: "copilot", label: "Copilot gerencial", roles: managerRoles },
      { href: "/assistente", icon: "copilot", label: "Assistente", roles: managerRoles },
      { href: "/governanca-ia", icon: "configuracoes", label: "Configuração da IA", permission: "ai.governance.read" },
      { href: "/notificacoes", icon: "notificacoes", label: "Notificações" },
    ],
  },
  {
    label: "Gestão",
    items: [
      { href: "/administracao", icon: "equipe", label: "Pessoas e equipes", roles: managerRoles },
      { href: "/auditoria", icon: "auditoria", label: "Auditoria e saúde", roles: managerRoles },
      { href: "/qualidade-dados", icon: "auditoria", label: "Qualidade de dados", roles: managerRoles },
      { href: "/operacoes", icon: "auditoria", label: "Operações e segurança", roles: managerRoles },
      { href: "/privacidade", icon: "auditoria", label: "Privacidade", roles: managerRoles },
      { href: "/aquisicao", icon: "dashboard", label: "Aquisição", roles: managerRoles },
      { href: "/inteligencia-geografica", icon: "dashboard", label: "Geografia", roles: managerRoles },
      { href: "/configuracoes", icon: "configuracoes", label: "Configurações", roles: ["administrator"] },
    ],
  },
];

const sections = [
  { key: "work", label: "Trabalho", icon: "meu-dia", paths: ["/meu-dia", "/pipeline", "/oportunidades", "/leads", "/agenda", "/inbox", "/atividades", "/automacoes"] },
  { key: "analytics", label: "Indicadores", icon: "dashboard", paths: ["/dashboard", "/metas", "/forecast", "/metricas-receita", "/receita", "/analises"] },
  { key: "finance", label: "Financeiro", icon: "receita", paths: ["/financeiro", "/pagamentos", "/contratos"] },
  { key: "customers", label: "Clientes", icon: "leads", paths: ["/contas", "/onboarding", "/customer-success", "/customer-service", "/farmer"] },
  { key: "marketing", label: "Marketing", icon: "dashboard", paths: ["/aquisicao/midia", "/aquisicao", "/integracoes/meta-ads", "/integracoes/google-ads", "/integracoes"] },
  { key: "assistants", label: "Assistentes", icon: "copilot", paths: ["/copilot", "/assistente", "/governanca-ia", "/notificacoes"] },
  { key: "settings", label: "Configurações", icon: "configuracoes", paths: ["/configuracoes", "/administracao", "/auditoria", "/qualidade-dados", "/operacoes", "/privacidade"] },
] as const;

const labels: Record<string, string> = {
  "/pipeline": "Negócios", "/leads": "Leads",
  "/inbox": "Conversas",
  "/atividades": "Fila de atividades",
  "/campanhas": "Campanhas de envio",
  "/assistente": "Assistente",
  "/automacoes": "Fluxos de automação", "/dashboard": "Visão geral", "/analises": "Análises", "/metricas-receita": "Receita e retenção",
};

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

function subscribeToMobileLayout(onChange: () => void) {
  const media = window.matchMedia("(max-width: 800px)");
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

const mobileLayoutSnapshot = () => window.matchMedia("(max-width: 800px)").matches;
const serverLayoutSnapshot = () => false;

export function AppShell({ children }: Readonly<{ children: ReactNode }>) {
  const pathname = usePathname();
  const [session, setSession] = useState<SessionView | null | undefined>(undefined);
  const [menuOpen, setMenuOpen] = useState(false);
  const [copilotOpen, setCopilotOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(true);
  const isMobile = useSyncExternalStore(subscribeToMobileLayout, mobileLayoutSnapshot, serverLayoutSnapshot);
  const menuRef = useRef<HTMLElement>(null);
  const publicRoute = publicRoutes.has(pathname);

  useEffect(() => {
    const savedTheme = window.localStorage.getItem("politizai-crm-theme-v2");
    if (savedTheme === "dark") {
      document.documentElement.dataset.theme = "dark";
    }
  }, []);

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
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    menuRef.current?.querySelector<HTMLElement>("a, button")?.focus();
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
      if (event.key === "Tab") {
        const links = [...(menuRef.current?.querySelectorAll<HTMLElement>("a, button") ?? [])].filter((element) => element.getClientRects().length > 0);
        const first = links[0]; const last = links.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuOpen]);

  if (publicRoute) return children;

  const roleKey = session?.user.role.key;
  const permissionKeys = new Set(session?.user.permissionKeys ?? []);
  const canCreateLead = roleKey ? operationalRoles.some((role) => role === roleKey) : false;
  const canUseCopilot = permissionKeys.has("ai.use");
  const allowedItems = navigationGroups.flatMap((group) => group.items).filter((item) =>
    (!item.permission || permissionKeys.has(item.permission)) &&
    (!item.roles || (roleKey && item.roles.includes(roleKey))),
  );
  const availableSections = sections.map((section) => ({ ...section, items: section.paths.flatMap((href) => allowedItems.filter((item) => item.href === href)) })).filter((section) => section.items.length > 0);
  const activeSection = availableSections.find((section) => section.items.some((item) => isActive(pathname, item.href))) ?? availableSections.find((section) => section.key === "work");
  const mobileCriticalItems = ["/meu-dia", "/pipeline", "/inbox", "/atividades", "/dashboard"]
    .flatMap((href) => allowedItems.filter((item) => item.href === href));
  return (
    <>
      <a className="skip-link" href="#conteudo-principal">Pular para o conteúdo</a>
      <div className={cn("app-shell", styles.shell, collapsed && styles.collapsed)}>
        <header className={styles.topbar} onKeyDown={(event) => { if (event.key === "Escape" && event.target instanceof HTMLElement) { const details = event.target.closest("details"); details?.removeAttribute("open"); details?.querySelector("summary")?.focus(); } }}>
          <Link aria-label="Politizai, início" className={styles.brand} href="/">
            <BrandLogo />
          </Link>
          <nav aria-label="Módulos do CRM" className={styles.topnav}>
            {availableSections.filter((section) => section.key !== "settings").map((section) => (
              <Link aria-current={activeSection?.key === section.key ? "true" : undefined} href={section.items[0]!.href} key={section.key} onClick={() => setMenuOpen(false)}>{section.label}</Link>
            ))}
          </nav>
          <div className={styles.actions}>
            {session ? <GlobalSearch /> : null}
            {canCreateLead ? <Link aria-label="Novo lead" className={styles.newButton} href="/leads/entrada"><Icon name="mais" size={14} /><span>Novo</span></Link> : null}
            <Link aria-label="Notificações" className={styles.iconButton} href="/notificacoes"><Icon name="notificacoes" size={17} /></Link>
            {canUseCopilot ? <button aria-label="Copilot" aria-controls="copilot-drawer" aria-expanded={copilotOpen} className={styles.copilotButton} onClick={() => setCopilotOpen((current) => !current)} type="button"><Icon name="copilot" size={16} /><span>Copilot</span></button> : null}
          </div>
        </header>
        <button aria-label="Fechar navegação" className={cn(styles.backdrop, menuOpen && styles.visible)} onClick={() => setMenuOpen(false)} tabIndex={menuOpen ? 0 : -1} type="button" />
        <aside aria-hidden={isMobile && !menuOpen ? true : undefined} className={cn(styles.sidebar, menuOpen && styles.open)} id="menu-principal" inert={isMobile && !menuOpen} ref={menuRef}>
          <div className={styles.sidebarHeading}><Icon name={activeSection?.icon ?? "dashboard"} size={15} /><span>{activeSection?.label ?? "Workspace"}</span><button aria-label={collapsed ? "Expandir menu" : "Recolher menu"} className={styles.collapseButton} onClick={() => setCollapsed(!collapsed)} type="button">{collapsed ? "›" : "‹"}</button></div>
          <nav aria-label="Navegação da área" className={styles.contextNav}>
            {session === undefined ? <div aria-label="Carregando navegação" className={styles.skeleton} role="status">{Array.from({ length: 5 }, (_, index) => <span key={index} />)}</div> : activeSection?.items.map((item, index) => (
              <Link aria-current={isActive(pathname, item.href) ? "page" : undefined} aria-label={labels[item.href] ?? item.label} className={styles.contextLink} href={item.href} key={item.href} onClick={() => setMenuOpen(false)} title={labels[item.href] ?? item.label}>
                <span className={styles.navIcon} data-color={index % 5}><Icon name={item.icon} size={15} /></span><span>{labels[item.href] ?? item.label}</span>
              </Link>
            ))}
          </nav>
          <div className={styles.sidebarBottom}>
            <Link aria-label="Meu workspace" href="/" onClick={() => setMenuOpen(false)} title="Meu workspace"><Icon name="meu-dia" size={16} /><span>Meu workspace</span></Link>
            {availableSections.find((section) => section.key === "settings") ? <Link aria-label="Configurações" href={availableSections.find((section) => section.key === "settings")!.items[0]!.href} onClick={() => setMenuOpen(false)} title="Configurações"><Icon name="configuracoes" size={16} /><span>Configurações</span></Link> : null}
            <Link aria-label="Minha conta" className={styles.account} href="/perfil" onClick={() => setMenuOpen(false)} title="Minha conta"><span className={styles.avatar}>{initials(session?.user.displayName ?? "Usuário")}</span><span><strong>{session?.user.displayName ?? "Minha conta"}</strong><small>{session?.user.role.name ?? ""}</small></span></Link>
          </div>
        </aside>
        <div className={styles.mobileBar}><button aria-controls="menu-principal" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)} type="button"><Icon name="dashboard" size={17} />{activeSection?.label ?? "Navegação"}<span>⌄</span></button></div>
        <nav aria-label="Atalhos operacionais" className={styles.mobileDock}>
          {mobileCriticalItems.map((item) => (
            <Link aria-current={isActive(pathname, item.href) ? "page" : undefined} href={item.href} key={item.href} onClick={() => setMenuOpen(false)}>
              <Icon name={item.icon} size={18} />
              <span>{item.href === "/pipeline" ? "Funil" : item.href === "/dashboard" ? "Painel" : item.label}</span>
            </Link>
          ))}
        </nav>
        {canUseCopilot ? <CopilotDrawer onClose={() => setCopilotOpen(false)} open={copilotOpen} /> : null}
        <div className={cn("app-content", styles.content)} id="conteudo-principal" tabIndex={-1}>{children}</div>
      </div>
    </>
  );
}
