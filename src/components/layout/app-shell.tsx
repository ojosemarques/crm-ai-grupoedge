"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore, type ComponentProps, type ReactNode } from "react";

import { CopilotDrawer } from "@/components/layout/copilot-drawer";
import { GlobalSearch } from "@/components/layout/global-search";
import { announceCompanySwitch, useCompanySession } from "@/components/layout/use-company-session";
import { BrandLogo } from "@/components/ui/brand-logo";
import { Icon, type IconName } from "@/components/ui/icon";
import { cn } from "@/shared/core/ui/class-names";
import styles from "./app-shell.module.css";

export type AppShellSession = Readonly<{
  id: string;
  user: Readonly<{
    displayName: string;
    email: string;
    role: Readonly<{ key: string; name: string }>;
    permissionKeys: readonly string[];
  }>;
  workspace: Readonly<{ slug: string; name: string; count: number }>;
}>;

type NavigationItem = Readonly<{
  href: string;
  icon: IconName;
  label: string;
  permission?: string;
  roles?: readonly string[];
}>;

const publicRoutes = new Set(["/login", "/acesso-negado", "/sessao-expirada", "/hub"]);
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
      { href: "/pipeline", icon: "pipeline", label: "Pré-vendas", roles: leadRoles },
      { href: "/leads", icon: "leads", label: "Leads", roles: leadRoles },
      { href: "/agenda", icon: "agenda", label: "Agenda" },
      { href: "/inbox", icon: "inbox", label: "Conversas" },
      { href: "/atividades", icon: "meu-dia", label: "Atividades", roles: commercialRoles },
    ],
  },
  {
    label: "Indicadores",
    items: [
      { href: "/dashboard", icon: "dashboard", label: "Visão geral", permission: "metrics.read" },
      { href: "/gestao-equipe", icon: "equipe", label: "Gestão da equipe", roles: managerRoles },
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
  { key: "analytics", label: "Indicadores", icon: "dashboard", paths: ["/dashboard", "/gestao-equipe", "/metas", "/forecast", "/metricas-receita", "/receita", "/analises"] },
  { key: "finance", label: "Financeiro", icon: "receita", paths: ["/financeiro", "/pagamentos", "/contratos"] },
  { key: "customers", label: "Clientes", icon: "leads", paths: ["/contas", "/onboarding", "/customer-success", "/customer-service", "/farmer"] },
  { key: "marketing", label: "Marketing", icon: "dashboard", paths: ["/aquisicao/midia", "/aquisicao", "/integracoes/meta-ads", "/integracoes/google-ads", "/integracoes"] },
  { key: "settings", label: "Configurações", icon: "configuracoes", paths: ["/configuracoes", "/administracao", "/auditoria", "/qualidade-dados", "/operacoes", "/privacidade"] },
] as const;

const labels: Record<string, string> = {
  "/pipeline": "Pré-vendas", "/leads": "Leads",
  "/inbox": "Conversas",
  "/atividades": "Fila de atividades",
  "/campanhas": "Campanhas de envio",
  "/assistente": "Assistente",
  "/automacoes": "Fluxos de automação", "/dashboard": "Visão geral", "/gestao-equipe": "Gestão da equipe", "/analises": "Análises", "/metricas-receita": "Receita e retenção",
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

function IntentLink(props: ComponentProps<typeof Link>) {
  return <Link {...props} />;
}

export function AppShell({ children, initialSession }: Readonly<{ children: ReactNode; initialSession: AppShellSession | null }>) {
  const pathname = usePathname();
  const session = initialSession;
  const [menuOpen, setMenuOpen] = useState(false);
  const [copilotOpen, setCopilotOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState(false);
  const isMobile = useSyncExternalStore(subscribeToMobileLayout, mobileLayoutSnapshot, serverLayoutSnapshot);
  const menuRef = useRef<HTMLElement>(null);
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const publicRoute = publicRoutes.has(pathname);
  useCompanySession(publicRoute ? undefined : session?.id);

  useEffect(() => {
    const savedTheme = window.localStorage.getItem("politizai-crm-theme-v2");
    if (savedTheme === "dark") {
      document.documentElement.dataset.theme = "dark";
    }
  }, []);

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

  useEffect(() => {
    if (!profileMenuOpen) return;
    const closeProfileMenu = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent && event.key === "Escape") {
        setProfileMenuOpen(false);
        return;
      }
      if (event instanceof MouseEvent && event.target instanceof Node && !profileMenuRef.current?.contains(event.target)) {
        setProfileMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", closeProfileMenu);
    document.addEventListener("keydown", closeProfileMenu);
    return () => {
      document.removeEventListener("mousedown", closeProfileMenu);
      document.removeEventListener("keydown", closeProfileMenu);
    };
  }, [profileMenuOpen]);

  async function logout() {
    setLogoutError(false);
    setLoggingOut(true);
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error("logout_failed");
      announceCompanySwitch();
      window.location.assign(new URL("/login", window.location.origin).href);
    } catch {
      setLogoutError(true);
      setLoggingOut(false);
    }
  }

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
  const mobileCriticalItems = ["/meu-dia", "/inbox", "/atividades", "/dashboard"]
    .flatMap((href) => allowedItems.filter((item) => item.href === href));
  const isPolitizaiWorkspace = session?.workspace.slug.trim().toLowerCase() === "politizai";
  const workspaceBrandName = isPolitizaiWorkspace ? "Politizai" : "EDGE GROUP";
  return (
    <>
      <a className="skip-link" href="#conteudo-principal">Pular para o conteúdo</a>
      <div className={cn("app-shell", styles.shell)}>
        <header className={styles.topbar} onKeyDown={(event) => { if (event.key === "Escape" && event.target instanceof HTMLElement) { const details = event.target.closest("details"); details?.removeAttribute("open"); details?.querySelector("summary")?.focus(); } }}>
          <IntentLink aria-label={`${workspaceBrandName}, início`} className={styles.brand} href="/">
            <BrandLogo variant={isPolitizaiWorkspace ? "politizai" : "edge-group"} />
          </IntentLink>
          <nav aria-label="Módulos do CRM" className={styles.topnav}>
            {availableSections.filter((section) => section.key !== "settings").map((section) => (
              <IntentLink aria-current={activeSection?.key === section.key ? "true" : undefined} href={section.items[0]!.href} key={section.key} onClick={() => setMenuOpen(false)}>{section.label}</IntentLink>
            ))}
          </nav>
          <div className={styles.actions}>
            {session ? <GlobalSearch /> : null}
            {canCreateLead ? <IntentLink aria-label="Novo lead" className={styles.newButton} href="/leads/entrada"><Icon name="mais" size={14} /><span>Novo</span></IntentLink> : null}
            <IntentLink aria-label="Notificações" className={styles.iconButton} href="/notificacoes"><Icon name="notificacoes" size={17} /></IntentLink>
            {canUseCopilot ? <button aria-label="Copilot" aria-controls="copilot-drawer" aria-expanded={copilotOpen} className={styles.copilotButton} onClick={() => setCopilotOpen((current) => !current)} type="button"><Icon name="copilot" size={16} /><span>Copilot</span></button> : null}
          </div>
        </header>
        <button aria-label="Fechar navegação" className={cn(styles.backdrop, menuOpen && styles.visible)} onClick={() => { setProfileMenuOpen(false); setMenuOpen(false); }} tabIndex={menuOpen ? 0 : -1} type="button" />
        <aside aria-hidden={isMobile && !menuOpen ? true : undefined} className={cn(styles.sidebar, menuOpen && styles.open)} id="menu-principal" inert={isMobile && !menuOpen} ref={menuRef}>
          <div className={styles.sidebarHeading}><Icon name={activeSection?.icon ?? "dashboard"} size={15} /><span>{activeSection?.label ?? "Workspace"}</span></div>
          <nav aria-label="Navegação da área" className={styles.contextNav}>
            {activeSection?.items.map((item, index) => (
              <IntentLink aria-current={isActive(pathname, item.href) ? "page" : undefined} aria-label={labels[item.href] ?? item.label} className={styles.contextLink} href={item.href} key={item.href} onClick={() => setMenuOpen(false)} title={labels[item.href] ?? item.label}>
                <span className={styles.navIcon} data-color={index % 5}><Icon name={item.icon} size={15} /></span><span>{labels[item.href] ?? item.label}</span>
              </IntentLink>
            ))}
          </nav>
          <div className={styles.sidebarBottom}>
            <div className={styles.profileMenuHost} ref={profileMenuRef}>
              <button aria-controls="profile-menu" aria-expanded={profileMenuOpen} aria-haspopup="dialog" aria-label="Abrir menu do usuário" className={styles.account} onClick={() => setProfileMenuOpen((open) => !open)} title="Menu do usuário" type="button">
                <span className={styles.avatar}>{initials(session?.user.displayName ?? "Usuário")}</span>
                <span><strong>{session?.user.displayName ?? "Minha conta"}</strong><small>{session?.user.role.name ?? ""}</small></span>
                <span aria-hidden="true" className={styles.accountChevron}>⌃</span>
              </button>
              {profileMenuOpen && (!isMobile || menuOpen) ? <section aria-label="Menu do usuário" className={styles.profileMenu} id="profile-menu" role="dialog">
                <div className={styles.profileBanner}>
                  {availableSections.find((section) => section.key === "settings") ? <IntentLink aria-label="Abrir configurações" className={styles.profileSettings} href="/configuracoes" onClick={() => { setProfileMenuOpen(false); setMenuOpen(false); }} title="Configurações"><Icon name="configuracoes" size={20} /></IntentLink> : null}
                </div>
                <div className={styles.profileAvatar} aria-label={`Foto de ${session?.user.displayName ?? "usuário"}`} role="img">{initials(session?.user.displayName ?? "Usuário")}</div>
                <div className={styles.profileIdentity}>
                  <strong>{session?.user.displayName ?? "Minha conta"}</strong>
                  <span>{session?.user.email || "E-mail não informado"}</span>
                </div>
                <dl className={styles.profileDetails}>
                  <div><dt>Cargo</dt><dd>{session?.user.role.name ?? "Não informado"}</dd></div>
                  <div><dt>Empresa</dt><dd>{session?.workspace.name ?? "Não informada"}</dd></div>
                </dl>
                <nav aria-label="Atalhos da conta" className={styles.profileActions}>
                  <IntentLink href="/perfil" onClick={() => { setProfileMenuOpen(false); setMenuOpen(false); }}><Icon name="leads" size={18} /><span>Meu perfil</span></IntentLink>
                  <IntentLink href="/hub" onClick={() => { setProfileMenuOpen(false); setMenuOpen(false); }}><Icon name="pipeline" size={18} /><span>{(session?.workspace.count ?? 1) > 1 ? "Trocar de empresa" : "Minhas empresas"}</span></IntentLink>
                  <IntentLink href="/ajuda" onClick={() => { setProfileMenuOpen(false); setMenuOpen(false); }}><Icon name="inbox" size={18} /><span>Ajuda e suporte</span></IntentLink>
                  {availableSections.find((section) => section.key === "settings") ? <IntentLink href="/configuracoes" onClick={() => { setProfileMenuOpen(false); setMenuOpen(false); }}><Icon name="configuracoes" size={18} /><span>Configurações</span></IntentLink> : null}
                  <button className={styles.profileLogout} disabled={loggingOut} onClick={() => void logout()} type="button"><Icon name="sair" size={18} /><span>{loggingOut ? "Saindo..." : "Sair da conta"}</span></button>
                  {logoutError ? <span className={styles.profileLogoutError} role="alert">Não foi possível sair. Tente novamente.</span> : null}
                </nav>
              </section> : null}
            </div>
          </div>
        </aside>
        <div className={styles.mobileBar}><button aria-controls="menu-principal" aria-expanded={menuOpen} onClick={() => { setProfileMenuOpen(false); setMenuOpen((open) => !open); }} type="button"><Icon name="dashboard" size={17} />{activeSection?.label ?? "Navegação"}<span>⌄</span></button></div>
        <nav aria-label="Atalhos operacionais" className={styles.mobileDock}>
          {mobileCriticalItems.map((item) => (
            <IntentLink aria-current={isActive(pathname, item.href) ? "page" : undefined} href={item.href} key={item.href} onClick={() => setMenuOpen(false)}>
              <Icon name={item.icon} size={18} />
              <span>{item.href === "/dashboard" ? "Painel" : item.label}</span>
            </IntentLink>
          ))}
        </nav>
        {canUseCopilot ? <CopilotDrawer onClose={() => setCopilotOpen(false)} open={copilotOpen} /> : null}
        <div className={cn("app-content", styles.content)} id="conteudo-principal" tabIndex={-1}>{children}</div>
      </div>
    </>
  );
}
