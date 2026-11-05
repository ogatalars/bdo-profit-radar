import { netRate as calcNet, pricer, recipeProfit, spotFit, spotToday,
         recipeIndex, planRecipe, effectiveYield } from "./calc.js";

const $ = (s) => document.querySelector(s);
const spotName = (s) => tr(s.name);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// ?lang=en tem prioridade: serve para compartilhar link ja na lingua certa.
const urlLang = new URLSearchParams(location.search).get("lang");
let DAILY, SPOTS, RECIPES, CLASSES, I18N,
    LANG = ["pt", "en"].includes(urlLang) ? urlLang : (localStorage.getItem("lang") || "pt");

// --- i18n
const t = (k, vars) => {
  let s = I18N?.[LANG]?.[k] ?? k;
  if (vars) for (const [a, b] of Object.entries(vars)) s = s.replaceAll(`{${a}}`, b);
  return s;
};
// Campo bilingue nos dados: {pt, en}. Texto solto cai para ele mesmo.
const tr = (v) => (v && typeof v === "object" ? v[LANG] ?? v.pt : v);
// Nome de item: o mercado devolve em ingles, mas o jogo em pt-BR mostra
// "Minerio de Ferro". O build guarda o par; aqui so escolhemos.
const itemName = (en) => (LANG === "pt" && DAILY?.ptNames?.[en]) || en;
// Nome de receita = nome do item que ela produz, ja traduzido.
const recipeName = (r) => itemName(r.output);
const loc = () => (LANG === "pt" ? "pt-BR" : "en-US");

const fmt = (n) => {
  const a = Math.abs(n), dec = (x, d) => x.toFixed(d).replace(".", LANG === "pt" ? "," : ".");
  if (a >= 1e9) return dec(n / 1e9, 2) + (LANG === "pt" ? " bi" : "B");
  if (a >= 1e6) return dec(n / 1e6, a >= 1e8 ? 0 : 1) + (LANG === "pt" ? " mi" : "M");
  if (a >= 1e3) return Math.round(n).toLocaleString(loc());
  return Math.round(n).toString();
};
const pct = (n) => (n > 0 ? "+" : "") + n.toFixed(1).replace(".", LANG === "pt" ? "," : ".") + "%";

const netRate = () => calcNet({ vp: $("#vp").checked, ring: $("#ring").checked });
const P = () => pricer(DAILY);

async function load() {
  const region = $("#region").value;
  $("#status").textContent = t("loading");
  const bust = `?v=${Date.now()}`;
  const [daily, spots, recipes, classes, i18n] = await Promise.all([
    // Todo JSON de dados leva cache-bust: o Pages serve com max-age=600 e, sem
    // isso, uma edicao em spots/recipes/classes so aparecia 10 min depois — ou
    // nem isso, se a aba ficasse aberta.
    fetch(`data/daily.${region}.json${bust}`).then((r) => (r.ok ? r.json() : null)),
    fetch(`data/spots.json${bust}`).then((r) => r.json()),
    fetch(`data/recipes.json${bust}`).then((r) => r.json()),
    fetch(`data/classes.json${bust}`).then((r) => r.json()),
    I18N ? Promise.resolve(I18N) : fetch(`data/i18n.json${bust}`).then((r) => r.json()),
  ]);
  I18N = i18n;
  if (!daily) { applyStatic(); $("#status").textContent = t("noSnapshot", { r: region.toUpperCase() }); return; }
  DAILY = daily; SPOTS = spots; RECIPES = recipes; CLASSES = classes;
  if (!$("#cls").options.length) {
    const byClass = [...new Set(classes.specs.map((s) => s.cls))].sort();
    $("#cls").innerHTML = byClass.map((c) => {
      const specs = classes.specs.filter((s) => s.cls === c);
      return specs.map((s) => `<option value="${s.id}">${esc(s.cls)} — ${esc(s.spec)}</option>`).join("");
    }).join("");
    $("#cls").value = "witch-succession";
  }
  renderAll();
}

function applyStatic() {
  document.documentElement.lang = LANG === "pt" ? "pt-BR" : "en";
  for (const el of document.querySelectorAll("[data-i18n]")) el.innerHTML = t(el.dataset.i18n);
}

function renderAll() {
  applyStatic();
  // ?make=Beer&qty=500 abre a calculadora ja preenchida — serve para compartilhar
  // um calculo pronto e para testar a pagina sem interagir.
  const q = new URLSearchParams(location.search);
  if (q.get("make") && !$("#calcItem").value) {
    $("#calcItem").value = q.get("make");
    if (q.get("qty")) $("#calcQty").value = q.get("qty");
  }
  // O datalist e refeito a cada troca de idioma: o nome digitado tem que ser o
  // mesmo que a pessoa le na tela.
  const outs = [...new Set(RECIPES.recipes.map((r) => r.output))]
    .map((n) => itemName(n)).sort((a, b) => a.localeCompare(b));
  $("#all-outputs").innerHTML = outs.map((n) => `<option value="${esc(n)}">`).join("");
  const when = new Date(DAILY.generatedAt);
  $("#status").innerHTML =
    t("subtitle", { r: `<b>${DAILY.region.toUpperCase()}</b>`, d: when.toLocaleString(loc()) }) +
    " &middot; " + (DAILY.prevAt
      ? t("comparedTo", { d: new Date(DAILY.prevAt).toLocaleString(loc()) })
      : `<span class="dim">${t("firstSnapshot")}</span>`);
  $("#netpct").innerHTML = t("youGet", { p: (netRate() * 100).toFixed(1).replace(".", LANG === "pt" ? "," : ".") + "%" });
  $("#classesNote").innerHTML = t("classesNote", { d: CLASSES._meta.listUpdated });
  renderMarket(); renderRecipes(); renderCalc(); renderSpots(); renderXp(); renderClasses();
}

function renderMarket() {
  const tb = $("#t-demand tbody");
  tb.innerHTML = DAILY.demand.map((r) => {
    const it = DAILY.items[r.id];
    return `<tr><td class="name">${esc(itemName(it.n))}</td><td class="num">${fmt(it.p)}</td>
      <td class="num">${fmt(r.sold)}</td><td class="num">${fmt(r.sold * it.p)}</td></tr>`;
  }).join("") || `<tr><td colspan="4" class="dim">${t("needTwo")}</td></tr>`;

  const tm = $("#t-movers tbody");
  tm.innerHTML = DAILY.movers.map((r) => {
    const it = DAILY.items[r.id];
    return `<tr><td class="name">${esc(itemName(it.n))}</td><td class="num">${fmt(it.p)}</td>
      <td class="num ${r.dp >= 0 ? "up" : "down"}">${pct(r.dp)}</td>
      <td class="num dim">${fmt(it.s)}</td></tr>`;
  }).join("") || `<tr><td colspan="4" class="dim">${t("needTwo")}</td></tr>`;
}

function renderRecipes() {
  const p = P(), rate = netRate();
  const q = $("#recSearch").value.trim().toLowerCase();
  const job = $("#recJob").value, sort = $("#recSort").value;
  // Um ingrediente que e saida de outra receita vira link da cadeia de producao.
  const madeBy = new Map(RECIPES.recipes.map((r) => [r.output, r]));

  const mastery = +$("#mastery").value;
  let rows = RECIPES.recipes.map((r) => ({ r, ...recipeProfit(r, p, rate, mastery) }));
  rows = rows.filter(({ r }) => (!job || r.job === job) &&
    (!q || `${recipeName(r)} ${r.output} ${r.inputs.map((i) => itemName(i.item) + " " + i.item).join(" ")}`
      .toLowerCase().includes(q)));
  rows.sort(sort === "name"
    ? (a, b) => recipeName(a.r).localeCompare(recipeName(b.r))
    : (a, b) => (b.priced - a.priced) || (b.hour - a.hour));

  $("#recipe-list").innerHTML = rows.map(({ r, parts, cost, revenue, hour, margin, priced, missing }) => {
    const ing = parts.map((pt_) => {
      const chain = madeBy.get(pt_.name);
      return `<li><b>${pt_.qty}×</b> ${esc(itemName(pt_.name))}
        ${pt_.generic ? `<span class="tag">${esc(itemName(pt_.generic))} · ${t("cheapest")}</span>` : ""}
        ${pt_.price > 0 ? `<span class="dim">${fmt(pt_.price)}</span>` : `<span class="down">—</span>`}
        ${chain ? `<span class="tag">← ${esc(recipeName(chain))}</span>` : ""}</li>`;
    }).join("");
    const method = r.method ? ` · ${esc(r.method)}` : "";
    return `<div class="card">
      <h3>${esc(recipeName(r))} <span class="tag">${t(r.job)}${method}</span></h3>
      <div class="meta">${t("yield")} <b>${String(r.yield).replace(".", LANG === "pt" ? "," : ".")}×</b>
        ${esc(itemName(r.output))} ${t("perCraft")}</div>
      <ul class="ing">${ing}</ul>
      ${priced ? `<div class="recipe-num">
          <span>${t("cost")}: <b>${fmt(cost)}</b></span>
          <span>${t("revenue")}: <b>${fmt(revenue)}</b></span>
          <span>${t("margin")}: <b class="${margin >= 0 ? "up" : "down"}">${pct(margin)}</b></span>
          <span>${t("profitHour")}: <b class="${hour >= 0 ? "up" : "down"}">${fmt(hour)}</b></span>
        </div>`
        : `<div class="breakdown dim">${t("noPrice", { x: esc(missing.map(itemName).join(", ")) })}</div>`}
      <div class="breakdown"><i>${esc(tr(r.note))}</i></div>
    </div>`;
  }).join("") || `<p class="dim">—</p>`;
}

function renderCalc() {
  const p = P();
  const idx = recipeIndex(RECIPES.recipes);
  const want = $("#calcItem").value.trim();
  const qty = Math.max(1, +$("#calcQty").value || 1);
  const out = $("#calc-out");

  if (!want) { out.innerHTML = `<p class="dim">${t("pickItem")}</p>`; return; }
  // Aceita o nome traduzido ou o nome de mercado, sem exigir acerto exato de caixa.
  const low = want.toLowerCase();
  const keys = [...idx.keys()];
  const match = keys.find((k) => k.toLowerCase() === low) ||
    keys.find((k) => itemName(k).toLowerCase() === low) ||
    keys.find((k) => k.toLowerCase().startsWith(low)) ||
    keys.find((k) => itemName(k).toLowerCase().startsWith(low)) ||
    keys.find((k) => itemName(k).toLowerCase().includes(low));
  if (!match) { out.innerHTML = `<p class="dim">${t("noRecipe")}</p>`; return; }

  const plan = planRecipe(match, qty, idx, p.priceOf,
    { expandAll: $("#calcExpand").checked, mastery: +$("#calcMastery").value });
  const ready = plan.buyPrice ? plan.buyPrice * qty : null;
  const diff = plan.cost != null && ready != null ? ((ready - plan.cost) / ready) * 100 : null;

  const shop = plan.shopping.map((s) => `<tr>
      <td class="name">${esc(itemName(s.item))}</td>
      <td class="num"><b>${s.qty.toLocaleString(loc())}</b></td>
      <td class="num dim">${s.price > 0 ? fmt(s.price) : "—"}</td>
      <td class="num">${s.price > 0 ? fmt(s.price * s.qty) : "—"}</td></tr>`).join("");

  const steps = plan.crafts.map((c, n) => `<li>
      <span class="tag">${n + 1}</span> <b>${esc(itemName(c.item))}</b>
      &middot; ${Math.ceil(c.batches).toLocaleString(loc())} ${t("batches")}
      <span class="dim">(${t("makes")} ${Math.ceil(c.qty).toLocaleString(loc())})</span>
      <span class="tag">${t(c.job)}</span></li>`).join("");

  out.innerHTML = `
    <div class="card">
      <h3>${esc(itemName(match))} &times; ${qty.toLocaleString(loc())}</h3>
      <div class="recipe-num" style="border:0;padding-top:0">
        <span>${t("totalCost")}: <b class="${plan.cost != null ? "" : "dim"}">${plan.cost != null ? fmt(plan.cost) : "?"}</b></span>
        ${ready != null ? `<span>${t("buyReady")}: <b>${fmt(ready)}</b></span>` : ""}
        ${diff != null ? `<span class="${diff >= 0 ? "up" : "down"}"><b>${diff >= 0 ? t("youSave") : t("youLose")}
           ${diff >= 0 ? pct(diff) : ""}</b></span>` : ""}
      </div>
      ${plan.cost == null ? `<div class="breakdown dim">${t("unknownCost")}</div>` : ""}
    </div>
    <div class="grid2">
      <div><h3>${t("shoppingList")}</h3>
        <table><thead><tr><th>${t("item")}</th><th class="num">${t("qty")}</th>
          <th class="num">${t("unit")}</th><th class="num">${t("subtotal")}</th></tr></thead>
          <tbody>${shop}</tbody></table></div>
      <div><h3>${t("craftSteps")}</h3>
        <ol class="steps">${steps || `<li class="dim">—</li>`}</ol></div>
    </div>`;
}

function renderSpots() {
  const p = P();
  const me = { stat: +$("#stat").value, dpStat: +$("#dpStat").value };
  const spec = CLASSES.specs.find((c) => c.id === $("#cls").value);
  const rows = SPOTS.spots.filter((s) => s.silver).map((s) =>
    ({ s, ...spotFit(s, me), ...spotToday(s, p, DAILY.changes || {}) }))
    .sort((a, b) => (a.locked - b.locked) || ((b.s.silver ?? -1) - (a.s.silver ?? -1)));
  const visible = $("#hideLocked").checked ? rows.filter((x) => !x.locked) : rows;
  const best = visible.find((x) => !x.locked);

  const head = spec ? `<div class="note"><b>${esc(spec.cls)} — ${esc(spec.spec)}</b>
    <span class="tag tier-${spec.tier.replace("+", "p")}">${spec.tier}</span>
    <span class="tag">${t("aoe_" + spec.aoe)}</span>
    <span class="tag">${t("comfort_" + spec.comfort)}</span>
    <span class="tag">${t("tank_" + spec.tankiness)}</span>
    ${spec.weapon ? `<br><span class="dim">${esc(spec.weapon)} &rarr; ${esc(spec.awakening)}</span>` : ""}
    </div>` : "";

  $("#spot-list").innerHTML = head + (visible.map((x) => {
    const s = x.s;
    const miss = [x.missStat && `${x.missStat} AP`, x.missDp && `${x.missDp} DP`]
      .filter(Boolean).join(` ${t("and")} `);
    const itemsTxt = x.items.map((i) =>
      `${esc(itemName(i.name))} ${fmt(i.price)}${i.change != null
        ? ` <span class="${i.change >= 0 ? "up" : "down"}">${pct(i.change)}</span>` : ""}`).join(" &middot; ")
      || `<span class="dim">${t("outOfMarket")}</span>`;
    return `<div class="card ${x.locked ? "locked" : ""}">
      <h3>${esc(spotName(s))}
        ${x === best ? `<span class="tag ok">${t("bestForYou")}</span>` : ""}
        ${x.locked ? `<span class="tag no">${t("missing")} ${miss}</span>` : ""}
        ${x.overCap && !x.locked ? `<span class="tag">${t("overCap")}</span>` : ""}
        ${x.srcAge != null && x.srcAge > 365 ? `<span class="tag old">${t("sourceOld")}</span>` : ""}</h3>
      <div class="meta">${t("asks")} <b>${s.stat}</b> AP ${t("and")} <b>${s.dpStat}</b> DP
        <span class="dim">(Total Stat)</span>${s.trashPerHour ? ` &middot; ${fmt(s.trashPerHour)} ${t("trashHour")}` : ""}
        ${s.tier ? ` &middot; <span class="tag">${esc(s.tier)}</span>` : ""}</div>
      <div class="big">${fmt(s.silver)} <span style="font-size:13px;color:var(--dim)">${t("silverHour")}</span>
        ${s.xp ? `<span class="dim" style="font-size:13px"> &middot; ${fmt(s.xp)} ${t("xpHour")}</span>` : ""}</div>
      ${x.drift != null ? `<div class="breakdown">${t("dropsToday")}
        <b class="${x.drift >= 0 ? "up" : "down"}">${pct(x.drift)}</b> ${t("onAverage")}</div>` : ""}
      <div class="breakdown">${itemsTxt}</div>
      ${s.note ? `<div class="breakdown"><i>${esc(tr(s.note))}</i></div>` : ""}
    </div>`;
  }).join("") || `<p class="dim">${t("noSpots")}</p>`);
}

function renderXp() {
  const me = { stat: +$("#xpStat").value, dpStat: +$("#xpDp").value };
  const rows = SPOTS.spots.filter((s) => s.xp).map((s) => ({ s, ...spotFit(s, me) }))
    .sort((a, b) => (a.locked - b.locked) || (b.s.xp - a.s.xp));
  const visible = $("#xpHideLocked").checked ? rows.filter((x) => !x.locked) : rows;
  const best = visible.find((x) => !x.locked);
  const top = Math.max(...rows.map((x) => x.s.xp));
  $("#xp-list").innerHTML = visible.map((x) => {
    const s = x.s;
    const miss = [x.missStat && `${x.missStat} AP`, x.missDp && `${x.missDp} DP`]
      .filter(Boolean).join(` ${t("and")} `);
    return `<div class="card ${x.locked ? "locked" : ""}">
      <h3>${esc(spotName(s))}
        ${x === best ? `<span class="tag ok">${t("bestXp")}</span>` : ""}
        ${x.locked ? `<span class="tag no">${t("missing")} ${miss}</span>` : ""}</h3>
      <div class="meta">${t("asks")} <b>${s.stat}</b> AP ${t("and")} <b>${s.dpStat}</b> DP
        <span class="dim">(Total Stat)</span> &middot; ${t("refLevel")} ${s.level}</div>
      <div class="big">${fmt(s.xp)} <span style="font-size:13px;color:var(--dim)">${t("xpHour")}</span></div>
      <div class="bar"><i style="width:${(s.xp / top) * 100}%;background:var(--accent)"></i></div>
      <div class="breakdown">
        <span><b>${String(s.xpPct ?? "?").replace(".", LANG === "pt" ? "," : ".")}%</b> ${t("xpPct")}</span>
        ${s.toLevel ? `<span>${s.toLevel} ${t("toLevel")}</span>` : ""}
        ${s.silver ? `<span>${fmt(s.silver)} ${t("silverHour")}</span>` : ""}
      </div>
    </div>`;
  }).join("") || `<p class="dim">${t("noSpots")}</p>`;
}

function renderClasses() {
  const q = $("#clsSearch").value.trim().toLowerCase();
  const tier = $("#clsTier").value, aoe = $("#clsAoe").value, tank = $("#clsTank").value;
  const order = { S: 0, "A+": 1, A: 2, B: 3, C: 4 };
  const rows = CLASSES.specs.filter((c) =>
    (!tier || c.tier === tier) && (!aoe || c.aoe === aoe) && (!tank || c.tankiness === tank) &&
    (!q || `${c.cls} ${c.spec} ${c.weapon} ${c.awakening}`.toLowerCase().includes(q)))
    .sort((a, b) => order[a.tier] - order[b.tier] || a.cls.localeCompare(b.cls));
  $("#class-list").innerHTML = rows.map((c) => `<div class="card">
      <h3>${esc(c.cls)} <span class="tag tier-${c.tier.replace("+", "p")}">${c.tier}</span></h3>
      <div class="meta">${esc(c.spec)}${c.weapon ? ` &middot; ${esc(c.weapon)} &rarr; ${esc(c.awakening)}` : ""}</div>
      <div class="breakdown">
        <span class="tag">${t("aoe_" + c.aoe)}</span>
        <span class="tag">${t("comfort_" + c.comfort)}</span>
        <span class="tag">${t("tank_" + c.tankiness)}</span></div>
    </div>`).join("") || `<p class="dim">${t("noClasses")}</p>`;
}

const TABS = ["market", "recipes", "calc", "spots", "xp", "classes"];
function showTab(name) {
  if (!TABS.includes(name)) name = "market";
  document.querySelectorAll("nav button").forEach((o) => o.setAttribute("aria-selected", o.dataset.tab === name));
  for (const t_ of TABS) $(`#tab-${t_}`).hidden = t_ !== name;
}
document.querySelectorAll("nav button").forEach((b) =>
  b.addEventListener("click", () => { location.hash = b.dataset.tab; }));
addEventListener("hashchange", () => showTab(location.hash.slice(1)));
showTab(location.hash.slice(1));

$("#lang").value = LANG;
$("#lang").addEventListener("change", () => {
  LANG = $("#lang").value; localStorage.setItem("lang", LANG);
  if (DAILY) renderAll(); else applyStatic();
});
["#vp", "#ring"].forEach((s) => $(s).addEventListener("change", () => DAILY && renderAll()));
["#cls", "#stat", "#dpStat", "#hideLocked"].forEach((s) =>
  $(s).addEventListener("input", () => DAILY && renderSpots()));
["#xpStat", "#xpDp", "#xpHideLocked"].forEach((s) =>
  $(s).addEventListener("input", () => DAILY && renderXp()));
["#calcItem", "#calcQty", "#calcExpand", "#calcMastery"].forEach((s) =>
  $(s).addEventListener("input", () => DAILY && renderCalc()));
["#recSearch", "#recJob", "#recSort", "#mastery"].forEach((s) =>
  $(s).addEventListener("input", () => DAILY && renderRecipes()));
["#clsSearch", "#clsTier", "#clsAoe", "#clsTank"].forEach((s) =>
  $(s).addEventListener("input", () => DAILY && renderClasses()));
$("#region").addEventListener("change", load);
load().catch((e) => { applyStatic(); $("#status").textContent = t("loadError", { e: e.message }); });
