// Logica de dinheiro, compartilhada entre a pagina e os testes.

// Taxa do mercado central: base 35%, Value Pack devolve +30%, Rich Merchant Ring +5%.
export const netRate = ({ vp = true, ring = true } = {}) =>
  0.65 * (1 + (vp ? 0.3 : 0) + (ring ? 0.05 : 0));

export function pricer(daily) {
  const priceOf = (name) => {
    const id = daily.names?.[name];
    if (id != null) return daily.items?.[id]?.p ?? 0;
    return daily.npc?.[name] ?? 0;
  };
  // Item de vendor/trash nao passa pelo mercado, entao nao sofre taxa.
  const isNpc = (name) => daily.names?.[name] == null && daily.npc?.[name] != null;
  return { priceOf, isNpc };
}

// Um ingrediente generico ("Grain") aceita varios itens; quem cozinha usa o
// mais barato do dia, entao a conta faz o mesmo.
export function resolveInput(i, priceOf) {
  const options = i.any?.length ? i.any : [i.item];
  let best = null;
  for (const name of options) {
    const price = priceOf(name);
    if (price > 0 && (!best || price < best.price)) best = { name, price };
  }
  return best ? { ...best, qty: i.qty, generic: i.any?.length ? i.item : null }
              : { name: i.item, price: 0, qty: i.qty, generic: null };
}

// Maestria so afeta culinaria e alquimia: em processing o 2,5 ja e a media do
// lote de 5 insumos.
export const effectiveYield = (r, mastery = 1) =>
  r.job === "processing" ? r.yield : r.yield * mastery;

export function recipeProfit(r, { priceOf, isNpc }, rate, mastery = 1) {
  const parts = r.inputs.map((i) => resolveInput(i, priceOf));
  const cost = parts.reduce((s, p) => s + p.price * p.qty, 0);
  const outPrice = priceOf(r.output);
  const revenue = effectiveYield(r, mastery) * outPrice * (isNpc(r.output) ? 1 : rate);
  const perCraft = revenue - cost;
  const missing = parts.filter((p) => p.price <= 0).map((p) => p.name);
  return {
    parts, cost, revenue, perCraft,
    hour: perCraft * r.craftsPerHour,
    margin: cost > 0 ? (perCraft / cost) * 100 : 0,
    missing: outPrice > 0 ? missing : [...missing, r.output],
    priced: outPrice > 0 && missing.length === 0,
  };
}

// Zonas modernas tem dois gates: o AP exibido no perfil e o Total Stat (soma
// com cristais e buffs). O Total Stat e o que a zona realmente checa.
// Acima de statCap, o AP excedente rende so capPct% — por isso empilhar AP
// alem do teto da zona nao aumenta silver proporcionalmente.
// O Garmoth publica tudo em Total Stat: AP e DP ja somados com cristais e buffs.
// E esse o requisito real das zonas, entao o gate compara os dois.
export function spotFit(s, { stat, dpStat }) {
  const missStat = Math.max(0, (s.stat ?? 0) - stat);
  const missDp = Math.max(0, (s.dpStat ?? 0) - dpStat);
  return {
    missStat, missDp,
    locked: missStat > 0 || missDp > 0,
    // Quanto do requisito voce ja tem; abaixo de 1 a zona ainda e um alvo.
    ratio: s.stat ? stat / s.stat : 1,
  };
}

// Silver e EXP vem medidos por hora. Normalizamos para comparar zonas entre si
// sem esconder que sao escalas diferentes.
export function rank(spots, metric) {
  const vals = spots.map((s) => s[metric]).filter((v) => v > 0);
  const max = Math.max(...vals, 1);
  return spots.map((s) => ({ ...s, pctOfBest: s[metric] > 0 ? (s[metric] / max) * 100 : null }));
}

// O silver/hora e a referencia da zona; o que varia com o dia e o preco dos
// drops de mercado dela. Devolvemos os dois lados separados, sem misturar
// numero medido com estimativa de preco.
export function spotToday(s, { priceOf }, movers = {}) {
  const items = (s.items || []).map((name) => ({
    name, price: priceOf(name), change: movers[name] ?? null,
  })).filter((i) => i.price > 0);
  const tracked = items.filter((i) => i.change != null);
  const drift = tracked.length
    ? tracked.reduce((a, i) => a + i.change, 0) / tracked.length
    : null;
  return { items, drift };
}

// --- Calculadora de receitas -------------------------------------------------
// Expande um item na arvore de tudo que ele precisa. 158 ingredientes do jogo
// sao eles mesmos produzidos por outra receita, entao a expansao e recursiva.

export const recipeIndex = (recipes) => {
  const byOutput = new Map();
  for (const r of recipes) if (!byOutput.has(r.output)) byOutput.set(r.output, r);
  return byOutput;
};

const MAX_DEPTH = 10;

// Custo unitario de PRODUZIR um item, memoizado. Null quando nao da para fechar
// a conta (algum insumo sem preco e sem receita).
function craftUnitCost(item, index, priceOf, memo, path, mastery = 1) {
  if (memo.has(item)) return memo.get(item);
  const r = index.get(item);
  if (!r || path.has(item) || path.size > MAX_DEPTH) return null;
  path.add(item);
  let total = 0, ok = true;
  for (const i of r.inputs) {
    const picked = resolveInput(i, priceOf);
    const buy = picked.price > 0 ? picked.price : null;
    const make = craftUnitCost(picked.name, index, priceOf, memo, path, mastery);
    const unit = buy != null && make != null ? Math.min(buy, make) : (buy ?? make);
    if (unit == null) { ok = false; break; }
    total += unit * i.qty;
  }
  path.delete(item);
  const per = ok ? total / effectiveYield(r, mastery) : null;
  memo.set(item, per);
  return per;
}

/**
 * @returns {{tree, shopping: Array, crafts: Array, cost: number|null, buyPrice: number|null}}
 * `shopping` sao os itens que voce realmente compra (folhas da decisao),
 * `crafts` sao os passos intermediarios na ordem de execucao.
 */
export function planRecipe(output, qty, index, priceOf, { expandAll = false, mastery = 1 } = {}) {
  const memo = new Map();
  const shopping = new Map();
  const crafts = new Map();

  const walk = (item, need, depth, path) => {
    const r = index.get(item);
    const buy = priceOf(item) || null;
    const make = r ? craftUnitCost(item, index, priceOf, memo, new Set(path), mastery) : null;
    const cyclic = path.has(item);
    // Sem receita, ciclo ou fundo do poco: compra.
    const mustBuy = !r || cyclic || depth >= MAX_DEPTH;
    // O item pedido e sempre craftado: quem abriu a calculadora quer a receita,
    // nao o conselho de comprar pronto. So os intermediarios decidem.
    const isRoot = depth === 0;
    const cheaperToBuy = !isRoot && buy != null && make != null && buy <= make;
    const node = { item, need, buy, make, depth, cyclic, children: [] };

    if (mustBuy || (!expandAll && cheaperToBuy)) {
      node.action = "buy";
      const prev = shopping.get(item) || { item, qty: 0, price: buy };
      prev.qty += need; prev.price = buy;
      shopping.set(item, prev);
      return node;
    }
    node.action = "craft";
    const batches = need / effectiveYield(r, mastery);
    node.batches = batches;
    const prev = crafts.get(item) || { item, qty: 0, batches: 0, yield: effectiveYield(r, mastery), job: r.job, depth, isRoot };
    prev.qty += need; prev.batches += batches; prev.depth = Math.max(prev.depth, depth);
    crafts.set(item, prev);
    const next = new Set(path).add(item);
    for (const i of r.inputs) {
      const picked = resolveInput(i, priceOf);
      node.children.push(walk(picked.name, batches * i.qty, depth + 1, next));
    }
    return node;
  };

  const tree = walk(output, qty, 0, new Set());
  // Quantidade de compra e inteira: ninguem compra 2,5 de trigo.
  const list = [...shopping.values()].map((s) => ({ ...s, qty: Math.ceil(s.qty - 1e-9) }));
  const cost = list.every((s) => s.price > 0)
    ? list.reduce((a, s) => a + s.price * s.qty, 0) : null;
  return {
    tree, shopping: list.sort((a, b) => (b.price * b.qty) - (a.price * a.qty)),
    // Mais fundo primeiro: e a ordem em que voce de fato craftaria.
    crafts: [...crafts.values()].filter((c) => c.item !== output || true).sort((a, b) => b.depth - a.depth),
    cost, buyPrice: priceOf(output) || null,
  };
}
