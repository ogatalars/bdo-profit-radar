// Importa uma tabela de grind spots exportada/copiada do Garmoth e atualiza
// data/spots.json. Existe porque o Garmoth bloqueia acesso de servidor
// (Cloudflare 403), mas um humano abre a pagina e copia sem problema.
//
//   node scripts/import-spots.js <arquivo.md|.tsv|.csv> [--dry]
//
// Aceita tabela markdown, TSV ou CSV. Encontra as colunas pelo cabecalho, entao
// a ordem nao importa e colunas extras sao ignoradas. Notas, traducoes e itens
// ja escritos sao preservados: so os numeros sao atualizados.
import { readFileSync, writeFileSync } from "node:fs";

const [file, ...flags] = process.argv.slice(2);
if (!file) { console.error("uso: node scripts/import-spots.js <arquivo> [--dry]"); process.exit(1); }
const dry = flags.includes("--dry");
const SPOTS = new URL("../data/spots.json", import.meta.url);

const raw = readFileSync(file, "utf8").trim();
const split = (line) => (line.includes("\t") ? line.split("\t")
  : line.includes("|") ? line.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|")
  : line.split(","));
const rows = raw.split("\n").map((l) => l.trim())
  .filter((l) => l && !/^\|?[\s:|-]+\|?$/.test(l))   // descarta separador de markdown
  .map((l) => split(l).map((c) => c.trim()));
if (rows.length < 2) { console.error("arquivo sem linhas de dados"); process.exit(1); }

const norm = (s) => s.toLowerCase().replace(/[^a-z]/g, "");
const header = rows[0].map(norm);
const col = (...names) => {
  for (const n of names) { const i = header.indexOf(norm(n)); if (i >= 0) return i; }
  return -1;
};
const IDX = {
  name: col("spot", "name", "spotname", "zone", "grindspot"),
  ap: col("ap", "recap", "recommendedap", "apreq"),
  dp: col("dp", "recdp", "recommendeddp", "dpreq"),
  stat: col("minap", "totalstat", "totalstatap", "statap"),
  cap: col("maxap", "apcap", "cap", "caplimit"),
  capPct: col("cappercent", "cappct", "percent"),
  silver: col("silverhr", "silverperhour", "silver", "silverhour"),
  party: col("party", "players", "partysize"),
};
// "Cap %" normaliza para "cap" e colide com a coluna de teto. So aceita como
// percentual a coluna "cap" que sobrou depois do teto ja ter sido resolvido.
if (IDX.capPct < 0) {
  const c = header.indexOf("cap");
  if (c >= 0 && c !== IDX.cap) IDX.capPct = c;
}
if (IDX.name < 0) {
  console.error("nao achei a coluna de nome. Cabecalho lido:\n  " + rows[0].join(" | "));
  process.exit(1);
}

// "1.13B" / "1,137M" / "466M" / "466.000.000" -> numero
const money = (v) => {
  if (!v) return null;
  const s = v.replace(/\s|silver/gi, "");
  const m = s.match(/^([\d.,]+)\s*([bmk])?/i);
  if (!m) return null;
  let n = parseFloat(m[1].replace(/\.(?=\d{3}\b)/g, "").replace(",", "."));
  if (isNaN(n)) return null;
  const mult = { b: 1e9, m: 1e6, k: 1e3 }[(m[2] || "").toLowerCase()];
  if (mult) n *= mult;
  else if (n < 1e5) n *= 1e6;   // tabela em milhoes sem sufixo
  return Math.round(n);
};
const num = (v) => { const n = parseInt(String(v).replace(/[^\d]/g, ""), 10); return isNaN(n) ? null : n; };
const key = (s) => s.toLowerCase().replace(/\[.*?\]/g, "").replace(/[^a-z0-9]/g, "");

const doc = JSON.parse(readFileSync(SPOTS, "utf8"));
const byKey = new Map(doc.spots.map((s) => [key(s.name), s]));
const today = new Date().toISOString().slice(0, 10);
doc._meta.sources.garmoth = { url: "https://garmoth.com/grind-tracker", date: today };

const updated = [], added = [], unchanged = [];
for (const r of rows.slice(1)) {
  const name = r[IDX.name];
  if (!name || /^spot$/i.test(name)) continue;
  const incoming = {
    ap: IDX.ap >= 0 ? num(r[IDX.ap]) : null,
    dp: IDX.dp >= 0 ? num(r[IDX.dp]) : null,
    stat: IDX.stat >= 0 ? num(r[IDX.stat]) : null,
    statCap: IDX.cap >= 0 ? num(r[IDX.cap]) : null,
    capPct: IDX.capPct >= 0 ? num(r[IDX.capPct]) : null,
    silver: IDX.silver >= 0 ? money(r[IDX.silver]) : null,
    party: IDX.party >= 0 ? r[IDX.party] || null : null,
  };
  const hit = byKey.get(key(name));
  if (!hit) {
    added.push({ name, ...incoming });
    continue;
  }
  const diff = [];
  for (const [k, v] of Object.entries(incoming)) {
    if (v == null) continue;
    if (hit[k] !== v) { diff.push(`${k}: ${hit[k]} -> ${v}`); hit[k] = v; }
  }
  hit.source = "garmoth";
  if (diff.length) updated.push(`${hit.name}  ${diff.join(", ")}`);
  else unchanged.push(hit.name);
}

console.log(`linhas lidas: ${rows.length - 1}`);
console.log(`colunas encontradas: ${Object.entries(IDX).filter(([, i]) => i >= 0).map(([k]) => k).join(", ")}`);
console.log(`\natualizados: ${updated.length}`);
updated.forEach((u) => console.log("  " + u));
console.log(`sem mudanca: ${unchanged.length}`);
if (added.length) {
  console.log(`\nNAO estavam em spots.json (${added.length}) — precisam de nota pt/en antes de entrar:`);
  added.forEach((a) => console.log(`  ${a.name}  ap=${a.ap} dp=${a.dp} stat=${a.stat} silver=${a.silver}`));
}
if (dry) { console.log("\n--dry: nada foi gravado."); process.exit(0); }
if (updated.length) {
  writeFileSync(SPOTS, JSON.stringify(doc, null, 1) + "\n");
  console.log(`\ndata/spots.json atualizado. Rode: node scripts/test.js`);
} else console.log("\nnada para gravar.");
