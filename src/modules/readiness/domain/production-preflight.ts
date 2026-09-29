import { loadEnvironmentContract, type ApplicationEnvironment } from "@/shared/core/config/environment-contract";

export type ReadinessTarget = ApplicationEnvironment;

export type PreflightFinding = Readonly<{
  code: string;
  status: "PASS" | "WARNING" | "BLOCKED";
  message: string;
}>;

export type ProductionPreflightReport = Readonly<{
  contractVersion: "prod03.1";
  target: ReadinessTarget;
  decision: "READY_FOR_LOCAL" | "READY_FOR_STAGING" | "READY_FOR_PRODUCTION" | "BLOCKED";
  findings: readonly PreflightFinding[];
}>;

function finding(code: string, status: PreflightFinding["status"], message: string): PreflightFinding {
  return Object.freeze({ code, status, message });
}

function checkNodeVersion(nodeVersion: string): PreflightFinding {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(nodeVersion.replace(/^v/, ""));
  if (!match) return finding("NODE_VERSION_INVALID", "BLOCKED", "A versão do Node.js não pôde ser validada.");
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major === 22 && minor >= 12
    ? finding("NODE_VERSION", "PASS", "Node.js está na linha 22 suportada pelo projeto.")
    : finding("NODE_VERSION_UNSUPPORTED", "BLOCKED", "Use Node.js >=22.12 e <23 antes de publicar.");
}

function safeConfigurationFinding(error: unknown): PreflightFinding {
  const message = error instanceof Error ? error.message : "Configuração inválida.";
  const variableList = message.match(/variáveis: (.+)$/)?.[1];
  return finding(
    "ENVIRONMENT_CONTRACT",
    "BLOCKED",
    variableList
      ? `Configuração bloqueada. Revise somente estas variáveis: ${variableList}.`
      : "Configuração bloqueada pelo contrato de ambiente.",
  );
}

export function evaluateProductionPreflight(
  environment: Readonly<Record<string, string | undefined>>,
  options: Readonly<{ nodeVersion?: string; target?: ReadinessTarget }> = {},
): ProductionPreflightReport {
  const target = options.target ?? (environment.APP_ENV as ReadinessTarget | undefined) ?? "local";
  const findings: PreflightFinding[] = [checkNodeVersion(options.nodeVersion ?? process.version)];

  try {
    const contract = loadEnvironmentContract({ ...environment, APP_ENV: target });
    findings.push(finding("ENVIRONMENT_CONTRACT", "PASS", "Contrato de ambiente validado sem fallback remoto."));
    findings.push(finding("DATABASE_BOUNDARY", "PASS", contract.isRemote
      ? contract.PROCESS_ROLE === "migration"
        ? "Runtime pooled e URL direta de migration correspondem a host, banco, schema e TLS explícitos."
        : "Runtime usa somente a URL pooled esperada; a credencial direta não foi exposta ao processo."
      : "Banco remoto permanece proibido no ambiente local ou de teste."));
    findings.push(finding("SESSION_SECURITY", "PASS", contract.isRemote
      ? "Cookie de sessão e origem canônica exigem HTTPS."
      : "Política de sessão local está explicitamente isolada do ambiente remoto."));
    findings.push(finding("EXTERNAL_ADAPTERS", "PASS", "Adapters externos permanecem desativados ou simulados."));
  } catch (error) {
    findings.push(safeConfigurationFinding(error));
  }

  const blocked = findings.some(({ status }) => status === "BLOCKED");
  const decision: ProductionPreflightReport["decision"] = blocked
    ? "BLOCKED"
    : target === "production"
      ? "READY_FOR_PRODUCTION"
      : target === "staging"
        ? "READY_FOR_STAGING"
        : "READY_FOR_LOCAL";

  return Object.freeze({
    contractVersion: "prod03.1",
    target,
    decision,
    findings: Object.freeze(findings),
  });
}
