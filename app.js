import { netRate as calcNet, pricer, recipeProfit, spotIncome } from "./calc.js";

const $ = (s) => document.querySelector(s);
const fmt = (n) => {
  const a = Math.abs(n);
  if (a >= 1e9) return (n / 1e9).toFixed(2).replace(".", ",") + " bi";
  if (a >= 1e6) return (n / 1e6).toFixed(a >= 1e8 ? 0 : 1).replace(".", ",") + " mi";
  if (a >= 1e3) return Math.round(n).toLocaleString("pt-BR");
  return Math.round(n).toString();
};
const pct = (n) => (n > 0 ? "+" : "") + n.toFixed(1).replace(".", ",") + "%";

// AoE amplo rende mais onde os mobs vem em grupo denso. Heuristica grosseira,
// usada so para desempatar spots proximos.
const AOE = {
  alto: "Witch Wizard Sage Nova Guardian Drakania Valkyrie Warrior Berserker Musa Striker Shai Scholar Dosa".split(" "),
  burst: "Ninja Kunoichi Archer Deadeye Ranger Sorceress Lahn Maehwa Hashashin Corsair Woosa Maegu Tamer Mystic Dark_Knight".split(" "),
};
const CLASSES = [...AOE.alto, ...AOE.burst].sort();
const classProfile = (c) => (AOE.alto.includes(c) ? "alto" : "burst");

let DAILY, SPOTS, RECIPES;

const netRate = () => calcNet({ vp: $("#vp").checked, ring: $("#ring").checked });
const P = () => pricer(DAILY);


async function load() {
  const region = $("#region").value;
  $("#status").textContent = "carregando dados...";
  const bust = `?v=${Date.now()}`;
  const [daily, spots, recipes] = await Promise.all([
    fetch(`data/daily.${region}.json${bust}`).then((r) => (r.ok ? r.json() : null)),
    fetch(`data/spots.json`).then((r) => r.json()),
    fetch(`data/recipes.json`).then((r) => r.json()),
  ]);
  if (!daily) { $("#status").textContent = `sem snapshot para a regiao ${region.toUpperCase()}.`; return; }
  DAILY = daily; SPOTS = spots; RECIPES = recipes;
  const when = new Date(daily.generatedAt);
  $("#status").innerHTML = `mercado <b>${region.toUpperCase()}</b> &middot; snapshot de ${when.toLocaleString("pt-BR")}` +
    (daily.prevAt ? ` &middot; comparado com ${new Date(daily.prevAt).toLocaleString("pt-BR")}`
                  : ` &middot; <span class="dim">primeiro snapshot, variacao de 24h so no proximo dia</span>`);
  renderAll();
}

function renderAll() {
  $("#netpct").textContent = (netRate() * 100).toFixed(1).replace(".", ",") + "%";
  renderMarket(); renderJobs(); renderSpots();
}

function renderMarket() {
  const tb = $("#t-demand tbody"); tb.innerHTML = "";
  for (const r of DAILY.demand) {
    const it = DAILY.items[r.id];
    tb.insertAdjacentHTML("beforeend", `<tr>
      <td class="name">${it.n}</td>
      <td class="num">${fmt(it.p)}</td>
      <td class="num">${fmt(r.sold)}</td>
      <td class="num">${fmt(r.sold * it.p)}</td></tr>`);
  }
  if (!DAILY.demand.length) tb.innerHTML = `<tr><td colspan="4" class="dim">precisa de dois snapshots para medir procura. Volte amanha.</td></tr>`;

  const tm = $("#t-movers tbody"); tm.innerHTML = "";
  for (const r of DAILY.movers) {
    const it = DAILY.items[r.id];
    tm.insertAdjacentHTML("beforeend", `<tr>
      <td class="name">${it.n}</td>
      <td class="num">${fmt(it.p)}</td>
      <td class="num ${r.dp >= 0 ? "up" : "down"}">${pct(r.dp)}</td>
      <td class="num dim">${fmt(it.s)}</td></tr>`);
  }
  if (!DAILY.movers.length) tm.innerHTML = `<tr><td colspan="4" class="dim">precisa de dois snapshots. Volte amanha.</td></tr>`;
}

function jobRows() {
  const rate = netRate();
  const p = P();
  return RECIPES.recipes.map((r) => ({ r, ...recipeProfit(r, p, rate) }))
    .filter((x) => x.priced).sort((a, b) => b.hour - a.hour);
}

function renderJobs() {
  const tb = $("#t-jobs tbody"); tb.innerHTML = "";
  for (const x of jobRows()) {
    tb.insertAdjacentHTML("beforeend", `<tr>
      <td class="name">${x.r.name}</td>
      <td class="dim">${x.r.job}</td>
      <td class="num">${fmt(x.cost)}</td>
      <td class="num">${fmt(x.revenue)}</td>
      <td class="num ${x.margin >= 0 ? "up" : "down"}">${pct(x.margin)}</td>
      <td class="num ${x.hour >= 0 ? "up" : "down"}"><b>${fmt(x.hour)}</b></td></tr>`);
  }
  if (!tb.children.length) tb.innerHTML = `<tr><td colspan="6" class="dim">sem precos suficientes.</td></tr>`;
}

function spotRows() {
  const rate = netRate();
  const apB = +$("#apBuff").value, dp = +$("#dp").value;
  const prof = classProfile($("#cls").value);
  const p = P();
  return SPOTS.spots.map((s) => {
    // heuristica declarada: AoE amplo ganha em spot denso, burst perde um pouco
    const adj = s.aoe === "alto" ? (prof === "alto" ? 1.06 : 0.94) : 1;
    return { s, adj, ...spotIncome(s, SPOTS._meta.trashUnitDefault || 3000, p, rate, adj),
             locked: apB < s.ap || dp < s.dp,
             missAp: Math.max(0, s.ap - apB), missDp: Math.max(0, s.dp - dp) };
  }).sort((a, b) => (a.locked - b.locked) || (b.total - a.total));
}

function renderSpots() {
  const hide = $("#hideLocked").checked;
  const rows = spotRows().filter((x) => !(hide && x.locked));
  const best = rows.find((x) => !x.locked);
  $("#spot-list").innerHTML = rows.map((x) => {
    const tp = (x.trash / (x.trash + x.market)) * 100 || 0;
    const dropsTxt = x.drops.filter((d) => d.value > 0)
      .sort((a, b) => b.value - a.value)
      .map((d) => `${d.name}: ${fmt(d.value)}/h`).join(" &middot; ") || "sem preco de mercado";
    return `<div class="card ${x.locked ? "locked" : ""}">
      <h3>${x.s.name}
        ${x === best ? '<span class="tag ok">melhor do dia pra voce</span>' : ""}
        ${x.locked ? `<span class="tag no">faltam ${x.missAp ? x.missAp + " AP" : ""}${x.missAp && x.missDp ? " e " : ""}${x.missDp ? x.missDp + " DP" : ""}</span>` : ""}
      </h3>
      <div class="meta">${x.s.zone} &middot; recomendado ${x.s.ap} AP / ${x.s.dp} DP &middot; AoE ${x.s.aoe}</div>
      <div class="big">${fmt(x.total)} <span style="font-size:13px;color:var(--dim)">silver/hora</span></div>
      <div class="bar"><i style="width:${tp}%;background:var(--dim)"></i><i style="width:${100 - tp}%;background:var(--accent)"></i></div>
      <div class="breakdown">
        <span><b style="color:var(--dim)">&#9632;</b> trash loot ${fmt(x.trash)}/h (${tp.toFixed(0)}%)</span>
        <span><b style="color:var(--accent)">&#9632;</b> mercado ${fmt(x.market)}/h</span>
        ${x.adj !== 1 ? `<span>ajuste de classe ${pct((x.adj - 1) * 100)}</span>` : ""}
      </div>
      <div class="breakdown">${dropsTxt}</div>
      <div class="breakdown"><i>${x.s.note}</i></div>
    </div>`;
  }).join("") || `<p class="dim">nada para mostrar.</p>`;
}

// --- UI wiring ---
$("#cls").innerHTML = CLASSES.map((c) => `<option>${c}</option>`).join("");
$("#cls").value = "Witch";
const TABS = ["market", "jobs", "spots"];
function showTab(name) {
  if (!TABS.includes(name)) name = "market";
  document.querySelectorAll("nav button").forEach((o) => o.setAttribute("aria-selected", o.dataset.tab === name));
  for (const t of TABS) $(`#tab-${t}`).hidden = t !== name;
}
document.querySelectorAll("nav button").forEach((b) =>
  b.addEventListener("click", () => { location.hash = b.dataset.tab; }));
addEventListener("hashchange", () => showTab(location.hash.slice(1)));
showTab(location.hash.slice(1));
["#vp", "#ring"].forEach((s) => $(s).addEventListener("change", () => DAILY && renderAll()));
["#cls", "#apBuff", "#apBase", "#dp", "#hideLocked"].forEach((s) =>
  $(s).addEventListener("input", () => DAILY && renderSpots()));
$("#region").addEventListener("change", load);
load().catch((e) => ($("#status").textContent = "erro ao carregar: " + e.message));
