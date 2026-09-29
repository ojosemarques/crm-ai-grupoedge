export type AdministrationTeamFunction =
  | "SDR"
  | "CLOSER"
  | "MANAGER"
  | "ADMINISTRATOR"
  | "SUPPORT";

export type EffectivePermission = Readonly<{
  key: string;
  description: string;
  scope: "WORKSPACE" | "TEAM" | "OWN";
}>;

export type AdministrationRole = Readonly<{
  id: string;
  key: string;
  name: string;
  description: string | null;
  permissions: readonly EffectivePermission[];
}>;

export type AdministrationTeamAssignment = Readonly<{
  id: string;
  teamId: string;
  teamName: string;
  function: AdministrationTeamFunction;
}>;

export type AdministrationMember = Readonly<{
  id: string;
  userId: string;
  displayName: string;
  email: string;
  status: "INVITED" | "ACTIVE" | "INACTIVE";
  userStatus: "ACTIVE" | "DISABLED";
  role: AdministrationRole;
  teamAssignments: readonly AdministrationTeamAssignment[];
  leadReceivingPausedAt: string | null;
  leadReceivingPauseReason: string | null;
  workload: Readonly<{
    openLeads: number;
    openTasks: number;
    futureMeetings: number;
    openOpportunities: number;
  }>;
  updatedAt: string;
  isCurrentMember: boolean;
}>;

export type AdministrationTeam = Readonly<{
  id: string;
  name: string;
  description: string | null;
  members: number;
  activeMembers: number;
  sdrs: number;
  closers: number;
  openLeads: number;
  updatedAt: string;
}>;

export type WorkspaceAdministrationScreen = Readonly<{
  workspace: Readonly<{
    id: string;
    name: string;
    timeZone: string;
  }>;
  capabilities: Readonly<{
    canManageMembers: boolean;
    canManageTeams: boolean;
    canRedistribute: boolean;
    accessScope: "WORKSPACE" | "TEAM";
  }>;
  summary: Readonly<{
    members: number;
    activeMembers: number;
    inactiveMembers: number;
    pausedSdrs: number;
    openLeads: number;
    leadsInGeneralQueue: number;
  }>;
  roles: readonly AdministrationRole[];
  teams: readonly AdministrationTeam[];
  members: readonly AdministrationMember[];
}>;

export type AdministrationImpact = Readonly<{
  key: string;
  label: string;
  count: number;
}>;

export type WorkspaceAdministrationPreview = Readonly<{
  action: string;
  title: string;
  summary: string;
  impacts: readonly AdministrationImpact[];
  warnings: readonly string[];
  requiresConfirmation: true;
}>;
