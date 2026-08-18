import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FLOWS_DIR = join(ROOT, "e2e", "flows");
const MAPPING_PATH = join(ROOT, "e2e", "coverage", "automated-tests.json");
const REPORT_PATH = join(ROOT, "e2e", "coverage", "automated-tests.md");
const SURFACES_PATH = join(ROOT, "e2e", "coverage", "product-surfaces.json");
const ALLOWED_STATUSES = new Set(["automated", "env-gated", "missing", "partial", "usability-only"]);

function listMarkdown(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return listMarkdown(path);
    return entry.isFile() && entry.name.endsWith(".md") ? [path] : [];
  });
}

function flowId(path) {
  const body = readFileSync(path, "utf8");
  return body.match(/^id:\s*(\S+)\s*$/m)?.[1] || "";
}

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

const write = process.argv.includes("--write");
const strict = process.argv.includes("--strict");
const flowFiles = listMarkdown(FLOWS_DIR).sort();
const flows = flowFiles.map((path) => ({ id: flowId(path), path }));
const ids = new Set();

for (const flow of flows) {
  if (!flow.id) fail(`${relative(ROOT, flow.path)} has no frontmatter id`);
  else if (ids.has(flow.id)) fail(`duplicate flow id: ${flow.id}`);
  ids.add(flow.id);
}

const mapping = JSON.parse(readFileSync(MAPPING_PATH, "utf8"));
const mappedIds = new Set(Object.keys(mapping.flows));
for (const id of ids) if (!mappedIds.has(id)) fail(`flow missing from automated-tests.json: ${id}`);
for (const id of mappedIds) if (!ids.has(id)) fail(`mapping references unknown flow: ${id}`);

for (const [id, entry] of Object.entries(mapping.flows)) {
  if (!ALLOWED_STATUSES.has(entry.status)) fail(`${id} has invalid status ${entry.status}`);
  if ((entry.status === "automated" || entry.status === "partial") && !entry.tests?.length) {
    fail(`${id} is ${entry.status} but lists no tests`);
  }
  if (entry.status === "missing" && entry.tests?.length) fail(`${id} is missing but lists tests`);
  for (const testPath of entry.tests || []) {
    if (!existsSync(join(ROOT, testPath))) fail(`${id} references missing test ${testPath}`);
  }
}

const surfaces = JSON.parse(readFileSync(SURFACES_PATH, "utf8"));
const surfaceIds = new Set();
for (const surface of surfaces.surfaces) {
  if (surfaceIds.has(surface.id)) fail(`duplicate product surface: ${surface.id}`);
  surfaceIds.add(surface.id);
  if (!existsSync(join(ROOT, surface.source))) fail(`${surface.id} references missing source ${surface.source}`);
  if (!surface.flows?.length) fail(`${surface.id} has no flow coverage`);
  for (const id of surface.flows || []) if (!ids.has(id)) fail(`${surface.id} references unknown flow ${id}`);
}

const counts = Object.fromEntries([...ALLOWED_STATUSES].sort().map((status) => [status, 0]));
for (const entry of Object.values(mapping.flows)) counts[entry.status] += 1;
const entries = Object.entries(mapping.flows).sort(([left], [right]) => left.localeCompare(right));
const gaps = entries.filter(([, entry]) => entry.status === "missing" || entry.status === "partial");
const report = `# Cobertura automatizada dos fluxos — Pinar

Gerado por \`node scripts/audit-e2e-flow-coverage.mjs --write --strict\`.

## Resumo

| Métrica | Total |
|---|---:|
| Fluxos catalogados | ${flows.length} |
| Superfícies mapeadas | ${surfaces.surfaces.length} |
| automated | ${counts.automated} |
| partial | ${counts.partial} |
| missing | ${counts.missing} |
| env-gated | ${counts["env-gated"]} |
| usability-only | ${counts["usability-only"]} |

## Principais gaps

${gaps.map(([id, entry]) => `- \`${id}\` (${entry.status}): ${(entry.gaps || []).join("; ") || "sem gap detalhado"}`).join("\n") || "Nenhum."}

## Matriz

| Fluxo | Status | Testes | Cobertura | Gaps |
|---|---|---|---|---|
${entries.map(([id, entry]) => `| \`${id}\` | ${entry.status} | ${(entry.tests || []).map((path) => `\`${path}\``).join("<br>") || "—"} | ${(entry.coverage || []).join("<br>") || "—"} | ${(entry.gaps || []).join("<br>") || "—"} |`).join("\n")}
`;

if (write) writeFileSync(REPORT_PATH, report);
else console.log(report);

if (strict && process.exitCode) process.exit(process.exitCode);
