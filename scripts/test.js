// Check minimo: conta de dinheiro, gate de spot, integridade dos dados e i18n.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { netRate, pricer, recipeProfit, resolveInput, spotFit, spotToday,
         recipeIndex, planRecipe } from "../calc.js";

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

// --- calculadora: quantidades tem que fechar na mao
{
  // Fab: 1 craft usa 5 Raw e rende 2 -> 10 Fab precisa de 5 crafts e 25 Raw.
  const idx = recipeIndex([
    { output: "Fab", yield: 2, job: "cooking", craftsPerHour: 1, inputs: [{ item: "Raw", qty: 5 }] },
  ]);
  const fake2 = { names: { Raw: 1 }, items: { 1: { p: 100 } }, npc: {} };
  const plan = planRecipe("Fab", 10, idx, pricer(fake2).priceOf);
  assert.equal(plan.shopping.length, 1);
  assert.equal(plan.shopping[0].item, "Raw");
  assert.equal(plan.shopping[0].qty, 25, "10 unidades com yield 2 = 5 crafts = 25 insumos");
  assert.equal(plan.cost, 2500);
  assert.equal(plan.crafts[0].batches, 5);
}
{
  // Cadeia de dois niveis: Final <- Meio <- Base, com quantidade propagada.
  const idx = recipeIndex([
    { output: "Final", yield: 1, job: "cooking", craftsPerHour: 1, inputs: [{ item: "Meio", qty: 2 }] },
    { output: "Meio", yield: 1, job: "processing", craftsPerHour: 1, inputs: [{ item: "Base", qty: 3 }] },
  ]);
  const f = { names: { Base: 1 }, items: { 1: { p: 10 } }, npc: {} };
  const plan = planRecipe("Final", 5, idx, pricer(f).priceOf);
  assert.equal(plan.shopping[0].qty, 30, "5 Final = 10 Meio = 30 Base");
  // O passo mais fundo vem primeiro: e a ordem em que se fabrica.
  assert.equal(plan.crafts[0].item, "Meio");
  assert.equal(plan.crafts.at(-1).item, "Final");
}
{
  // Quando comprar o intermediario e mais barato, a calculadora compra...
  const idx = recipeIndex([
    { output: "Topo", yield: 1, job: "cooking", craftsPerHour: 1, inputs: [{ item: "Meio", qty: 1 }] },
    { output: "Meio", yield: 1, job: "cooking", craftsPerHour: 1, inputs: [{ item: "Caro", qty: 10 }] },
  ]);
  const f = { names: { Meio: 1, Caro: 2 }, items: { 1: { p: 50 }, 2: { p: 100 } }, npc: {} };
  const plan = planRecipe("Topo", 1, idx, pricer(f).priceOf);
  assert.deepEqual(plan.shopping.map((s) => s.item), ["Meio"], "Meio custa 50 pronto e 1000 craftado");
  // ...mas o item pedido nunca e "compre pronto": quem abriu a calculadora quer a receita.
  const root = planRecipe("Meio", 1, idx, pricer(f).priceOf);
  assert.deepEqual(root.shopping.map((s) => s.item), ["Caro"], "a raiz sempre e craftada");
  // e com expandAll a arvore inteira abre
  const full = planRecipe("Topo", 1, idx, pricer(f).priceOf, { expandAll: true });
  assert.deepEqual(full.shopping.map((s) => s.item), ["Caro"]);
}
{
  // Receita circular nao pode travar o navegador.
  const idx = recipeIndex([
    { output: "A", yield: 1, job: "cooking", craftsPerHour: 1, inputs: [{ item: "B", qty: 1 }] },
    { output: "B", yield: 1, job: "cooking", craftsPerHour: 1, inputs: [{ item: "A", qty: 1 }] },
  ]);
  const f = { names: {}, items: {}, npc: {} };
  const plan = planRecipe("A", 1, idx, pricer(f).priceOf);
  assert.ok(plan.shopping.length > 0, "ciclo deve terminar comprando, nao em loop");
}

// --- gate de spot: Total Stat de AP e DP
const zone = { stat: 1130, dpStat: 430, items: ["Out"] };
assert.equal(spotFit(zone, { stat: 900, dpStat: 500 }).locked, true, "AP insuficiente trava");
assert.equal(spotFit(zone, { stat: 1200, dpStat: 400 }).locked, true, "DP insuficiente trava");
assert.equal(spotFit(zone, { stat: 1130, dpStat: 430 }).locked, false, "exatamente no requisito libera");
assert.equal(spotFit(zone, { stat: 900, dpStat: 430 }).missStat, 230);
assert.equal(spotFit(zone, { stat: 1130, dpStat: 300 }).missDp, 130);
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
for (const s of spots.spots) if (s.note) bilingual(s.note, `spot ${s.id}`);
// Nome e obrigatorio nas duas linguas; nota e opcional (as 276 importadas em
// massa nao tem texto proprio), mas se existir precisa estar completa.
for (const r2 of recipes.recipes) {
  bilingual(r2.name, `receita ${r2.id}`);
  if (r2.note) bilingual(r2.note, `receita ${r2.id}`);
}

// spots: schema vindo do Garmoth
const ids = new Set();
let withXp = 0, withSilver = 0;
for (const s of spots.spots) {
  assert.ok(!ids.has(s.id), `id duplicado: ${s.id}`); ids.add(s.id);
  bilingual(s.name, `spot ${s.id}`);
  assert.ok(s.garmothId > 0, `${s.id}: sem id do Garmoth para rastrear a origem`);
  assert.ok(s.stat > 0 && s.stat <= 3000, `${s.id}: Total Stat AP fora de escala (${s.stat})`);
  assert.ok(s.dpStat > 0 && s.dpStat <= 1200, `${s.id}: Total Stat DP fora de escala (${s.dpStat})`);
  if (s.silver != null) {
    assert.ok(s.silver >= 1e7 && s.silver <= 1e10, `${s.id}: silver fora de escala (${s.silver})`);
    withSilver++;
  }
  if (s.xp != null) {
    assert.ok(s.xp > 0 && s.xp <= 1e9, `${s.id}: xp fora de escala (${s.xp})`);
    assert.ok(s.level > 0, `${s.id}: xp sem nivel de referencia, o numero fica sem significado`);
    withXp++;
  }
}
assert.ok(withSilver >= 50, `poucos spots com silver: ${withSilver}`);
assert.ok(withXp >= 30, `poucos spots com xp: ${withXp}`);
assert.ok(Math.max(...spots.spots.map((s) => s.stat)) >= 2500, "falta o endgame atual");
// AP e DP andam juntos: zona que pede muito AP nao pode pedir DP trivial
for (const s of spots.spots)
  if (s.stat > 2000) assert.ok(s.dpStat > 500, `${s.id}: ${s.stat} AP mas so ${s.dpStat} DP, dado suspeito`);

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
// A calculadora precisa da arvore inteira: um intermediario faltando quebra a cadeia.
{
  const idx = recipeIndex(recipes.recipes);
  const outs = new Set(recipes.recipes.map((r) => r.output));
  const chained = new Set(recipes.recipes.flatMap((r) => r.inputs.map((i) => i.item)).filter((i) => outs.has(i)));
  assert.ok(chained.size > 100, `poucas cadeias: ${chained.size}`);
  // Nenhuma receita real pode estourar profundidade ou girar em ciclo.
  for (const r of recipes.recipes) {
    const plan = planRecipe(r.output, 10, idx, rp.priceOf);
    assert.ok(plan.shopping.length > 0 || plan.crafts.length > 0, `${r.output}: plano vazio`);
    assert.ok(plan.shopping.every((s) => s.qty > 0 && Number.isInteger(s.qty)),
      `${r.output}: quantidade de compra tem que ser inteira e positiva`);
  }
}
assert.ok(priced >= recipes.recipes.length * 0.3,
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
console.log(`ok: ${spots.spots.length} spots (${withSilver} silver, ${withXp} xp) · ${recipes.recipes.length} receitas (${priced} com preco) · ` +
  `${classes.specs.length} specs de ${new Set(classes.specs.map((c) => c.cls)).size} classes · i18n pt/en com ${ptK.length} chaves`);
