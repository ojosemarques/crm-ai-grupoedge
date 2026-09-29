import { posix as path } from "node:path";

export type RepositoryFile = Readonly<{
  path: string;
  content: string;
}>;

export type RepositoryPolicyViolation = Readonly<{
  path: string;
  line: number;
  code:
    | "FORBIDDEN_ARTIFACT"
    | "FORBIDDEN_ENV_FILE"
    | "PRIVATE_KEY"
    | "PUBLIC_SECRET"
    | "REMOTE_DATABASE_URL"
    | "TOKEN";
  message: string;
}>;

const ALLOWED_ENV_FILES = new Set([
  ".env.example",
  ".env.production.example",
  ".env.staging.example",
]);

const FORBIDDEN_DIRECTORIES = new Set([
  ".backups",
  ".cache",
  ".credentials",
  ".next",
  ".vercel",
  "backups",
  "blob-report",
  "coverage",
  "credentials",
  "node_modules",
  "playwright-report",
  "test-results",
]);

const FORBIDDEN_EXTENSIONS = [
  ".backup",
  ".bak",
  ".dump",
  ".dump.gz",
  ".key",
  ".log",
  ".p12",
  ".pem",
  ".pfx",
  ".sql.gz",
] as const;

const RESERVED_DATABASE_HOSTS = new Set(["127.0.0.1", "::1", "db", "localhost"]);
const RESERVED_HOST_SUFFIXES = [".example", ".invalid", ".test", ".example.com", ".example.net", ".example.org"];

const tokenPatterns = [
  new RegExp("\\bgh" + "[pousr]_[A-Za-z0-9]{20,}\\b", "g"),
  new RegExp("\\bgithub" + "_pat_[A-Za-z0-9_]{20,}\\b", "g"),
  new RegExp("\\bsk" + "-(?:live|proj)-[A-Za-z0-9_-]{16,}\\b", "g"),
  new RegExp("\\bxox" + "[baprs]-[A-Za-z0-9-]{16,}\\b", "g"),
  new RegExp("\\bAK" + "IA[0-9A-Z]{16}\\b", "g"),
  new RegExp("\\bAI" + "za[0-9A-Za-z_-]{30,}\\b", "g"),
] as const;

const databaseUrlPattern = /postgres(?:ql)?:\/\/[^\s`"'<>()[\]]+/gi;
const publicSecretPattern = /^\s*(NEXT_PUBLIC_[A-Z0-9_]*(?:SECRET|PASSWORD|TOKEN|PRIVATE|DATABASE|CREDENTIAL|API_?KEY)[A-Z0-9_]*)\s*=\s*(.+?)\s*$/gim;
const privateKeyMarker = ["-----BEGIN", "PRIVATE KEY-----"].join(" ");

function lineAt(content: string, index: number): number {
  return content.slice(0, index).split("\n").length;
}

function isReservedDatabaseHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return RESERVED_DATABASE_HOSTS.has(normalized)
    || RESERVED_HOST_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
}

function riskyPathViolation(filePath: string): RepositoryPolicyViolation | null {
  const normalized = filePath.replaceAll("\\", "/");
  const segments = normalized.split("/");
  const basename = path.basename(normalized);
  if (basename === ".env" || (basename.startsWith(".env.") && !ALLOWED_ENV_FILES.has(basename))) {
    return {
      path: filePath,
      line: 1,
      code: "FORBIDDEN_ENV_FILE",
      message: "Arquivo de ambiente real não pode ser versionado.",
    };
  }
  if (segments.some((segment) => FORBIDDEN_DIRECTORIES.has(segment))
    || FORBIDDEN_EXTENSIONS.some((extension) => normalized.toLowerCase().endsWith(extension))) {
    return {
      path: filePath,
      line: 1,
      code: "FORBIDDEN_ARTIFACT",
      message: "Artefato gerado, backup, dump, log ou credencial não pode ser versionado.",
    };
  }
  return null;
}

export function inspectRepositoryFiles(files: readonly RepositoryFile[]): readonly RepositoryPolicyViolation[] {
  const violations: RepositoryPolicyViolation[] = [];

  for (const file of files) {
    const pathViolation = riskyPathViolation(file.path);
    if (pathViolation) {
      violations.push(pathViolation);
      continue;
    }

    const privateKeyIndex = file.content.indexOf(privateKeyMarker);
    if (privateKeyIndex >= 0) {
      violations.push({
        path: file.path,
        line: lineAt(file.content, privateKeyIndex),
        code: "PRIVATE_KEY",
        message: "Material de chave privada detectado.",
      });
    }

    for (const pattern of tokenPatterns) {
      pattern.lastIndex = 0;
      for (const match of file.content.matchAll(pattern)) {
        violations.push({
          path: file.path,
          line: lineAt(file.content, match.index),
          code: "TOKEN",
          message: "Token com formato de credencial detectado.",
        });
      }
    }

    publicSecretPattern.lastIndex = 0;
    for (const match of file.content.matchAll(publicSecretPattern)) {
      const assignedValue = match[2]?.trim().replace(/^['"]|['"]$/g, "") ?? "";
      if (assignedValue.length > 0) {
        violations.push({
          path: file.path,
          line: lineAt(file.content, match.index),
          code: "PUBLIC_SECRET",
          message: `Variável pública sensível preenchida: ${match[1] ?? "NEXT_PUBLIC_*"}.`,
        });
      }
    }

    databaseUrlPattern.lastIndex = 0;
    for (const match of file.content.matchAll(databaseUrlPattern)) {
      try {
        const databaseUrl = new URL(match[0]);
        if (!isReservedDatabaseHost(databaseUrl.hostname)) {
          violations.push({
            path: file.path,
            line: lineAt(file.content, match.index),
            code: "REMOTE_DATABASE_URL",
            message: "URL PostgreSQL com host remoto não reservado detectada.",
          });
        }
      } catch {
        // Placeholders documentais que não formam uma URL válida não são segredos utilizáveis.
      }
    }
  }

  return violations.sort((left, right) => left.path.localeCompare(right.path) || left.line - right.line);
}
