// Check minimo: conta de dinheiro, gate de spot, integridade dos dados e i18n.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { netRate, pricer, recipeProfit, resolveInput, spotFit, spotToday } from "../calc.js";

const read = (f) => JSON.parse(readFileSync(new URL(`../data/${f}`, import.meta.url), "utf8"));

// --- taxa de mercado
assert.equal(netRate({ vp: false, ring: false }), 0.65);
assert.equal(+netRate({ vp: true, ring: false }).toFixed(3), 0.845);
assert.equal(+netRate({ vp: true, ring: true }).toFixed(4), 0.8775);

// --- fixture sintetica
const fake = {
  names: { Out: 1, In: 2, Caro: 3, Barato: 4 },
  items: { 1: { p: 1000 }, 2: { p: 100 }, 3: { p: 900 }, 4: { p: 300 } },
  npc: { Vendor: 10 },
};
const p = pricer(fake);
assert.equal(p.priceOf("Out"), 1000);
assert.equal(p.priceOf("Vendor"), 10);
assert.equal(p.isNpc("Vendor"), true);

// ingrediente generico escolhe o mais barato das alternativas
const g = resolveInput({ item: "Grao", qty: 5, any: ["Caro", "Barato"] }, p.priceOf);
assert.equal(g.name, "Barato");
assert.equal(g.price, 300);
assert.equal(g.generic, "Grao");
// alternativa sem preco nao pode ser escolhida
assert.equal(resolveInput({ item: "X", qty: 1, any: ["Inexistente", "Caro"] }, p.priceOf).name, "Caro");
// nenhuma alternativa com preco -> marca como sem preco, nao quebra
assert.equal(resolveInput({ item: "X", qty: 1, any: ["Nada"] }, p.priceOf).price, 0);

const r = recipeProfit({ output: "Out", yield: 2, craftsPerHour: 10, inputs: [{ item: "In", qty: 5 }] }, p, 0.65);
assert.equal(r.revenue, 1300);
assert.equal(r.cost, 500);
assert.equal(r.hour, 8000);
assert.equal(r.priced, true);
assert.equal(recipeProfit({ output: "Vendor", yield: 1, craftsPerHour: 1, inputs: [] }, p, 0.65).revenue, 10,
  "venda no NPC nao deve sofrer taxa");
// receita com insumo sem preco: aparece na wiki, mas nao entra no ranking
const np = recipeProfit({ output: "Out", yield: 1, craftsPerHour: 1, inputs: [{ item: "Fantasma", qty: 1 }] }, p, 0.65);
assert.equal(np.priced, false);
assert.deepEqual(np.missing, ["Fantasma"]);

// --- gate de spot
const zone = { stat: 900, statCap: 1000, dp: 400, ap: 310, items: ["Out"] };
assert.equal(spotFit(zone, { stat: 500, ap: 200, dp: 300 }).locked, true);
assert.equal(spotFit(zone, { stat: 950, ap: 310, dp: 420 }).locked, false);
assert.equal(spotFit(zone, { stat: 800, ap: 420, dp: 500 }).locked, true, "Total Stat e o gate, nao o AP exibido");
assert.equal(spotFit(zone, { stat: 1200, ap: 400, dp: 500 }).overCap, true);
assert.equal(spotToday(zone, p, { Out: 10 }).drift, 10);
assert.equal(spotToday({ items: [] }, p, {}).drift, null);

// --- dados reais
const daily = read("daily.na.json"), rp = pricer(daily);
const spots = read("spots.json"), recipes = read("recipes.json");
const classes = read("classes.json"), i18n = read("i18n.json");

// i18n: as duas linguas precisam das mesmas chaves, senao a UI fica em branco
const ptK = Object.keys(i18n.pt).sort(), enK = Object.keys(i18n.en).sort();
assert.deepEqual(ptK, enK, "chaves de i18n divergentes entre pt e en");
assert.ok(ptK.length > 50, "tabela de i18n curta demais");

// todo campo bilingue dos dados precisa das duas linguas
const bilingual = (o, what) => {
  assert.ok(o && typeof o === "object", `${what}: campo bilingue ausente`);
  for (const l of ["pt", "en"]) assert.ok(o[l]?.length > 0, `${what}: falta traducao ${l}`);
};
for (const s of spots.spots) bilingual(s.note, `spot ${s.id}`);
for (const r2 of recipes.recipes) { bilingual(r2.name, `receita ${r2.id}`); bilingual(r2.note, `receita ${r2.id}`); }

// spots: escala atual do jogo
const ids = new Set();
for (const s of spots.spots) {
  assert.ok(!ids.has(s.id), `id duplicado: ${s.id}`); ids.add(s.id);
  assert.ok(s.statCap >= s.stat, `${s.id}: teto abaixo do requisito`);
  assert.ok(s.silver >= 10e6 && s.silver <= 6e9, `${s.id}: silver fora de escala`);
  assert.ok(["medido", "derivado"].includes(s.silverSource), `${s.id}: fonte do silver nao declarada`);
  for (const l of ["pt", "en"]) assert.ok(i18n[l][`src_${s.silverSource}`], `i18n ${l} sem rotulo src_${s.silverSource}`);
  if (s.dpStat) assert.ok(s.dpStat > s.dp, `${s.id}: DP em Total Stat deveria superar o exibido`);
}
assert.ok(Math.max(...spots.spots.map((s) => s.stat)) >= 2500, "falta o endgame atual");

// receitas: a wiki precisa fechar mesmo quando o preco falta
const rids = new Set();
let priced = 0;
for (const r2 of recipes.recipes) {
  assert.ok(!rids.has(r2.id), `receita duplicada: ${r2.id}`); rids.add(r2.id);
  assert.ok(["cooking", "alchemy", "processing"].includes(r2.job), `${r2.id}: oficio invalido`);
  assert.ok(r2.inputs.length > 0, `${r2.id}: receita sem ingrediente`);
  for (const i of r2.inputs) {
    assert.ok(i.qty > 0, `${r2.id}: quantidade invalida em ${i.item}`);
    if (i.any) assert.ok(i.any.length > 0, `${r2.id}: lista 'any' vazia em ${i.item}`);
  }
  if (recipeProfit(r2, rp, netRate()).priced) priced++;
}
assert.ok(priced >= recipes.recipes.length * 0.5,
  `so ${priced}/${recipes.recipes.length} receitas tem preco completo`);

// classes: specs do BDO Class Hub
const cids = new Set();
for (const c of classes.specs) {
  assert.ok(!cids.has(c.id), `spec duplicada: ${c.id}`); cids.add(c.id);
  assert.ok(["S", "A+", "A", "B", "C"].includes(c.tier), `${c.id}: tier invalido`);
  assert.ok(["pequeno", "medio", "enorme"].includes(c.aoe), `${c.id}: aoe invalido`);
  assert.ok(["tranquilo", "moderado", "intenso"].includes(c.comfort), `${c.id}: comfort invalido`);
  assert.ok(["fragil", "resistente", "muito-resistente"].includes(c.tankiness), `${c.id}: tankiness invalido`);
  // cada valor precisa ter rotulo nas duas linguas, senao aparece a chave crua
  for (const k of [`aoe_${c.aoe}`, `comfort_${c.comfort}`, `tank_${c.tankiness}`])
    for (const l of ["pt", "en"]) assert.ok(i18n[l][k], `i18n ${l} sem rotulo para ${k}`);
}
console.log(`ok: ${spots.spots.length} spots · ${recipes.recipes.length} receitas (${priced} com preco) · ` +
  `${classes.specs.length} specs de ${new Set(classes.specs.map((c) => c.cls)).size} classes · i18n pt/en com ${ptK.length} chaves`);
