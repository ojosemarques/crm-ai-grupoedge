"use client";

import { useState, type FormEvent } from "react";
import { BrandLogo } from "@/components/ui/brand-logo";
import { announceCompanySwitch, useCompanySession } from "@/components/layout/use-company-session";
import type { CompanyHubScreen } from "@/modules/users/domain/company-hub-contracts";
import styles from "./hub.module.css";

type Pending = { title: string; description: string; command: Record<string, unknown> };

export function CompanyHub({ initial, sessionId }: { initial: CompanyHubScreen; sessionId: string }) {
  const [screen, setScreen] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showAccess, setShowAccess] = useState(false);
  const [sourceId, setSourceId] = useState(initial.currentWorkspaceId);
  const [targetId, setTargetId] = useState("");
  useCompanySession(sessionId);
  const managed = screen.companies.filter(c => c.canManage);
  const source = managed.find(c => c.id === sourceId);
  const target = managed.find(c => c.id === targetId);

  async function request(path: string, command?: Record<string, unknown>) {
    const response = await fetch(path, { cache: "no-store", ...(command ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(command) } : {}) });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error?.message ?? "Não foi possível concluir. Tente novamente.");
    return body;
  }

  async function enter(id: string, destination = "/") {
    setBusy(true); setError(null);
    try {
      await request("/api/auth/workspace", { workspaceId: id });
      announceCompanySwitch();
      window.location.assign(new URL(destination, window.location.origin).href);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao selecionar empresa."); setBusy(false); }
  }

  function prepareCompany(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(null); setMessage(null);
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    const slug = String(form.get("slug") ?? "").trim();
    setPending({ title: `Criar ${name}`, description: "Você será administrador. A empresa começará com funis, papéis de acesso e categorias financeiras próprios, sem dados ou conexões de outras empresas.", command: { action: "CREATE_COMPANY", name, slug, idempotencyKey: crypto.randomUUID(), confirmed: true } });
  }

  function prepareAccess(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(null); setMessage(null);
    const form = new FormData(event.currentTarget);
    const memberId = String(form.get("memberId"));
    const roleId = String(form.get("roleId"));
    const member = source?.members.find(m => m.id === memberId);
    const role = target?.roles.find(r => r.id === roleId);
    if (!member || !role || !target) return;
    setPending({ title: `Dar acesso a ${target.name}`, description: `${member.name} (${member.email}) terá o papel ${role.name}. A pessoa usará o mesmo e-mail e senha e continuará com seu acesso anterior.`, command: { action: "GRANT_ACCESS", sourceWorkspaceId: sourceId, targetWorkspaceId: targetId, memberId, roleId, confirmed: true } });
  }

  async function confirm() {
    if (!pending) return;
    setBusy(true); setError(null);
    try {
      await request("/api/hub", pending.command);
      setPending(null); setShowCreate(false); setShowAccess(false);
      setMessage("Alteração concluída e registrada no histórico de auditoria.");
      setScreen((await request("/api/hub")).result);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível concluir."); }
    finally { setBusy(false); }
  }

  async function logout() {
    setBusy(true); setError(null);
    try { await request("/api/auth/logout", {}); announceCompanySwitch(); window.location.assign(new URL("/login", window.location.origin).href); }
    catch { setError("Não foi possível sair. Tente novamente."); setBusy(false); }
  }

  return <main className={styles.hub}>
    <header className={styles.header}><BrandLogo /><button disabled={busy} onClick={() => void logout()} type="button">Sair da conta</button></header>
    <section className={styles.content}>
      <div className={styles.intro}><span className={styles.eyebrow}>SUAS EMPRESAS</span><h1>Onde vamos trabalhar?</h1><p>Olá, {screen.displayName}. Escolha a empresa para acessar sua operação.</p></div>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {message ? <p className={styles.success} role="status">{message}</p> : null}
      <div className={styles.grid}>
        {screen.companies.map(company => <article className={styles.card} key={company.id} aria-label={company.name}>
          <div className={styles.companyIcon} aria-hidden="true">{company.name.slice(0, 2).toUpperCase()}</div>
          <h2>{company.name}</h2><span className={styles.badge}>{company.roleName}</span>
          <p>CRM, clientes, financeiro e marketing em um só lugar.</p>
          <div className={styles.cardActions}>
            <button className={styles.primary} disabled={busy || !!pending} onClick={() => void enter(company.id)} type="button" aria-label={`Entrar em ${company.name}`}>Entrar na empresa <span aria-hidden="true">→</span></button>
            {company.canManage ? <button disabled={busy || !!pending} onClick={() => void enter(company.id, "/configuracao-inicial")} type="button" aria-label={`Configurar ${company.name}`}>Configurar empresa</button> : null}
          </div>
        </article>)}
      </div>
      {!screen.companies.length ? <p>Nenhuma empresa está disponível. Fale com o administrador para revisar seu acesso.</p> : null}
      <div className={styles.toolbar}>
        {screen.canCreate ? <button disabled={busy || !!pending} onClick={() => { setShowCreate(!showCreate); setShowAccess(false); }} type="button">+ Nova empresa</button> : null}
        {screen.canCreate && managed.length > 1 ? <button disabled={busy || !!pending} onClick={() => { setShowAccess(!showAccess); setShowCreate(false); }} type="button">Compartilhar acesso de usuário</button> : null}
      </div>
      {showCreate ? <form className={styles.panel} onSubmit={prepareCompany} aria-label="Nova empresa"><h2>Nova empresa</h2>
        <fieldset disabled={busy || !!pending}><label>Nome da empresa<input name="name" placeholder="Ex.: Authentico" required minLength={2} maxLength={120} onChange={event => { const field = event.currentTarget.form?.elements.namedItem("slug"); if (field instanceof HTMLInputElement && !field.dataset.edited) field.value = event.target.value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 63); }} /></label>
        <label>Identificador da empresa<input name="slug" required minLength={2} maxLength={63} pattern="[a-z0-9]+(-[a-z0-9]+)*" onChange={event => { event.currentTarget.dataset.edited = "true"; }} /><small>Gerado a partir do nome. Usado nas integrações; não será solicitado no login.</small></label>
        <button className={styles.primary} type="submit">Revisar criação</button></fieldset>
      </form> : null}
      {showAccess ? <form className={styles.panel} onSubmit={prepareAccess} aria-label="Compartilhar acesso"><h2>Compartilhar acesso</h2><p>Selecione alguém de uma empresa que você administra. Para cadastrar uma pessoa nova, entre na empresa e abra Pessoas e equipes.</p>
        <fieldset disabled={busy || !!pending}>
          <label>Empresa de origem<select value={sourceId} onChange={event => { setSourceId(event.target.value); setTargetId(""); }} required>{managed.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label>Usuário<select name="memberId" key={sourceId} required><option value="">Selecione a pessoa</option>{source?.members.map(m => <option key={m.id} value={m.id}>{m.name} — {m.email}</option>)}</select></label>
          <label>Empresa de destino<select value={targetId} onChange={event => setTargetId(event.target.value)} required><option value="">Selecione a empresa</option>{managed.filter(c => c.id !== sourceId).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label>Papel na empresa de destino<select name="roleId" key={targetId} required><option value="">Selecione o papel</option>{target?.roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
          <button className={styles.primary} type="submit">Revisar acesso</button>
        </fieldset>
      </form> : null}
      {pending ? <section className={styles.panel} aria-label="Confirmar alteração"><h2>{pending.title}</h2><p>{pending.description}</p><div className={styles.toolbar}><button className={styles.primary} disabled={busy} onClick={() => void confirm()} type="button">{busy ? "Salvando..." : "Confirmar alteração"}</button><button disabled={busy} onClick={() => setPending(null)} type="button">Cancelar</button></div></section> : null}
      <footer className={styles.footer}>Cada empresa tem seus próprios dados. Seu papel e suas permissões podem mudar entre empresas.</footer>
    </section>
  </main>;
}
