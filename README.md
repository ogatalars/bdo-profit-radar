# BDO Profit Radar

Site estático em **português** (com inglês opcional) que mostra, para Black Desert
Online: o que o mercado central está negociando hoje, uma wiki de 322 receitas de
culinária, alquimia e processamento com o lucro de cada uma, uma calculadora que
diz o que comprar para fabricar qualquer item, qual spot rende mais
**silver** e qual rende mais **EXP** para os seus stats, e o tier de PvE de cada
spec de classe.

Sem backend, sem banco, sem custo. Um workflow do GitHub Actions tira um snapshot
do mercado por dia e commita um JSON; o GitHub Pages serve a página, que só lê
esse arquivo.

## Como funciona

```
GitHub Actions (1x/dia)          GitHub Pages
  scripts/build-daily.js   ->    data/daily.<regiao>.json   ->  index.html
  varre o mercado inteiro        ~6 KB, já diferenciado         calcula no browser
```

O snapshot do dia é comparado com o do dia anterior. É daí que saem as duas
colunas que a API não entrega prontas:

- **procura do dia**: `totalTrades` é acumulado desde sempre, então a diferença
  entre dois snapshots é quanto foi vendido nas últimas 24h.
- **variação**: preço de hoje contra o de ontem.

`data/snapshot.<regiao>.json` guarda só preço e total de vendas por item, para o
diff do dia seguinte. É o único estado que existe, e vive no cache do Actions —
não no git, que ficaria ~1 MB mais pesado por dia. Se o cache expirar, o build
perde um dia de variação e segue.

## Rodando local

```bash
node scripts/build-daily.js      # REGION=na|eu|sa, padrão na
node scripts/test.js             # checa a conta de dinheiro
python3 -m http.server 8777      # abre http://localhost:8777
```

Sem dependências: Node 22 (`fetch` nativo) e qualquer servidor estático.

## Calibrando

Os **preços** são reais e ao vivo. As **taxas** não — são estimativas da
comunidade e ficam todas em JSON para você corrigir:

| arquivo | o que ajustar |
|---|---|
| `data/spots.json` | `silver` por hora, `stat`/`dp` exigidos, `statCap` |
| `data/recipes.json` | `yield` (rendimento por craft), `craftsPerHour`, ingredientes |
| `data/generic-items.json` | o que vale como "Carne", "Grão", "Sangue 3"… |
| `data/classes.json` | tier e ratings por spec |
| `data/npc-prices.json` | itens que não passam pelo mercado central |
| `data/i18n.json` | textos da interface em pt e en |

## Idiomas

Português é o padrão. O seletor no topo troca para inglês e grava a escolha no
navegador; `?lang=en` força o idioma pela URL.

**Nomes de item também são traduzidos.** A Arsha publica o mesmo catálogo em
várias línguas com os mesmos ids, então o build casa `en → pt` por id e guarda
o par dos ~600 itens que o site cita. O jogo em pt-BR mostra "Minério de Ferro",
e o site passa a mostrar o mesmo. Casar por id (e não por nome) é o que faz
funcionar para itens comprados no NPC, que nem id de mercado têm.

As categorias (`Carne`, `Grão`, `Sangue 3`) não existem no catálogo: o rótulo
delas vem de `data/generic-items.json`. A busca da calculadora aceita o nome nas
duas línguas.

Os testes falham se uma chave existir em um idioma e faltar no outro, ou se um
campo bilingue dos dados (`{pt, en}`) vier pela metade.

## Calculadora de receitas

Você diz o que quer fazer e quantas unidades; ela devolve **exatamente o que
comprar no mercado**. Para 500 cervejas: 1.000 Barley, 1.200 Água Mineral, 400
Fermento, 200 Açúcar — e os 200 crafts que isso dá.

A expansão é recursiva porque **158 ingredientes do jogo são produzidos por
outras receitas**. Balenos Meal, por exemplo, abre em 6 passos até chegar aos
itens que você realmente compra.

Duas decisões embutidas:

- **O item pedido é sempre fabricado.** Quem abre a calculadora quer a receita,
  não o conselho de comprar pronto. Só os intermediários decidem, e aí ela
  compra quando sair mais barato que fabricar (marque *abrir tudo* para ver a
  árvore inteira).
- **Quantidades de compra são inteiras.** Ninguém compra 2,5 de trigo.

Ciclos e cadeias muito profundas terminam em compra em vez de travar o
navegador, e há teste para isso.

`?make=Beer&qty=500` abre um cálculo pronto pela URL.

## Ingredientes genéricos

Receitas como Cerveja pedem "Grão", não um grão específico. No jogo você usa o
mais barato que tiver; o site faz o mesmo. O mapeamento de categoria para itens
reais fica em `data/generic-items.json`, separado das receitas — a fonte já
renomeou "Grain" para "Starch" uma vez, e o mapa sobrevive a isso.

Se um número do site não bate com a sua hora real de grind, o errado é a taxa no
JSON, não o preço. Ajuste e mande PR.

## Atualizando os spots

Spots e XP vêm do **Garmoth**, que publica silver/hora e EXP/hora medidos de
sessões reais de jogadores. O Garmoth bloqueia acesso de servidor (Cloudflare
403 em qualquer endpoint, inclusive na API interna), então o caminho é:

1. Abrir no navegador e salvar o markdown das páginas:
   - `garmoth.com/grind-tracker/best-grind-spots` → silver/hora, trash, Total Stat
   - `garmoth.com/grind-tracker/combat-exp` → EXP/hora e nível de referência
2. `node scripts/import-garmoth.js <pasta-com-os-md>`
3. `node scripts/test.js`

O importador casa os dois arquivos pelo **id numérico da URL do Garmoth**, não
pelo nome — nome vem traduzido conforme a língua da conta. Ele também:

- recupera as linhas em que o clipper perdeu o link, reatribuindo o nome pelo
  Total Stat (acontece justamente nas zonas mais lucrativas, as primeiras);
- traduz pt→en via `scripts/garmoth-names.json`, e deixa passar o que já está
  em inglês;
- herda o DP de uma zona de mesmo Total Stat quando o spot só aparece na página
  de EXP (marcado com `dpInferred`);
- **preserva as notas escritas à mão** — só os números são sobrescritos.

Use `--dry` para ver o que mudaria antes de gravar.

### Por que não é automático

Não existe API pública de grind spots. Verificado: `api.garmoth.com/api/grind-tracker/getGrindSpots`
existe e dispensa autenticação, mas responde 403 por Cloudflare para qualquer
cliente que não seja navegador — CI não alcança. Arsha e Velia Inn cobrem só o
mercado. O Internet Archive tem snapshot do grind tracker, mas não da página de EXP.

`scripts/check-sources.js` roda toda segunda-feira, compara as páginas-fonte de
classes e receitas com o último hash visto e **abre uma issue** quando alguma
muda ou passa de 180 dias. Não atualiza nada: serve para o dado não apodrecer
em silêncio.

## Quando as fontes divergem

Fontes públicas discordam entre si (Saunil Camp aparece como 250 AP num guia e
270 noutro; Hexe Sanctuary rende "650M a 1,2B por hora"). A regra aqui é ficar
com **o valor mais baixo**: requisito menor não impede ninguém de tentar, e
silver menor não promete o que a hora não entrega.

Onde não existe medição pública de silver/hora, o campo fica **vazio** e o site
mostra "sem medição pública" — em vez de um número estimado com cara de fato.

## Os dois números de stat

As zonas modernas não olham o AP do seu perfil. Elas olham o **Total Stat** — a
soma de AP com cristais, elixires e buffs — que hoje chega a 2570 no endgame
(Event Horizon). O **AP exibido** no perfil para em ~420. São escalas diferentes
e o site pede as duas, porque confundir uma com a outra trava a zona errada.

O mesmo vale para DP: Event Horizon pede 505 DP exibido / 870 DP em Total Stat.

Zonas mais antigas — **todo o Elvia Realm** — nunca foram publicadas em Total
Stat. Nelas `stat` é `null` e o gate passa a ser o AP exibido, o que o card diz
explicitamente. Inventar um Total Stat equivalente travaria a zona errada.

Cada zona tem ainda um **teto** (`statCap`): AP acima dele conta só 70% — e 30%
em Darkseeker's Retreat. Por isso empilhar AP além do teto da zona não aumenta
silver proporcionalmente, e o site avisa quando você passou dele.

## O que este projeto não sabe

Vale saber antes de confiar no número:

- **Silver/hora é referência, não promessa.** `medido` vem de sessões reais de
  jogadores; `derivado` é calculado do valor do trash da zona, ancorado na sessão
  medida de Aetherion Castle. Buffs, Agris Fever, pets, conhecimento e a sua
  rotação mudam o resultado.
- **Nem tudo passa pelo mercado.** `Ancient Spirit Dust`, `Trace of Savagery` e
  `Hard Black Crystal Shard` não são negociados no mercado central hoje — estão
  contabilizados dentro do trash loot. Sal, açúcar e água mineral são de vendor,
  com preço fixo em `npc-prices.json`.
- **O tier de classe é por spec e tem autor.** Vem do BDO Class Hub, lista do
  expert Choice, com data. A mesma classe muda de tier entre Awakening,
  Succession e especialização própria — Ninja é S em Succession e C em
  Awakening. A+ fica em torno de 95% do desempenho do S, então a diferença
  prática entre os tiers altos é menor do que a letra sugere. E a classe que
  você joga bem rende mais que a "melhor" que você joga mal.
- **A wiki não cobre o jogo inteiro.** São 46 receitas das mais usadas, não as
  centenas que existem. Receita sem preço de mercado (peixe, massa, óleo de
  baleia) aparece na wiki mas fica fora do ranking de lucro.
- **Jackpot distorce a média.** Spots como Crypt e Star's End dependem de um
  acessório raro. A média por hora existe, a sua hora pode ser zero.
- **A API oscila.** Categorias do mercado respondem 500 em janelas de minutos. O
  build insiste em três passadas e, se ainda faltar preço de algum item, aborta
  sem escrever — o site continua com o dado de ontem em vez de mostrar número
  errado.

## Fontes

- **Preços**: [Arsha API](https://api.arsha.io) — mercado central, ao vivo.
- **Spots e XP**: [Garmoth Grind Tracker](https://garmoth.com/grind-tracker/best-grind-spots)
  — silver/hora, EXP/hora, trash e Total Stat, medidos de sessões reais.
  Importado via `scripts/import-garmoth.js`.
- **Classes**: [BDO Class Hub](https://bdoclasshub.com/tierlist.html) para tier
  de PvE, AoE, conforto e resistência por spec (lista do expert Choice);
  [Grumpy Green](https://grumpygreen.cricket/bdo-class-guide/) para armas.
- **Receitas**: [Incendar](https://incendar.com/bdocookingrecipes.php)
  (culinária e alquimia, importadas por `scripts/import-recipes.js`) e
  [BDO Codex](https://bdocodex.com). Processing é escrito à mão.

Não há API pública de grind spots: o Garmoth tem os dados mas bloqueia acesso
programático, e Arsha/Velia Inn cobrem só o mercado. Por isso spots e classes são
tabelas mantidas à mão, com a data de atualização em `_meta` de cada arquivo.

Projeto sem fins lucrativos, não afiliado à Pearl Abyss.
