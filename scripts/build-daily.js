// Snapshot do mercado central + diff contra o snapshot anterior.
// Roda no GitHub Actions; o site so le o JSON gerado.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { category } from "./arsha.js";

const REGION = process.env.REGION || "na";
const DATA = new URL("../data/", import.meta.url);
const MAINS = [1, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80];
const SUBS = Array.from({ length: 25 }, (_, i) => i + 1);

const read = (f) => JSON.parse(readFileSync(new URL(f, DATA), "utf8"));
const write = (f, o) => writeFileSync(new URL(f, DATA), JSON.stringify(o) + "\n");

// Concurrency-limited scan. A silently dropped category would mean a missing
// item and a wrong profit number, so a category that never answers is fatal.
async function pass(combos, rows, conc) {
  const retry = [];
  let absent = 0, i = 0;
  const worker = async () => {
    while (i < combos.length) {
      const [m, s] = combos[i++];
      try {
        const r = await category(REGION, m, s);
        if (Array.isArray(r)) rows.push(...r.map((x) => ({ ...x, mainCategory: m, subCategory: s })));
      } catch (e) {
        // 404 = categoria nao existe. 500 = indisponibilidade do upstream, que
        // observamos ir e voltar em janelas de minutos, entao vale insistir.
        if (/^404/.test(e.message)) absent++;
        else retry.push([m, s]);
      }
    }
  };
  await Promise.all(Array.from({ length: conc }, worker));
  return { retry, absent };
}

async function scanMarket() {
  const combos = MAINS.flatMap((m) => SUBS.map((s) => [m, s]));
  const rows = [];
  let { retry, absent } = await pass(combos, rows, 8);
  // Segunda e terceira passadas, mais lentas, so no que falhou.
  for (const wait of [3000, 8000, 15000, 25000]) {
    if (!retry.length) break;
    console.log(`  retentando ${retry.length} categorias em ${wait / 1000}s...`);
    await new Promise((r) => setTimeout(r, wait));
    ({ retry } = await pass(retry, rows, 3));
  }
  const broken = retry.length;
  const ok = combos.length - absent - broken;
  console.log(`  categorias: ${ok} ok, ${broken} indisponiveis upstream, ${absent} inexistentes`);
  if (!rows.length) throw new Error("varredura nao retornou nenhum item");
  return { rows, coverage: { ok, broken } };
}

console.log(`varrendo mercado ${REGION}...`);
const { rows, coverage } = await scanMarket();

// Market id wins over the item-db id: the db has several ids per name and the
// non-traded ones answer with zeros.
const byId = new Map();
for (const r of rows) {
  const prev = byId.get(r.id);
  if (!prev || r.totalTrades > prev.totalTrades) byId.set(r.id, r);
}
const byName = new Map();
for (const r of byId.values()) {
  const cur = byName.get(r.name);
  if (!cur || r.totalTrades > cur.totalTrades) byName.set(r.name, r);
}
console.log(`  ${byId.size} itens, ${byName.size} nomes unicos`);

const spots = read("spots.json"), recipes = read("recipes.json");
const npc = read("npc-prices.json").prices;
// Receitas precisam de preco para a conta fechar; itens de spot sao
// informativos (o silver/hora vem de sessoes medidas), entao nao sao fatais.
const required = new Set();
for (const r of recipes.recipes) { required.add(r.output); for (const i of r.inputs) required.add(i.item); }
const optional = new Set();
for (const s of spots.spots) for (const it of s.items || []) if (!required.has(it)) optional.add(it);
const wanted = new Set([...required, ...optional]);

const names = {}, missing = [], absentItems = [];
for (const n of wanted) {
  const hit = byName.get(n);
  if (hit && hit.basePrice > 0) names[n] = hit.id;
  else if (npc[n] == null && required.has(n)) missing.push(n);
  else if (npc[n] == null) absentItems.push(n);
}
if (absentItems.length) console.warn(`  itens de spot fora do mercado (${absentItems.length}): ${absentItems.join(", ")}`);
if (missing.length) {
  console.error(`  SEM PRECO em receita (${missing.length}): ${missing.join(", ")}`);
  console.error("  adicione em data/npc-prices.json ou remova dos dados.");
  process.exit(1);
}

const snapFile = `snapshot.${REGION}.json`;
const prev = existsSync(new URL(snapFile, DATA)) ? read(snapFile) : null;
const prevItems = new Map(Object.entries(prev?.items || {}).map(([k, v]) => [+k, v]));

const liquid = (r) => r.basePrice > 0 && r.totalTrades > 0;
const diffs = [];
for (const r of byId.values()) {
  if (!liquid(r)) continue;
  const p = prevItems.get(r.id);
  if (!p) continue;
  const sold = r.totalTrades - p.t;
  const dp = p.p > 0 ? ((r.basePrice - p.p) / p.p) * 100 : 0;
  if (sold >= 0) diffs.push({ id: r.id, sold, dp, price: r.basePrice });
}

// Ruido: item com 2 vendas no dia que "variou 300%" nao e sinal de nada.
const MIN_TURNOVER = 50e6; // 50 milhoes de silver movimentados em 24h
const demand = diffs.filter((d) => d.sold > 0)
  .sort((a, b) => b.sold * b.price - a.sold * a.price).slice(0, 40);
const movers = diffs.filter((d) => Math.abs(d.dp) >= 1 && d.sold * d.price >= MIN_TURNOVER)
  .sort((a, b) => Math.abs(b.dp) - Math.abs(a.dp)).slice(0, 40)
  .sort((a, b) => b.dp - a.dp);

// Variacao do dia indexada por nome, para a pagina cruzar com os itens de cada spot.
const dpById = new Map(diffs.map((d) => [d.id, d.dp]));
const changes = {};
for (const [name, id] of Object.entries(names)) {
  if (dpById.has(id)) changes[name] = +dpById.get(id).toFixed(2);
}

const keep = new Set([...Object.values(names), ...demand.map((d) => d.id), ...movers.map((d) => d.id)]);
const items = {};
for (const id of keep) {
  const r = byId.get(id);
  if (r) items[id] = { n: r.name, p: r.basePrice, s: r.currentStock, t: r.totalTrades };
}

const now = new Date().toISOString();
write(`daily.${REGION}.json`, {
  generatedAt: now, prevAt: prev?.generatedAt || null, region: REGION,
  items, names, npc, coverage, changes,
  demand: demand.map((d) => ({ id: d.id, sold: d.sold })),
  movers: movers.map((d) => ({ id: d.id, dp: +d.dp.toFixed(2) })),
});
// Snapshot completo para o diff de amanha (so o minimo: preco e total de vendas).
write(snapFile, {
  generatedAt: now,
  items: Object.fromEntries([...byId.values()].filter(liquid).map((r) => [r.id, { p: r.basePrice, t: r.totalTrades }])),
});
console.log(`  movers ${movers.length} | demanda ${demand.length} | itens no site ${Object.keys(items).length}`);
console.log(prev ? `  diff contra ${prev.generatedAt}` : "  primeiro snapshot: sem diff ainda");
