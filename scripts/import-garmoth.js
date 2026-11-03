// Converte os clippings do Garmoth (markdown salvo do navegador) em data/spots.json.
// Existe porque o Garmoth bloqueia acesso de servidor via Cloudflare: um humano
// abre a pagina, salva o markdown, e isso aqui faz o resto.
//
//   node scripts/import-garmoth.js <pasta-dos-clippings> [--dry]
//
// Espera encontrar, pelos campos `source:` do front matter:
//   .../best-grind-spots        -> silver/hora, trash/hora, AP|DP em Total Stat
//   .../grind-tracker/combat-exp -> EXP/hora e nivel recomendado
// O id numerico da URL do Garmoth e a chave: casa os dois arquivos sem depender
// do nome, que vem traduzido conforme a lingua da conta.
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const [dir, ...flags] = process.argv.slice(2);
if (!dir) { console.error("uso: node scripts/import-garmoth.js <pasta> [--dry]"); process.exit(1); }
const dry = flags.includes("--dry");
const SPOTS = new URL("../data/spots.json", import.meta.url);

const files = readdirSync(dir).filter((f) => f.endsWith(".md"))
  .map((f) => ({ f, text: readFileSync(join(dir, f), "utf8") }))
  .map((x) => ({ ...x, src: x.text.match(/^source:\s*"([^"]+)"/m)?.[1] || "" }));

const num = (s) => (s ? parseInt(s.replace(/[.,]/g, ""), 10) : null);
// "298.1M" / "2,600" / "4,059,581,734"
const big = (s) => {
  if (!s) return null;
  const m = s.trim().match(/^([\d.,]+)\s*([BMK])?/i);
  if (!m) return null;
  const mult = { b: 1e9, m: 1e6, k: 1e3 }[(m[2] || "").toLowerCase()];
  const n = parseFloat(mult ? m[1].replace(/,/g, "") : m[1].replace(/[.,]/g, ""));
  return isNaN(n) ? null : Math.round(mult ? n * mult : n);
};
const spotId = (line) => line.match(/best-grind-spots\/(\d+)/)?.[1] || null;
// O nome pode conter colchetes escapados — "[\\[Dehkia\\] Mirumok Ruins](...)" —
// entao a captura precisa atravessar \] em vez de parar no primeiro ].
const spotName = (line) =>
  line.match(/\[((?:\\.|[^\]])*)\]\(https:\/\/garmoth/)?.[1]?.replace(/\\/g, "").trim() || null;

// --- silver: usa o arquivo SEM filtro de tier. Os ?tier=high/top mostram o que
// um jogador melhor extrai; o piso e o numero mais honesto para quem chega.
const base = files.find((x) => /best-grind-spots\/?$/.test(x.src.split("?")[0]) && !x.src.includes("tier="));
if (!base) { console.error("nao achei o clipping de best-grind-spots sem filtro de tier"); process.exit(1); }

// O clipper as vezes perde o link das primeiras linhas (justamente as zonas mais
// lucrativas). Elas ainda trazem "AP|DP", que e uma assinatura unica o bastante
// para reatribuir o nome a partir do arquivo de EXP.
const statKey = (ap, dp) => `${ap}/${dp}`;
const nameByStat = new Map();
const expText = files.find((x) => x.src.includes("combat-exp"))?.text || "";
for (const line of expText.split("\n")) {
  const id = spotId(line), name = spotName(line);
  const cells = line.split("|").map((c) => c.trim());
  const stat = cells.find((c) => /^[\d,]+$/.test(c) && num(c) > 500);
  if (id && name && stat) nameByStat.set(num(stat), { id, name });
}

const spots = new Map();
const orphans = [];
for (const line of base.text.split("\n")) {
  let id = spotId(line), name = spotName(line);
  if (!id || !name) {
    const st = line.match(/([\d,]+)\s*AP\s*\\?\|\s*([\d,]+)\s*DP/);
    if (!st || !/\d{3},?\d{3}/.test(line)) continue;   // linha sem dados uteis
    const hit = nameByStat.get(num(st[1]));
    if (!hit) { orphans.push(line.slice(0, 80)); continue; }
    id = hit.id; name = hit.name;
  }
  const cells = line.split("|").map((c) => c.trim());
  const stat = line.match(/([\d,]+)\s*AP\s*\\?\|\s*([\d,]+)\s*DP/);
  // apos a coluna de AP|DP vem trash/h, sessoes e silver/h
  const after = cells.slice(cells.findIndex((c) => /AP\s*$/.test(c) || /AP\s*\\?$/.test(c)) + 1);
  const nums = cells.map(big).filter((n) => n != null);
  const silver = Math.max(...nums.filter((n) => n > 1e8));
  const trash = nums.filter((n) => n > 1000 && n < 1e6).sort((a, b) => a - b)[0] ?? null;
  const tier = cells.find((c) => /^(Meta|Competitive|Viable|Outdated|Obsoleto|Competitivo)$/i.test(c)) || null;
  spots.set(id, {
    garmothId: +id, name, tier,
    stat: stat ? num(stat[1]) : null,
    dpStat: stat ? num(stat[2]) : null,
    silver: isFinite(silver) ? silver : null,
    trashPerHour: trash,
  });
}

// --- XP
const expFile = files.find((x) => x.src.includes("combat-exp"));
let withXp = 0;
if (expFile) {
  for (const line of expFile.text.split("\n")) {
    const id = spotId(line);
    if (!id) continue;
    const s = spots.get(id) || { garmothId: +id, name: spotName(line) };
    const lvl = line.match(/Lv\.\s*(\d+)/);
    const cells = line.split("|").map((c) => c.trim());
    const xpCell = cells.find((c) => /^[\d.]+[MKB]\b/.test(c));
    const pctCell = cells.find((c) => /^[\d.]+%$/.test(c));
    // Spot que so aparece no arquivo de EXP ainda traz o Total Stat numa coluna
    // propria: sem isso ele entraria sem requisito.
    if (s.stat == null) {
      const statCell = cells.find((c) => /^[\d,]+$/.test(c) && num(c) > 200);
      if (statCell) s.stat = num(statCell);
    }
    s.xp = big(xpCell);
    s.xpPct = pctCell ? parseFloat(pctCell) : null;
    s.level = lvl ? +lvl[1] : null;
    s.toLevel = cells.find((c) => /^\d+h(\s*\d+m)?$/.test(c)) || null;
    if (s.xp) withXp++;
    spots.set(id, s);
  }
}

console.log(`clippings lidos: ${files.map((f) => f.f).join(", ")}`);
if (orphans.length) console.log(`linhas sem nome que nao deu para reatribuir: ${orphans.length}`);
console.log(`spots: ${spots.size} | com silver: ${[...spots.values()].filter((s) => s.silver).length} | com XP: ${withXp}`);
const top = [...spots.values()].filter((s) => s.silver).sort((a, b) => b.silver - a.silver).slice(0, 8);
console.log("\ntop silver/hora:");
for (const s of top) console.log(`  ${s.name.slice(0, 38).padEnd(40)} ${(s.silver / 1e9).toFixed(2)} bi  stat ${s.stat ?? "?"}/${s.dpStat ?? "?"}  xp ${s.xp ? (s.xp / 1e6).toFixed(0) + "M" : "-"}`);
const topXp = [...spots.values()].filter((s) => s.xp).sort((a, b) => b.xp - a.xp).slice(0, 5);
console.log("\ntop XP/hora:");
for (const s of topXp) console.log(`  ${s.name.slice(0, 38).padEnd(40)} ${(s.xp / 1e6).toFixed(1)}M  ${s.xpPct}%/h  Lv.${s.level}`);

// --- DP faltante: um spot que so aparece na pagina de EXP nao traz DP. Em vez
// de deixar sem requisito, herda o DP da zona de mesmo Total Stat de AP.
for (const s of spots.values()) {
  if (s.dpStat != null || s.stat == null) continue;
  const twin = [...spots.values()].find((o) => o !== s && o.stat === s.stat && o.dpStat != null);
  if (twin) { s.dpStat = twin.dpStat; s.dpInferred = true; }
}

// --- nomes: o clipping sai na lingua da conta do Garmoth. Mantemos o nome como
// veio em pt e aplicamos o mapa para en; o que ja esta em ingles passa igual.
const EN = JSON.parse(readFileSync(new URL("./garmoth-names.json", import.meta.url), "utf8"));
const toEn = (n) => { for (const [pt, en] of Object.entries(EN)) if (n.includes(pt)) return n.replace(pt, en); return n; };
const slug = (n) => n.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
  .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

// Notas escritas a mao sao preservadas por id; o resto vem do Garmoth.
let prevById = new Map();
try {
  for (const s of JSON.parse(readFileSync(SPOTS, "utf8")).spots)
    prevById.set(s.id, s);
} catch {}

const out = [...spots.values()]
  .filter((s) => s.name && (s.silver || s.xp))
  .sort((a, b) => (b.silver ?? 0) - (a.silver ?? 0))
  .map((g) => {
    const nameEn = toEn(g.name), id = slug(nameEn), prev = prevById.get(id);
    return {
      id, garmothId: g.garmothId, name: { pt: g.name, en: nameEn }, tier: g.tier ?? null,
      stat: g.stat, dpStat: g.dpStat, dpInferred: g.dpInferred || undefined,
      silver: g.silver ?? null, trashPerHour: g.trashPerHour ?? null,
      xp: g.xp ?? null, xpPct: g.xpPct ?? null, level: g.level ?? null, toLevel: g.toLevel ?? null,
      party: prev?.party ?? null, items: prev?.items ?? [], note: prev?.note ?? null,
      source: "garmoth",
    };
  });

// Dois spots diferentes nao podem virar o mesmo id: foi assim que 16 zonas
// [Dehkia] colapsaram numa so quando o nome vinha truncado.
const seen = new Map();
const collisions = [];
for (const s of out) {
  if (seen.has(s.id)) collisions.push(`${s.id}: garmothId ${seen.get(s.id)} e ${s.garmothId}`);
  else seen.set(s.id, s.garmothId);
}
if (collisions.length) {
  console.error(`\nIDs COLIDINDO (${collisions.length}) — nomes provavelmente truncados:`);
  collisions.forEach((c) => console.error("  " + c));
  process.exit(1);
}

const today = new Date().toISOString().slice(0, 10);
const doc = {
  _meta: {
    note: {
      pt: "Dados de sessoes reais do Garmoth. stat e dpStat sao Total Stat (AP e DP ja somados com cristais e buffs), que e o requisito real das zonas. silver e xp sao por hora, medidos.",
      en: "Real session data from Garmoth. stat and dpStat are Total Stat (AP and DP already summed with crystals and buffs), which is the zone's real requirement. silver and xp are per hour, measured.",
    },
    silver: {
      pt: "silver/hora do tier base do Garmoth, sem filtro de gear. Os filtros tier=high e tier=top mostram 20-30% a mais; aqui fica o piso.",
      en: "silver/hour from Garmoth's base tier, no gear filter. The tier=high and tier=top filters show 20-30% more; the floor is used here.",
    },
    sources: { garmoth: { url: "https://garmoth.com/grind-tracker/best-grind-spots", date: today } },
    updatedAt: today,
  },
  spots: out,
};

console.log(`\nspots gerados: ${out.length} | com nota propria: ${out.filter((s) => s.note).length}` +
  ` | DP inferido: ${out.filter((s) => s.dpInferred).length}`);
if (dry) { console.log("--dry: nada gravado."); process.exit(0); }
writeFileSync(SPOTS, JSON.stringify(doc, null, 1) + "\n");
writeFileSync(new URL("../data/garmoth-raw.json", import.meta.url),
  JSON.stringify({ importedAt: new Date().toISOString(), source: base.src, spots: [...spots.values()] }, null, 1) + "\n");
console.log("data/spots.json e data/garmoth-raw.json gravados. Rode: node scripts/test.js");
