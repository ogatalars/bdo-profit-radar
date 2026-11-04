// Extrai as tabelas de receitas de culinaria e alquimia do Incendar e funde com
// data/recipes.json. As de Processing continuam escritas a mao (tem nota e
// metodo), e qualquer receita que ja exista aqui preserva nome/nota traduzidos.
import { readFileSync, writeFileSync } from "node:fs";

const PAGES = {
  cooking: "https://incendar.com/bdocookingrecipes.php",
  alchemy: "https://incendar.com/bdoalchemyrecipes.php",
};
const UA = "Mozilla/5.0 (compatible; bdo-profit-radar/1.0)";
const RECIPES = new URL("../data/recipes.json", import.meta.url);
const dry = process.argv.includes("--dry");

const strip = (h) => h.replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&rsquo;|’/g, "'")
  .replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();

// "5 Aloe" -> { qty: 5, item: "Aloe" }
const parseIngredient = (cell) => {
  const m = cell.match(/^(\d+)\s+(.+)$/);
  return m ? { item: m[2].trim(), qty: +m[1] } : null;
};

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 44);

const doc = JSON.parse(readFileSync(RECIPES, "utf8"));
const byOutput = new Map(doc.recipes.map((r) => [r.output.toLowerCase(), r]));
const added = [], merged = [];

for (const [job, url] of Object.entries(PAGES)) {
  const html = await (await fetch(url, { headers: { "User-Agent": UA } })).text();
  const rows = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) || [];
  for (const row of rows) {
    const cells = (row.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/g) || []).map(strip).filter(Boolean);
    if (cells.length < 2) continue;
    const [output, ...rest] = cells;
    const inputs = rest.map(parseIngredient).filter(Boolean);
    // Linha de cabecalho ou lixo: sem ingrediente quantificado nao e receita.
    if (!inputs.length || /^(recipe|name|product)$/i.test(output)) continue;

    const existing = byOutput.get(output.toLowerCase());
    if (existing) {
      // Preserva nome e nota traduzidos; so os ingredientes vem da fonte.
      existing.inputs = inputs.map((i) => {
        const prev = existing.inputs.find((p) => p.item === i.item);
        return prev?.any ? { ...i, any: prev.any } : i;
      });
      merged.push(output);
      continue;
    }
    doc.recipes.push({
      id: slug(output), name: { pt: output, en: output }, output, job, method: "",
      yield: 2.5, craftsPerHour: job === "cooking" ? 400 : 350,
      inputs, note: null,
    });
    added.push(output);
  }
}

// Ingrediente que o jogo trata como categoria recebe a lista de alternativas.
// Vem de um arquivo proprio para a fonte poder mudar o nome ("Grain" virou
// "Starch") sem a gente perder o mapeamento.
const GENERICS = JSON.parse(readFileSync(new URL("../data/generic-items.json", import.meta.url), "utf8")).generics;
let tagged = 0;
for (const r of doc.recipes) for (const i of r.inputs) {
  if (GENERICS[i.item]) { i.any = GENERICS[i.item]; tagged++; }
  else delete i.any;
}
console.log(`  ingredientes genericos marcados: ${tagged}`);

doc._meta.updatedAt = new Date().toISOString().slice(0, 10);
doc._meta.sources = [...new Set([...(doc._meta.sources || []), ...Object.values(PAGES)])];

const byJob = doc.recipes.reduce((a, r) => ((a[r.job] = (a[r.job] || 0) + 1), a), {});
console.log(`receitas: ${doc.recipes.length}`, byJob);
console.log(`  novas: ${added.length} | atualizadas: ${merged.length}`);
const items = new Set(doc.recipes.flatMap((r) => [r.output, ...r.inputs.map((i) => i.item)]));
console.log(`  itens distintos citados: ${items.size}`);
if (dry) { console.log("--dry: nada gravado."); process.exit(0); }
writeFileSync(RECIPES, JSON.stringify(doc, null, 1) + "\n");
console.log(`data/recipes.json gravado (${(JSON.stringify(doc).length / 1024).toFixed(0)} KB)`);
