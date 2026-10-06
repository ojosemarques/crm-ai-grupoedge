import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { getDatabaseClient } from "@/shared/core/database/client";
import { loadEnvironmentContract } from "@/shared/core/config/environment-contract";
import { createProspectingStagingService } from "@/modules/prospecting/application/prospecting-staging-service";
import { PROSPECTING_SOURCE_SNAPSHOTS } from "@/modules/prospecting/domain/politizai-mcp-config";

const EXPECTED_PROJECT_REF = "zbzztpzviyjxpprqcegs";
const WORKSPACE_SLUG = "politizai";
const UFS = ["AC", "AL", "AP", "AM", "BA", "CE", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"] as const;

type Municipality = Readonly<{ ibgeCode: string; name: string; stateCode: string; population: number }>;
type Target = Readonly<{ externalIdentityKey: string; tseCandidateId: string; role: "MAYOR" | "COUNCILOR"; politicianName: string; ballotName: string | null; municipalityName: string; municipalityIbgeCode: string; stateCode: string; population: number }>;

function argument(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function unzip(path: string, entry: string): Buffer {
  return execFileSync("unzip", ["-p", path, entry], { maxBuffer: 320 * 1024 * 1024 });
}

function decodeXml(value: string): string {
  return value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&").replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)));
}

function readSharedStrings(xml: string): string[] {
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((match) => decodeXml([...match[1]!.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((part) => part[1]).join("")));
}

function normalizeName(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9]+/g, " ").trim().toUpperCase();
}

const TSE_TO_IBGE_NAME_ALIASES = new Map(Object.entries({
  "BA:CAMACA": "CAMACAN",
  "MT:SANTO ANTONIO DO LEVERGER": "SANTO ANTONIO DE LEVERGER",
  "MG:BARAO DE MONTE ALTO": "BARAO DO MONTE ALTO",
  "MG:SAO THOME DAS LETRAS": "SAO TOME DAS LETRAS",
  "MG:DONA EUSEBIA": "DONA EUZEBIA",
  "PA:SANTA ISABEL DO PARA": "SANTA IZABEL DO PARA",
  "PA:ELDORADO DOS CARAJAS": "ELDORADO DO CARAJAS",
  "RN:BOA SAUDE": "JANUARIO CICCO",
  "RO:ALVORADA DO OESTE": "ALVORADA D OESTE",
  "RO:ESPIGAO DO OESTE": "ESPIGAO D OESTE",
  "RR:SAO LUIZ": "SAO LUIZ DO ANAUA",
  "SP:SAO LUIS DO PARAITINGA": "SAO LUIZ DO PARAITINGA",
  "SE:GRACCHO CARDOSO": "GRACHO CARDOSO",
  "SE:AMPARO DE SAO FRANCISCO": "AMPARO DO SAO FRANCISCO",
}));

function loadMunicipalities(path: string): Map<string, Municipality> {
  const shared = readSharedStrings(unzip(path, "xl/sharedStrings.xml").toString("utf8"));
  const sheet = unzip(path, "xl/worksheets/sheet2.xml").toString("utf8");
  const municipalities = new Map<string, Municipality>();
  for (const row of sheet.matchAll(/<row\b[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
    if (Number(row[1]) < 3) continue;
    const cells = new Map<string, string>();
    for (const cell of row[2]!.matchAll(/<c\b([^>]*)r="([A-Z]+)\d+"([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attributes = `${cell[1]} ${cell[3]}`;
      const raw = cell[4]!.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      if (raw === undefined) continue;
      cells.set(cell[2]!, /\bt="s"/.test(attributes) ? (shared[Number(raw)] ?? "") : raw);
    }
    const stateCode = cells.get("A")?.trim();
    const statePrefix = cells.get("B")?.trim().padStart(2, "0");
    const citySuffix = cells.get("C")?.trim().padStart(5, "0");
    const name = cells.get("D")?.trim();
    const population = Number(cells.get("E")?.replace(/\D/g, ""));
    if (!stateCode || !statePrefix || !citySuffix || !name || !Number.isInteger(population)) continue;
    const municipality = { ibgeCode: `${statePrefix}${citySuffix}`, name, stateCode, population };
    municipalities.set(`${stateCode}:${normalizeName(name)}`, municipality);
  }
  return municipalities;
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]!;
    if (character === '"') {
      if (quoted && line[index + 1] === '"') { value += '"'; index += 1; }
      else quoted = !quoted;
    } else if (character === ";" && !quoted) {
      values.push(value);
      value = "";
    } else value += character;
  }
  values.push(value.replace(/\r$/, ""));
  return values;
}

function loadTargets(path: string, municipalities: Map<string, Municipality>) {
  const targets = new Map<string, Target>();
  const unmatched = new Set<string>();
  for (const uf of UFS) {
    const text = new TextDecoder("windows-1252").decode(unzip(path, `consulta_cand_2024_${uf}.csv`));
    const lines = text.split("\n");
    const headers = parseCsvLine(lines.shift() ?? "");
    const column = new Map(headers.map((header, index) => [header, index]));
    const at = (row: string[], name: string) => row[column.get(name) ?? -1] ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const row = parseCsvLine(line);
      const cargo = at(row, "DS_CARGO");
      if (at(row, "ANO_ELEICAO") !== "2024" || at(row, "CD_TIPO_ELEICAO") !== "2" || !at(row, "DS_SIT_TOT_TURNO").startsWith("ELEITO") || !["PREFEITO", "VEREADOR"].includes(cargo)) continue;
      const tseName = normalizeName(at(row, "NM_UE"));
      const municipality = municipalities.get(`${uf}:${TSE_TO_IBGE_NAME_ALIASES.get(`${uf}:${tseName}`) ?? tseName}`);
      if (!municipality) { unmatched.add(`${uf}:${at(row, "NM_UE")}`); continue; }
      if (municipality.population < 30_000) continue;
      const tseCandidateId = at(row, "SQ_CANDIDATO");
      targets.set(tseCandidateId, {
        externalIdentityKey: `tse-2024:${tseCandidateId}`,
        tseCandidateId,
        role: cargo === "PREFEITO" ? "MAYOR" : "COUNCILOR",
        politicianName: at(row, "NM_CANDIDATO"),
        ballotName: at(row, "NM_URNA_CANDIDATO") || null,
        municipalityName: municipality.name,
        municipalityIbgeCode: municipality.ibgeCode,
        stateCode: municipality.stateCode,
        population: municipality.population,
      });
    }
  }
  return { targets: [...targets.values()], unmatched: [...unmatched] };
}

const mode = process.argv.includes("--apply") ? "apply" : process.argv.includes("--dry-run") ? "dry-run" : null;
const ibgePath = argument("ibge");
const tsePath = argument("tse");
if (!mode || !ibgePath || !tsePath) throw new Error("Uso: tsx scripts/import-prospecting-research-targets.ts --dry-run|--apply --ibge=<xlsx> --tse=<zip>");
if (sha256(ibgePath) !== PROSPECTING_SOURCE_SNAPSHOTS.population.hash || sha256(tsePath) !== PROSPECTING_SOURCE_SNAPSHOTS.election.hash) throw new Error("Os arquivos oficiais não correspondem aos hashes fixados para IBGE/TSE.");

const municipalities = loadMunicipalities(ibgePath);
const loaded = loadTargets(tsePath, municipalities);
if (loaded.unmatched.length > 5) throw new Error(`Falha de vínculo IBGE/TSE: ${loaded.unmatched.length} município(s) sem correspondência: ${loaded.unmatched.join(", ")}.`);
if (loaded.targets.length < 1_000) throw new Error(`Quantidade de alvos inesperadamente baixa: ${loaded.targets.length}.`);

if (mode === "dry-run") {
  process.stdout.write(`${JSON.stringify({ dryRun: true, municipalities: municipalities.size, eligibleTargets: loaded.targets.length, unmatched: loaded.unmatched })}\n`);
  process.exit(0);
}

const contract = loadEnvironmentContract(process.env);
const databaseIdentity = contract.databaseUrl.username.endsWith(`.${EXPECTED_PROJECT_REF}`) || contract.databaseUrl.hostname === `db.${EXPECTED_PROJECT_REF}.supabase.co`;
if (contract.APP_ENV !== "production" || contract.PROCESS_ROLE !== "bootstrap" || !databaseIdentity) throw new Error("Importação permitida apenas no banco de produção Politizai identificado.");

const database = getDatabaseClient();
const staging = createProspectingStagingService({ database, now: () => new Date() });
try {
  const outcome = await database.$transaction(async (transaction) => {
    await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('politizai:official-research-target-import:2026', 0))`;
    const workspace = await transaction.workspace.findFirstOrThrow({ where: { slug: WORKSPACE_SLUG, status: "ACTIVE", deletedAt: null }, select: { id: true } });
    const actor = await transaction.actor.findFirstOrThrow({ where: { workspaceId: workspace.id, key: "open-dot-research", type: "AI_AGENT", userId: null }, select: { id: true } });
    const today = new Date();
    const horizonStart = today.toISOString().slice(0, 10);
    const horizonEnd = new Date(today.getTime() + 29 * 86_400_000).toISOString().slice(0, 10);
    const principal = { clientId: "official-target-import", workspaceId: workspace.id, actorId: actor.id, scopes: ["RESEARCH_WRITE", "RESEARCH_READ"] as const };
    const opened = await staging.createResearchBatch(transaction, principal, {
      idempotencyKey: `official-targets-2026-${PROSPECTING_SOURCE_SNAPSHOTS.election.hash.slice(0, 12)}`,
      horizonStart,
      horizonEnd,
      sourcePopulationEdition: PROSPECTING_SOURCE_SNAPSHOTS.population.edition,
      sourcePopulationHash: PROSPECTING_SOURCE_SNAPSHOTS.population.hash,
      sourcePopulationImportedAt: PROSPECTING_SOURCE_SNAPSHOTS.population.observedAt,
      sourceElectionEdition: PROSPECTING_SOURCE_SNAPSHOTS.election.edition,
      sourceElectionHash: PROSPECTING_SOURCE_SNAPSHOTS.election.hash,
      sourceElectionImportedAt: PROSPECTING_SOURCE_SNAPSHOTS.election.observedAt,
      agentVersion: "official-target-import/1.0.0",
      promptVersion: "political-prospect-production/v1",
    });
    let inserted = 0;
    for (let index = 0; index < loaded.targets.length; index += 1_000) {
      const rows = loaded.targets.slice(index, index + 1_000).map((target) => ({ ...target, workspaceId: workspace.id, batchId: opened.batch.id }));
      inserted += (await transaction.prospectingResearchTarget.createMany({ data: rows, skipDuplicates: true })).count;
    }
    return { workspaceId: workspace.id, batchId: opened.batch.id, eligibleTargets: loaded.targets.length, inserted, existing: loaded.targets.length - inserted };
  }, { isolationLevel: "Serializable", maxWait: 15_000, timeout: 120_000 });
  process.stdout.write(`${JSON.stringify({ dryRun: false, ...outcome })}\n`);
} finally {
  await database.$disconnect();
}
