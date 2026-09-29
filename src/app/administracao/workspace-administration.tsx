"use client";

import { FormEvent, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { DataTableShell, StatCard } from "@/components/ui/surface";
import type {
  AdministrationMember,
  AdministrationTeamFunction,
  WorkspaceAdministrationPreview,
  WorkspaceAdministrationScreen,
} from "@/modules/users/domain/workspace-administration-contracts";

type PendingChange = Readonly<{
  command: Record<string, unknown>;
  preview: WorkspaceAdministrationPreview;
}>;

const sectionClass = "surface-panel p-5";
const inputClass =
  "mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60";
const textareaClass =
  "mt-1 min-h-20 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring";
const functionOptions: ReadonlyArray<
  readonly [AdministrationTeamFunction, string]
> = [
  ["SDR", "SDR"],
  ["CLOSER", "Closer"],
  ["MANAGER", "Gestor"],
  ["ADMINISTRATOR", "Administrador"],
  ["SUPPORT", "Suporte"],
];

function apiError(body: unknown, fallback: string): string {
  if (
    body &&
    typeof body === "object" &&
    "error" in body &&
    body.error &&
    typeof body.error === "object" &&
    "message" in body.error &&
    typeof body.error.message === "string"
  ) {
    return body.error.message;
  }
  return fallback;
}

function statusLabel(member: AdministrationMember): string {
  if (member.userStatus !== "ACTIVE" || member.status !== "ACTIVE") return "Inativo";
  if (member.leadReceivingPausedAt) return "Ativo · recebimento pausado";
  return "Ativo";
}

function redistributionTarget(value: string) {
  return value === "GENERAL_QUEUE"
    ? { type: "GENERAL_QUEUE" as const }
    : { type: "MEMBER" as const, memberId: value };
}

export function WorkspaceAdministration({
  initialScreen,
}: Readonly<{ initialScreen: WorkspaceAdministrationScreen }>) {
  const [screen, setScreen] = useState(initialScreen);
  const [selectedMemberId, setSelectedMemberId] = useState(
    initialScreen.members.find(({ isCurrentMember }) => !isCurrentMember)?.id ??
      initialScreen.members[0]?.id ??
      "",
  );
  const [pending, setPending] = useState<PendingChange | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const selectedMember =
    screen.members.find(({ id }) => id === selectedMemberId) ?? null;
  const visibleMembers = useMemo(() => {
    const normalized = search.trim().toLocaleLowerCase("pt-BR");
    if (!normalized) return screen.members;
    return screen.members.filter((member) =>
      [
        member.displayName,
        member.email,
        member.role.name,
        ...member.teamAssignments.map(({ teamName }) => teamName),
      ]
        .join(" ")
        .toLocaleLowerCase("pt-BR")
        .includes(normalized),
    );
  }, [screen.members, search]);

  async function prepare(command: Record<string, unknown>) {
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch("/api/administracao/workspace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...command, confirmed: false }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok || !body || typeof body !== "object" || !("result" in body)) {
        throw new Error(apiError(body, "Não foi possível calcular o impacto."));
      }
      setPending({
        command,
        preview: body.result as WorkspaceAdministrationPreview,
      });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Falha inesperada.");
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!pending) return;
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch("/api/administracao/workspace", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...pending.command, confirmed: true }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok || !body || typeof body !== "object" || !("result" in body)) {
        throw new Error(apiError(body, "Não foi possível aplicar a alteração."));
      }
      const nextScreen = body.result as WorkspaceAdministrationScreen;
      setScreen(nextScreen);
      setPending(null);
      setNotice("Alteração concluída e auditada com sucesso.");
      if (
        selectedMemberId &&
        !nextScreen.members.some(({ id }) => id === selectedMemberId)
      ) {
        setSelectedMemberId(nextScreen.members[0]?.id ?? "");
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Falha inesperada.");
    } finally {
      setBusy(false);
    }
  }

  const summaryItems = [
    ["Usuários visíveis", screen.summary.members],
    ["Ativos", screen.summary.activeMembers],
    ["Inativos", screen.summary.inactiveMembers],
    ["SDRs pausados", screen.summary.pausedSdrs],
    ["Leads abertos", screen.summary.openLeads],
    ["Fila Geral", screen.summary.leadsInGeneralQueue],
  ] as const;

  return (
    <div className="space-y-6">
      {notice ? (
        <div className="rounded-md border bg-muted px-4 py-3 text-sm" role="status">
          {notice}
        </div>
      ) : null}

      {pending ? (
        <section
          aria-label="Confirmar alteração administrativa"
          className="surface-panel surface-panel--accent p-5"
        >
          <h2 className="text-lg font-semibold">{pending.preview.title}</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {pending.preview.summary}
          </p>
          {pending.preview.impacts.length ? (
            <dl className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {pending.preview.impacts.map((impact) => (
                <div className="rounded border p-3" key={impact.key}>
                  <dt className="text-xs text-muted-foreground">{impact.label}</dt>
                  <dd className="mt-1 text-xl font-semibold">{impact.count}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">
              Nenhum registro comercial será removido.
            </p>
          )}
          {pending.preview.warnings.length ? (
            <ul className="mt-4 list-disc space-y-1 pl-5 text-sm">
              {pending.preview.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          ) : null}
          <div className="mt-5 flex flex-wrap gap-3">
            <Button disabled={busy} onClick={() => void confirm()}>
              {busy ? "Aplicando…" : "Confirmar alteração"}
            </Button>
            <Button
              disabled={busy}
              onClick={() => setPending(null)}
              variant="secondary"
            >
              Cancelar
            </Button>
          </div>
        </section>
      ) : null}

      <section aria-label="Indicadores operacionais" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        {summaryItems.map(([label, value], index) => <StatCard key={label} label={label} tone={index === 2 || index === 5 ? "warning" : index === 1 ? "success" : "info"} value={value} />)}
      </section>

      <p className="text-sm text-muted-foreground">
        Universo exibido: {screen.capabilities.accessScope === "WORKSPACE" ? "workspace inteiro" : "suas equipes"}.
        Todos os indicadores são calculados dos registros persistidos.
      </p>

      {screen.capabilities.canManageMembers ? (
        <CreateMemberForm busy={busy} prepare={prepare} screen={screen} />
      ) : null}

      <section className={sectionClass}>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold">Usuários</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Papel controla acesso; função comercial controla a operação na equipe.
            </p>
          </div>
          <label className="w-full max-w-sm text-sm">
            Buscar usuário
            <input
              className={inputClass}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Nome, e-mail, papel ou equipe"
              type="search"
              value={search}
            />
          </label>
        </div>
        {visibleMembers.length ? (
          <DataTableShell className="mt-4">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead className="border-b text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Usuário</th>
                  <th className="px-3 py-2 font-medium">Papel e função</th>
                  <th className="px-3 py-2 font-medium">Disponibilidade</th>
                  <th className="px-3 py-2 text-right font-medium">Leads</th>
                  <th className="px-3 py-2 text-right font-medium">Tarefas</th>
                  <th className="px-3 py-2 text-right font-medium">Reuniões</th>
                  <th className="px-3 py-2 text-right font-medium">Oportunidades</th>
                  <th className="px-3 py-2 font-medium">Ação</th>
                </tr>
              </thead>
              <tbody>
                {visibleMembers.map((member) => (
                  <tr className="border-b last:border-0" key={member.id}>
                    <td className="px-3 py-3">
                      <p className="font-medium">{member.displayName}</p>
                      <p className="text-xs text-muted-foreground">{member.email}</p>
                    </td>
                    <td className="px-3 py-3">
                      <p>{member.role.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {member.teamAssignments.length
                          ? member.teamAssignments
                              .map(({ teamName, function: value }) => `${teamName} · ${value}`)
                              .join("; ")
                          : "Sem equipe"}
                      </p>
                    </td>
                    <td className="px-3 py-3">{statusLabel(member)}</td>
                    <td className="px-3 py-3 text-right">{member.workload.openLeads}</td>
                    <td className="px-3 py-3 text-right">{member.workload.openTasks}</td>
                    <td className="px-3 py-3 text-right">{member.workload.futureMeetings}</td>
                    <td className="px-3 py-3 text-right">{member.workload.openOpportunities}</td>
                    <td className="px-3 py-3">
                      <Button
                        onClick={() => setSelectedMemberId(member.id)}
                        size="sm"
                        variant={member.id === selectedMemberId ? "default" : "secondary"}
                      >
                        Abrir {member.displayName}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DataTableShell>
        ) : (
          <div className="mt-4 rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
            {screen.members.length
              ? "Nenhum usuário corresponde à busca."
              : "Nenhum usuário está disponível neste escopo."}
          </div>
        )}
      </section>

      {selectedMember ? (
        <MemberPanel
          busy={busy}
          key={`${selectedMember.id}:${selectedMember.updatedAt}`}
          member={selectedMember}
          prepare={prepare}
          screen={screen}
        />
      ) : null}

      <TeamOverview screen={screen} />
      {screen.capabilities.canManageTeams ? (
        <TeamEditor busy={busy} prepare={prepare} screen={screen} />
      ) : null}
    </div>
  );
}

function CreateMemberForm({
  busy,
  prepare,
  screen,
}: Readonly<{
  busy: boolean;
  prepare: (command: Record<string, unknown>) => Promise<void>;
  screen: WorkspaceAdministrationScreen;
}>) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const teamId = String(data.get("teamId") ?? "");
    void prepare({
      action: "CREATE_MEMBER",
      displayName: data.get("displayName"),
      email: data.get("email"),
      password: data.get("password"),
      roleId: data.get("roleId"),
      teamAssignments: teamId
        ? [{ teamId, function: data.get("function") }]
        : [],
    });
  }

  return (
    <section aria-label="Criar usuário" className={sectionClass}>
      <h2 className="text-xl font-semibold">Criar usuário local</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        A senha inicial é recebida apenas para gerar o hash e nunca volta na resposta.
      </p>
      <form className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-6" onSubmit={submit}>
        <label className="text-sm xl:col-span-2">
          Nome
          <input className={inputClass} name="displayName" required />
        </label>
        <label className="text-sm xl:col-span-2">
          E-mail
          <input autoComplete="off" className={inputClass} name="email" required type="email" />
        </label>
        <label className="text-sm xl:col-span-2">
          Senha inicial
          <input autoComplete="new-password" className={inputClass} minLength={12} name="password" required type="password" />
        </label>
        <label className="text-sm xl:col-span-2">
          Papel de acesso
          <select className={inputClass} name="roleId" required>
            <option value="">Selecione</option>
            {screen.roles.map((role) => (
              <option key={role.id} value={role.id}>{role.name}</option>
            ))}
          </select>
        </label>
        <label className="text-sm xl:col-span-2">
          Equipe inicial
          <select className={inputClass} name="teamId">
            <option value="">Sem equipe</option>
            {screen.teams.map((team) => (
              <option key={team.id} value={team.id}>{team.name}</option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Função comercial
          <select className={inputClass} defaultValue="SDR" name="function">
            {functionOptions.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        <div className="self-end">
          <Button disabled={busy} type="submit">Revisar criação</Button>
        </div>
      </form>
    </section>
  );
}

function MemberPanel({
  busy,
  member,
  prepare,
  screen,
}: Readonly<{
  busy: boolean;
  member: AdministrationMember;
  prepare: (command: Record<string, unknown>) => Promise<void>;
  screen: WorkspaceAdministrationScreen;
}>) {
  return (
    <section aria-label={`Detalhes de ${member.displayName}`} className={sectionClass}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">{member.displayName}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {member.role.name} · {statusLabel(member)}
            {member.isCurrentMember ? " · sua conta" : ""}
          </p>
        </div>
        <p className="text-sm text-muted-foreground">
          {member.workload.openLeads} leads abertos
        </p>
      </div>

      <div className="mt-5 grid gap-6 xl:grid-cols-2">
        {screen.capabilities.canManageMembers ? (
          <MemberAdministrationForms
            busy={busy}
            member={member}
            prepare={prepare}
            screen={screen}
          />
        ) : (
          <div className="rounded-md border bg-muted p-4 text-sm text-muted-foreground">
            Seu acesso gerencial permite disponibilidade e redistribuição dentro das equipes, mas não altera identidade, papel ou vínculos.
          </div>
        )}
        <OperationalActions busy={busy} member={member} prepare={prepare} screen={screen} />
      </div>

      <div className="mt-6">
        <h3 className="font-semibold">Permissões efetivas</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Concessões persistidas do papel {member.role.name}. A função comercial não adiciona permissões.
        </p>
        {member.role.permissions.length ? (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[650px] text-left text-sm">
              <thead className="border-b text-xs text-muted-foreground">
                <tr><th className="px-3 py-2">Permissão</th><th className="px-3 py-2">Finalidade</th><th className="px-3 py-2">Escopo</th></tr>
              </thead>
              <tbody>
                {member.role.permissions.map((permission) => (
                  <tr className="border-b last:border-0" key={permission.key}>
                    <td className="px-3 py-2 font-mono text-xs">{permission.key}</td>
                    <td className="px-3 py-2">{permission.description}</td>
                    <td className="px-3 py-2">{permission.scope}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">Este papel não possui permissões concedidas.</p>
        )}
      </div>
    </section>
  );
}

function MemberAdministrationForms({
  busy,
  member,
  prepare,
  screen,
}: Readonly<{
  busy: boolean;
  member: AdministrationMember;
  prepare: (command: Record<string, unknown>) => Promise<void>;
  screen: WorkspaceAdministrationScreen;
}>) {
  function profileSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void prepare({
      action: "UPDATE_MEMBER_PROFILE",
      memberId: member.id,
      expectedUpdatedAt: member.updatedAt,
      displayName: data.get("displayName"),
      email: data.get("email"),
    });
  }
  function roleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void prepare({
      action: "CHANGE_MEMBER_ROLE",
      memberId: member.id,
      expectedUpdatedAt: member.updatedAt,
      roleId: data.get("roleId"),
      reason: data.get("reason"),
    });
  }

  return (
    <div className="space-y-5">
      <form className="rounded-md border p-4" onSubmit={profileSubmit}>
        <h3 className="font-semibold">Identificação</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-sm">Nome<input className={inputClass} defaultValue={member.displayName} name="displayName" required /></label>
          <label className="text-sm">E-mail<input className={inputClass} defaultValue={member.email} name="email" required type="email" /></label>
        </div>
        <Button className="mt-3" disabled={busy} type="submit">Revisar identificação</Button>
      </form>

      <form className="rounded-md border p-4" onSubmit={roleSubmit}>
        <h3 className="font-semibold">Papel de acesso</h3>
        <label className="mt-3 block text-sm">
          Papel
          <select className={inputClass} defaultValue={member.role.id} disabled={member.isCurrentMember} name="roleId" required>
            {screen.roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
          </select>
        </label>
        <label className="mt-3 block text-sm">Motivo<textarea className={textareaClass} name="reason" required /></label>
        <Button className="mt-3" disabled={busy || member.isCurrentMember} type="submit">Revisar papel</Button>
      </form>

      <TeamAssignmentsEditor busy={busy} member={member} prepare={prepare} screen={screen} />
    </div>
  );
}

function TeamAssignmentsEditor({
  busy,
  member,
  prepare,
  screen,
}: Readonly<{
  busy: boolean;
  member: AdministrationMember;
  prepare: (command: Record<string, unknown>) => Promise<void>;
  screen: WorkspaceAdministrationScreen;
}>) {
  const [assignments, setAssignments] = useState<Record<string, AdministrationTeamFunction>>(
    Object.fromEntries(member.teamAssignments.map(({ teamId, function: value }) => [teamId, value])),
  );

  return (
    <form
      className="rounded-md border p-4"
      onSubmit={(event) => {
        event.preventDefault();
        void prepare({
          action: "SAVE_MEMBER_TEAMS",
          memberId: member.id,
          expectedUpdatedAt: member.updatedAt,
          teamAssignments: Object.entries(assignments).map(([teamId, value]) => ({ teamId, function: value })),
        });
      }}
    >
      <h3 className="font-semibold">Equipes e função comercial</h3>
      <div className="mt-3 grid gap-2">
        {screen.teams.map((team) => {
          const checked = team.id in assignments;
          return (
            <div className="grid grid-cols-[1fr_150px] items-center gap-3 rounded border p-3" key={team.id}>
              <label className="flex items-center gap-2 text-sm">
                <input
                  checked={checked}
                  onChange={(event) => {
                    setAssignments((current) => {
                      const next = { ...current };
                      if (event.target.checked) next[team.id] = "SDR";
                      else delete next[team.id];
                      return next;
                    });
                  }}
                  type="checkbox"
                />
                {team.name}
              </label>
              <select
                aria-label={`Função em ${team.name}`}
                className={inputClass}
                disabled={!checked}
                onChange={(event) => setAssignments((current) => ({ ...current, [team.id]: event.target.value as AdministrationTeamFunction }))}
                value={assignments[team.id] ?? "SDR"}
              >
                {functionOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </div>
          );
        })}
      </div>
      <Button className="mt-3" disabled={busy} type="submit">Revisar equipes</Button>
    </form>
  );
}

function OperationalActions({
  busy,
  member,
  prepare,
  screen,
}: Readonly<{
  busy: boolean;
  member: AdministrationMember;
  prepare: (command: Record<string, unknown>) => Promise<void>;
  screen: WorkspaceAdministrationScreen;
}>) {
  const [target, setTarget] = useState("GENERAL_QUEUE");
  const eligibleSdrs = screen.members.filter(
    (candidate) =>
      candidate.id !== member.id &&
      candidate.status === "ACTIVE" &&
      candidate.userStatus === "ACTIVE" &&
      candidate.leadReceivingPausedAt === null &&
      candidate.teamAssignments.some(({ function: value }) => value === "SDR"),
  );
  const isSdr = member.teamAssignments.some(({ function: value }) => value === "SDR");

  function redistributionSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void prepare({
      action: "REDISTRIBUTE_MEMBER_LEADS",
      memberId: member.id,
      target: redistributionTarget(target),
      reason: data.get("reason"),
    });
  }
  function statusSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const nextStatus = member.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";
    void prepare({
      action: "SET_MEMBER_STATUS",
      memberId: member.id,
      expectedUpdatedAt: member.updatedAt,
      status: nextStatus,
      reason: data.get("reason"),
      redistributionTarget: nextStatus === "INACTIVE" ? redistributionTarget(String(data.get("target"))) : null,
    });
  }

  return (
    <div className="space-y-5">
      {screen.capabilities.canRedistribute ? (
        <form className="rounded-md border p-4" onSubmit={redistributionSubmit}>
          <h3 className="font-semibold">Redistribuir leads abertos</h3>
          <p className="mt-1 text-sm text-muted-foreground">Carga atual: {member.workload.openLeads} lead(s).</p>
          <label className="mt-3 block text-sm">Destino<select className={inputClass} onChange={(event) => setTarget(event.target.value)} value={target}><option value="GENERAL_QUEUE">Fila Geral</option>{eligibleSdrs.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.displayName}</option>)}</select></label>
          <label className="mt-3 block text-sm">Motivo<textarea className={textareaClass} name="reason" required /></label>
          <Button className="mt-3" disabled={busy || member.workload.openLeads === 0} type="submit">Revisar redistribuição</Button>
        </form>
      ) : null}

      {isSdr && member.status === "ACTIVE" && screen.capabilities.canRedistribute ? (
        <form
          className="rounded-md border p-4"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            void prepare({
              action: "SET_MEMBER_RECEIVING_PAUSE",
              memberId: member.id,
              paused: member.leadReceivingPausedAt === null,
              reason: member.leadReceivingPausedAt === null ? data.get("reason") : null,
            });
          }}
        >
          <h3 className="font-semibold">Disponibilidade do round-robin</h3>
          {member.leadReceivingPausedAt === null ? (
            <label className="mt-3 block text-sm">Motivo da pausa<textarea className={textareaClass} name="reason" required /></label>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">Motivo atual: {member.leadReceivingPauseReason}</p>
          )}
          <Button className="mt-3" disabled={busy} type="submit" variant="secondary">{member.leadReceivingPausedAt ? "Retomar recebimento" : "Pausar recebimento"}</Button>
        </form>
      ) : null}

      {screen.capabilities.canManageMembers ? (
        <form className="rounded-md border p-4" onSubmit={statusSubmit}>
          <h3 className="font-semibold">Acesso ao workspace</h3>
          <p className="mt-1 text-sm text-muted-foreground">A inativação revoga sessões e preserva toda a autoria histórica.</p>
          {member.status === "ACTIVE" ? (
            <label className="mt-3 block text-sm">Destino dos leads<select className={inputClass} defaultValue="GENERAL_QUEUE" name="target"><option value="GENERAL_QUEUE">Fila Geral</option>{eligibleSdrs.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.displayName}</option>)}</select></label>
          ) : null}
          <label className="mt-3 block text-sm">Motivo<textarea className={textareaClass} name="reason" required /></label>
          <Button className="mt-3" disabled={busy || member.isCurrentMember} type="submit" variant="secondary">{member.status === "ACTIVE" ? "Revisar inativação" : "Revisar reativação"}</Button>
        </form>
      ) : null}
    </div>
  );
}

function TeamOverview({ screen }: Readonly<{ screen: WorkspaceAdministrationScreen }>) {
  return (
    <section className={sectionClass}>
      <h2 className="text-xl font-semibold">Equipes</h2>
      {screen.teams.length ? (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {screen.teams.map((team) => (
            <article className="rounded-md border p-4" key={team.id}>
              <h3 className="font-semibold">{team.name}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{team.description ?? "Sem descrição."}</p>
              <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
                <div><dt className="text-xs text-muted-foreground">Ativos</dt><dd className="font-semibold">{team.activeMembers}/{team.members}</dd></div>
                <div><dt className="text-xs text-muted-foreground">SDRs / Closers</dt><dd className="font-semibold">{team.sdrs} / {team.closers}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Leads abertos</dt><dd className="font-semibold">{team.openLeads}</dd></div>
              </dl>
            </article>
          ))}
        </div>
      ) : (
        <p className="mt-4 rounded border border-dashed p-6 text-sm text-muted-foreground">Nenhuma equipe está disponível neste escopo.</p>
      )}
    </section>
  );
}

function TeamEditor({
  busy,
  prepare,
  screen,
}: Readonly<{
  busy: boolean;
  prepare: (command: Record<string, unknown>) => Promise<void>;
  screen: WorkspaceAdministrationScreen;
}>) {
  const [teamId, setTeamId] = useState("");
  const team = screen.teams.find(({ id }) => id === teamId) ?? null;
  return (
    <section aria-label="Gerenciar equipes" className={sectionClass}>
      <h2 className="text-xl font-semibold">Gerenciar equipes</h2>
      <label className="mt-4 block max-w-md text-sm">Editar equipe<select className={inputClass} onChange={(event) => setTeamId(event.target.value)} value={teamId}><option value="">Nova equipe</option>{screen.teams.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
      <form
        className="mt-4 grid gap-4 md:grid-cols-[1fr_2fr_auto]"
        key={team?.id ?? "new"}
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          void prepare({
            action: "SAVE_TEAM",
            id: team?.id ?? null,
            expectedUpdatedAt: team?.updatedAt ?? null,
            name: data.get("name"),
            description: data.get("description") || null,
          });
        }}
      >
        <label className="text-sm">Nome<input className={inputClass} defaultValue={team?.name} name="name" required /></label>
        <label className="text-sm">Descrição<input className={inputClass} defaultValue={team?.description ?? ""} name="description" /></label>
        <div className="self-end"><Button disabled={busy} type="submit">Revisar {team ? "edição" : "criação"}</Button></div>
      </form>
    </section>
  );
}
