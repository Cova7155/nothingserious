// Builds public/data/dex.json: every Pokémon species (Gen 1-9), a familiarity score per species,
// the prompt pool with answer sets, and a fixed daily schedule (7 prompts a day, same for everyone).
import { Dex } from '@pkmn/dex';
import fs from 'node:fs';
import path from 'node:path';

const OUT = process.argv[2] || '/home/claude/dex/app/public/data/dex.json';
const CSV = '/home/claude/dex/build/csv';

/* ---------------- csv helpers ---------------- */
function readCsv(name) {
  const txt = fs.readFileSync(path.join(CSV, name + '.csv'), 'utf8').trim().split(/\r?\n/);
  const head = txt[0].split(',');
  return txt.slice(1).map(line => {
    const cells = []; let cur = '', q = false;
    for (const ch of line) {
      if (ch === '"') q = !q;
      else if (ch === ',' && !q) { cells.push(cur); cur = ''; }
      else cur += ch;
    }
    cells.push(cur);
    return Object.fromEntries(head.map((h, i) => [h, cells[i]]));
  });
}
const pSpecies = new Map(readCsv('pokemon_species').map(r => [+r.id, r]));
const pPokemon = new Map(readCsv('pokemon').filter(r => r.is_default === '1').map(r => [+r.species_id, r]));
const colors = Object.fromEntries(readCsv('pokemon_colors').map(r => [r.id, r.identifier]));
const genus = new Map(readCsv('pokemon_species_names').filter(r => r.local_language_id === '9').map(r => [+r.pokemon_species_id, r.genus]));

/* ---------------- species ---------------- */
const base = Dex.species.all()
  .filter(s => s.num >= 1 && s.num <= 1025 && !s.forme && s.isNonstandard !== 'CAP' && s.isNonstandard !== 'Custom')
  .sort((a, b) => a.num - b.num);
if (base.length !== 1025) throw new Error('expected 1025 species, got ' + base.length);
const byId = new Map(base.map(s => [s.id, s]));
const byName = new Map(base.map(s => [s.name, s]));

const ICON = `pikachu charizard eevee mewtwo mew bulbasaur charmander squirtle jigglypuff snorlax gengar lucario greninja magikarp gyarados psyduck meowth ditto dragonite blastoise venusaur lugia rayquaza mimikyu togepi umbreon sylveon arcanine gardevoir machamp alakazam lapras raichu hooh garchomp onix slowpoke cubone vaporeon jolteon flareon espeon piplup pichu blaziken`;
const STAR = `butterfree pidgey pidgeot rattata caterpie zubat geodude vulpix ninetales growlithe scyther aerodactyl articuno zapdos moltres dratini clefairy abra kadabra machop gastly haunter koffing weezing ekans arbok sandshrew diglett ponyta rapidash magnemite voltorb electrode exeggutor hitmonlee hitmonchan lickitung chansey kangaskhan staryu starmie mrmime jynx electabuzz magmar pinsir tauros porygon omanyte kabuto nidoking nidoqueen poliwag poliwhirl poliwrath bellsprout tentacool tentacruel golem graveler seel dewgong grimer muk shellder cloyster drowzee hypno krabby kingler rhydon rhyhorn horsea goldeen seaking oddish gloom vileplume paras venonat mankey primeape farfetchd doduo dodrio marowak tangela kabutops omastar dragonair wigglytuff clefable persian golduck slowbro ivysaur charmeleon wartortle metapod kakuna weedle beedrill pidgeotto spearow fearow raticate nidorina nidorino nidoranf nidoranm sandslash parasect venomoth dugtrio machoke weepinbell victreebel magneton exeggcute seadra hitmontop
leafeon glaceon tyranitar scizor heracross steelix wobbuffet togekiss absol metagross salamence milotic darkrai arceus dialga palkia giratina kyogre groudon celebi jirachi suicune entei raikou latias latios zoroark chikorita cyndaquil totodile treecko torchic mudkip turtwig chimchar infernape snivy tepig oshawott fennekin froakie rowlet litten popplio incineroar decidueye grookey scorbunny sobble sprigatito fuecoco quaxly typhlosion feraligatr sceptile swampert empoleon torterra bidoof marill azumarill ampharos crobat riolu shinx luxray gallade wooper sudowoodo unown togetic mareep larvitar murkrow weavile skarmory kingdra politoed mamoswine ralts kirlia aggron wailord sableye flygon altaria zangoose spinda feebas kecleon snorunt froslass bagon beldum deoxys gible munchlax spiritomb rotom drifloon lopunny pachirisu croagunk magnezone electivire rhyperior porygonz porygon2 reshiram zekrom kyurem victini hydreigon haxorus chandelure volcarona zorua xerneas yveltal zygarde aegislash goodra noivern solgaleo lunala necrozma lycanroc rockruff wishiwashi zacian zamazenta eternatus corviknight dragapult wooloo koraidon miraidon tinkaton lechonk gholdengo tapukoko marshadow zeraora cosmog dedenne`;
const STAR_HI = `butterfree pidgey pidgeot rattata caterpie zubat geodude vulpix ninetales growlithe scyther aerodactyl articuno zapdos moltres dratini clefairy abra gastly haunter koffing weezing ekans arbok sandshrew diglett ponyta magnemite voltorb electrode chansey staryu starmie mrmime jynx electabuzz magmar tauros porygon nidoking hitmonlee hitmonchan lickitung exeggutor kangaskhan muk grimer tentacool golem weedle beedrill metapod kakuna charmeleon ivysaur wartortle kabuto omanyte machop kadabra poliwag horsea goldeen krabby
tyranitar scizor darkrai kyogre groudon dialga palkia giratina arceus reshiram zekrom suicune entei raikou celebi jirachi latias latios absol metagross salamence togekiss zoroark infernape sceptile swampert typhlosion feraligatr empoleon torterra mudkip torchic treecko chikorita cyndaquil totodile turtwig chimchar wobbuffet steelix heracross leafeon glaceon zacian dragapult corviknight marill riolu deoxys`;
const KNOWN = `chespin primarina cinderace meganium houndoom quagsire smeargle miltank sneasel misdreavus donphan slowking bellossom delibird mawile seviper breloom slaking castform banette duskull dusknoir regirock regice registeel magmortar talonflame pancham trubbish emolga joltik litwick axew deino larvesta golett pawniard bisharp hawlucha yamper pawmi magearna meltan melmetal
furret noctowl xatu aipom dunsparce gligar snubbull shuckle teddiursa ursaring swinub corsola houndour phanpy blissey elekid magby cleffa igglybuff hoothoot sentret qwilfish octillery mantine stantler lanturn
zigzagoon wurmple beautifly lotad ludicolo seedot shiftry taillow swellow wingull pelipper shroomish slakoth shedinja whismur exploud azurill skitty aron manectric plusle minun roselia carvanha sharpedo wailmer torkoal spoink trapinch cacnea lunatone solrock corphish shuppet dusclops tropius spheal walrein luvdisc relicanth
starly staraptor bibarel luxio budew roserade cranidos combee vespiquen buizel floatzel drifblim buneary mismagius honchkrow glameow stunky bronzong bonsly mimejr happiny chatot hippowdon toxicroak snover abomasnow yanmega gliscor uxie mesprit azelf heatran regigigas cresselia manaphy shaymin
patrat lillipup purrloin pidove woobat drilbur excadrill audino timburr conkeldurr sandile krookodile darumaka darmanitan scraggy yamask cofagrigus minccino reuniclus vanillite vanilluxe deerling sawsbuck foongus amoonguss frillish jellicent ferrothorn klink eelektross cubchoo braviary cobalion terrakion virizion tornadus thundurus landorus meloetta genesect keldeo
bunnelby fletchling vivillon litleo pyroar flabebe florges skiddo gogoat pangoro furfrou espurr meowstic honedge spritzee swirlix inkay malamar tyrunt tyrantrum amaura sylveon carbink klefki goomy bergmite avalugg phantump trevenant pumpkaboo gourgeist diancie hoopa volcanion
pikipek toucannon yungoos grubbin vikavolt crabrawler oricorio cutiefly ribombee mudbray mudsdale fomantis salandit salazzle stufful bewear bounsweet tsareena comfey wimpod golisopod sandygast pyukumuku typenull silvally minior komala togedemaru jangmoo kommoo tapulele tapubulu tapufini nihilego buzzwole pheromosa kartana poipole toxapex
skwovet greedent rookidee nickit gossifleur dubwool chewtle drednaw boltund rolycoly applin flapple appletun silicobra cramorant toxel toxtricity sinistea polteageist hatenna hatterene impidimp grimmsnarl obstagoon sirfetchd mrrime milcery alcremie snom frosmoth eiscue indeedee morpeko duraludon dreepy kubfu urshifu zarude calyrex glastrier spectrier regieleki regidrago wyrdeer kleavor ursaluna sneasler enamorus
pawmot tandemaus maushold fidough smoliv nacli garganacl charcadet armarouge ceruledge wattrel shroodle bramblin capsakid tinkatink wiglett finizen palafin cyclizar greavard houndstone flamigo cetitan dondozo tatsugiri annihilape clodsire farigiraf kingambit frigibax baxcalibur gimmighoul greattusk fluttermane ironvaliant roaringmoon wochien chienpao tinglu chiyu ogerpon terapagos pecharunt`;
const STARTERS = `bulbasaur ivysaur venusaur charmander charmeleon charizard squirtle wartortle blastoise chikorita bayleef meganium cyndaquil quilava typhlosion totodile croconaw feraligatr treecko grovyle sceptile torchic combusken blaziken mudkip marshtomp swampert turtwig grotle torterra chimchar monferno infernape piplup prinplup empoleon snivy servine serperior tepig pignite emboar oshawott dewott samurott chespin quilladin chesnaught fennekin braixen delphox froakie frogadier greninja rowlet dartrix decidueye litten torracat incineroar popplio brionne primarina grookey thwackey rillaboom scorbunny raboot cinderace sobble drizzile inteleon sprigatito floragato meowscarada fuecoco crocalor skeledirge quaxly quaxwell quaquaval`;
const PSEUDO = `dratini dragonair dragonite larvitar pupitar tyranitar bagon shelgon salamence beldum metang metagross gible gabite garchomp deino zweilous hydreigon goomy sliggoo goodra jangmoo hakamoo kommoo dreepy drakloak dragapult frigibax arctibax baxcalibur`;
const EEVEE = `eevee vaporeon jolteon flareon espeon umbreon leafeon glaceon sylveon`;
const list = s => s.split(/\s+/).filter(Boolean);
const check = (label, arr) => { const bad = arr.filter(x => !byId.has(x)); if (bad.length) throw new Error(label + ' unknown ids: ' + bad.join(', ')); return new Set(arr); };
const sIcon = check('ICON', list(ICON)), sStar = check('STAR', list(STAR)), sKnown = check('KNOWN', list(KNOWN)), sStarHi = check('STAR_HI', list(STAR_HI));
const sStart = check('STARTERS', list(STARTERS)), sPseudo = check('PSEUDO', list(PSEUDO)), sEevee = check('EEVEE', list(EEVEE));

const GEN_BASE = { 1: 80, 2: 56, 3: 52, 4: 50, 5: 40, 6: 42, 7: 41, 8: 40, 9: 41 };
const hash = s => { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967295; };

function stageOf(s) { let n = 1, cur = s; while (cur.prevo) { cur = byName.get(cur.prevo) || Dex.species.get(cur.prevo); n++; if (n > 4) break; } return n; }
const STONES = new Set(['Fire Stone', 'Water Stone', 'Thunder Stone', 'Leaf Stone', 'Moon Stone', 'Sun Stone', 'Shiny Stone', 'Dusk Stone', 'Dawn Stone', 'Ice Stone']);

const species = base.map(s => {
  const ps = pSpecies.get(s.num), pp = pPokemon.get(s.num);
  const evos = (s.evos || []).map(n => Dex.species.get(n)).filter(e => e && e.num <= 1025 && !e.forme);
  const stage = stageOf(s);
  const hasLine = !!(s.prevo || evos.length);
  const tags = s.tags || [];
  const forms = new Set();
  for (const f of s.otherFormes || []) {
    if (/-Mega/.test(f)) forms.add('mega');
    if (/-Gmax/.test(f)) forms.add('gmax');
    if (/-Alola/.test(f)) forms.add('alola');
    if (/-Galar/.test(f)) forms.add('galar');
    if (/-Hisui/.test(f)) forms.add('hisui');
    if (/-Paldea/.test(f)) forms.add('paldea');
  }
  const baby = ps && ps.is_baby === '1';
  // familiarity: how likely an average fan is to say this name (0-100)
  let fam = GEN_BASE[s.gen];
  if (sStart.has(s.id)) fam += stage === 2 ? 14 : 20;
  if (tags.includes('Restricted Legendary')) fam += 24;
  else if (tags.includes('Mythical')) fam += 12;
  else if (tags.includes('Sub-Legendary')) fam += 8;
  if (tags.includes('Paradox')) fam -= 2;
  if (sPseudo.has(s.id)) fam += evos.length ? 8 : 18;
  if (sEevee.has(s.id)) fam += 26;
  if (hasLine) fam += evos.length ? (stage === 1 ? 2 : -3) : 4; else fam -= 2;
  if (baby) fam -= 6;
  if (sKnown.has(s.id)) fam += 12;
  if (sStar.has(s.id)) fam = Math.max(fam, 86 + hash(s.id) * 4);
  if (sStarHi.has(s.id)) fam = Math.max(fam, 91 + hash(s.id) * 3.5);
  if (sIcon.has(s.id)) fam = Math.max(fam, 96 + hash(s.id) * 4);
  fam += (hash(s.id + 'j') - .5) * 3;
  fam = Math.max(1, Math.min(100, fam));
  const g = ((genus.get(s.num) || '').replace(/\s*Pokémon$/, '')).trim();
  const gr = s.genderRatio || {}, gd = s.gender || '';
  return {
    n: s.name, id: s.id, d: s.num, t: s.types, g: s.gen,
    s: [s.baseStats.hp, s.baseStats.atk, s.baseStats.def, s.baseStats.spa, s.baseStats.spd, s.baseStats.spe],
    b: s.bst,
    a: [...new Set(Object.values(s.abilities))],
    h: pp ? +pp.height / 10 : null, w: s.weightkg,
    c: ps ? colors[ps.color_id] : null,
    eg: s.eggGroups,
    st: stage, ev: evos.length ? 1 : 0, ln: hasLine ? 1 : 0,
    pre: s.prevo ? Dex.species.get(s.prevo).num : 0,
    eto: evos.map(e => ({ d: e.num, ty: e.evoType || 'level', it: e.evoItem || '', lv: e.evoLevel || 0 })),
    ety: s.evoType || (s.prevo ? 'level' : ''), eit: s.evoItem || '', elv: s.evoLevel || 0,
    tg: tags.includes('Restricted Legendary') ? 'R' : tags.includes('Sub-Legendary') ? 'L' : tags.includes('Mythical') ? 'M' : tags.includes('Ultra Beast') ? 'U' : tags.includes('Paradox') ? 'P' : '',
    gd, bb: baby ? 1 : 0, cat: g, fm: [...forms], st0: sStart.has(s.id) ? 1 : 0,
    f: Math.round(fam * 10) / 10
  };
});
const idx = new Map(species.map((p, i) => [p.d, i]));

/* ---------------- type chart ---------------- */
const TYPES = Dex.types.all().map(t => t.name).filter(t => t !== 'Stellar');
const taken = Object.fromEntries(TYPES.map(t => [t, Dex.types.get(t).damageTaken]));
const mult = (atk, defTypes) => defTypes.reduce((m, d) => { const v = taken[d][atk]; return m * (v === 1 ? 2 : v === 2 ? .5 : v === 3 ? 0 : 1); }, 1);

/* ---------------- prompt pool ---------------- */
const pool = [];
const REG = { 1: 'Kanto', 2: 'Johto', 3: 'Hoenn', 4: 'Sinnoh', 5: 'Unova', 6: 'Kalos', 7: 'Alola', 8: 'Galar & Hisui', 9: 'Paldea' };
function add(group, kind, lead, key, tail, pred, opts = {}) {
  const ans = species.map((p, i) => pred(p) ? i : -1).filter(i => i >= 0);
  const min = opts.min ?? 8, max = opts.max ?? 400;
  if (ans.length < min || ans.length > max) return;
  pool.push({ k: kind, gp: group, lead, key, tail, a: ans });
}
const letters = p => p.n.normalize('NFD').replace(/[^A-Za-z]/g, '');
const an = w => (/^[AEIOU]/i.test(w) ? 'an' : 'a');

// type
for (const T of TYPES) add('type', 'type:' + T, `Name ${an(T)}`, `${T}-type`, 'Pokémon', p => p.t.includes(T));
for (let i = 0; i < TYPES.length; i++) for (let j = i + 1; j < TYPES.length; j++) {
  const A = TYPES[i], B = TYPES[j];
  add('type', `dual:${A}/${B}`, `Name ${an(A)}`, `${A} / ${B}`, 'Pokémon (either order)', p => p.t.length === 2 && p.t.includes(A) && p.t.includes(B), { min: 7, max: 60 });
}
for (const T of TYPES) {
  add('type', '4x:' + T, 'Name a Pokémon that takes', `4× damage from ${T}`, 'moves (by type)', p => mult(T, p.t) === 4, { min: 7 });
  add('type', 'imm:' + T, 'Name a Pokémon', `immune to ${T}`, 'moves (by type alone)', p => mult(T, p.t) === 0, { min: 10 });
}
add('type', 'mono', 'Name a', 'single-type', 'Pokémon (just one type)', p => p.t.length === 1, { max: 600 });
add('type', 'pure:Normal', 'Name a', 'pure Normal-type', 'Pokémon', p => p.t.length === 1 && p.t[0] === 'Normal');
add('type', 'pure:Water', 'Name a', 'pure Water-type', 'Pokémon', p => p.t.length === 1 && p.t[0] === 'Water');
add('type', 'pure:Psychic', 'Name a', 'pure Psychic-type', 'Pokémon', p => p.t.length === 1 && p.t[0] === 'Psychic');

// region
for (let g = 1; g <= 9; g++) add('region', 'gen:' + g, 'Name a Pokémon from', `Gen ${g}`, REG[g], p => p.g === g, { max: 200 });
for (let g = 1; g <= 9; g++) for (const T of TYPES) add('region', `gentype:${g}:${T}`, `Name ${an(T)}`, `${T}-type`, `from Gen ${g} · ${REG[g]}`, p => p.g === g && p.t.includes(T), { min: 7 });

// names
for (const L of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') add('name', 'letter:' + L, 'Name a Pokémon starting with', L, '', p => letters(p).toUpperCase().startsWith(L), { min: 6 });
for (const L of 'AEINORSTXK') add('name', 'ends:' + L, 'Name a Pokémon whose name ends in', L.toLowerCase(), '', p => letters(p).toLowerCase().endsWith(L.toLowerCase()), { min: 8, max: 250 });
add('name', 'len:4', 'Name a Pokémon with', 'a 4-letter name', '', p => letters(p).length === 4, { min: 6 });
add('name', 'len:5', 'Name a Pokémon with', 'a 5-letter name', '', p => letters(p).length === 5);
add('name', 'len:11', 'Name a Pokémon with', 'an 11+ letter name', '', p => letters(p).length >= 11);
add('name', 'double', 'Name a Pokémon with', 'a double letter', 'in its name (like the “zz” in Fizz)', p => /(.)\1/i.test(letters(p)), { max: 300 });
add('name', 'space', 'Name a Pokémon with', 'two words', 'in its name', p => /\s/.test(p.n), { min: 8 });
add('name', 'hyphen', 'Name a Pokémon with', 'a hyphen or punctuation', 'in its name', p => /[-.’':]/.test(p.n), { min: 8 });
const genusWords = {};
for (const p of species) for (const w of p.cat.split(/\s+/)) genusWords[w] = (genusWords[w] || 0) + 1;
const GENUS_KEYS = ['Mouse', 'Fox', 'Bird', 'Fish', 'Cat', 'Puppy', 'Turtle', 'Snake', 'Bat', 'Seed', 'Fairy', 'Dragon', 'Bug', 'Rock', 'Flame', 'Penguin', 'Owl', 'Duck', 'Frog', 'Monkey', 'Spider', 'Ghost', 'Mushroom', 'Bubble', 'Balloon', 'Lizard', 'Shellfish', 'Ninja', 'Poison', 'Bee', 'Jellyfish', 'Crab', 'Bull', 'Pig', 'Sheep', 'Dog', 'Pebble'];
for (const w of GENUS_KEYS) add('name', 'cat:' + w, `Name ${an(w)}`, `“${w}” Pokémon`, 'by its Pokédex category', p => p.cat.split(/\s+/).includes(w), { min: 4 });

// stats
const ST = ['HP', 'Attack', 'Defense', 'Sp. Atk', 'Sp. Def', 'Speed'];
const stat = [[0, 100, 'HP'], [0, 120, 'HP'], [1, 120, 'Attack'], [1, 130, 'Attack'], [2, 120, 'Defense'], [3, 120, 'Sp. Atk'], [4, 110, 'Sp. Def'], [5, 100, 'Speed'], [5, 115, 'Speed']];
for (const [i, v, label] of stat) add('stats', `stat:${i}:${v}`, 'Name a Pokémon with', `${v}+ base ${label}`, '', p => p.s[i] >= v);
add('stats', 'stat:1:140', 'Name a Pokémon with', '140+ base Attack', '', p => p.s[1] >= 140);
add('stats', 'stat:3:130', 'Name a Pokémon with', '130+ base Sp. Atk', '', p => p.s[3] >= 130);
add('stats', 'stat:5:120', 'Name a Pokémon with', '120+ base Speed', '', p => p.s[5] >= 120);
add('stats', 'stat:2:140', 'Name a Pokémon with', '140+ base Defense', '', p => p.s[2] >= 140);
add('stats', 'stat:0:130', 'Name a Pokémon with', '130+ base HP', '', p => p.s[0] >= 130, { min: 8 });
add('stats', 'bst:670', 'Name a Pokémon with', 'a base stat total of 670+', '', p => p.b >= 670, { min: 8 });
add('stats', 'max:150', 'Name a Pokémon with', 'any base stat of 150+', '', p => Math.max(...p.s) >= 150);
add('stats', 'min:70', 'Name a Pokémon with', 'every base stat 70 or higher', '', p => Math.min(...p.s) >= 70, { max: 300 });
add('stats', 'spe:100', 'Name a Pokémon with', 'base Speed of exactly 100', '', p => p.s[5] === 100);
add('stats', 'atk:100', 'Name a Pokémon with', 'base Attack of exactly 100', '', p => p.s[1] === 100);
add('stats', 'hp:low1', 'Name a Pokémon with', 'base HP of 30 or less', '', p => p.s[0] <= 30, { min: 8 });
add('stats', 'stat:5:low', 'Name a Pokémon with', 'base Speed of 30 or less', '', p => p.s[5] <= 30);
add('stats', 'stat:0:low', 'Name a Pokémon with', 'base HP of 40 or less', '', p => p.s[0] <= 40);
add('stats', 'bst:600', 'Name a Pokémon with', 'a base stat total of exactly 600', '', p => p.b === 600, { min: 8 });
add('stats', 'bst:hi', 'Name a Pokémon with', 'a base stat total of 600+', '', p => p.b >= 600);
add('stats', 'bst:lo', 'Name a Pokémon with', 'a base stat total under 300', '', p => p.b < 300);
add('stats', 'bst:500', 'Name a Pokémon with', 'a base stat total of 500–549', '', p => p.b >= 500 && p.b < 550, { max: 200 });
for (let i = 0; i < 6; i++) add('stats', 'top:' + i, 'Name a Pokémon whose', `highest stat is ${ST[i]}`, '(no ties)', p => { const m = Math.max(...p.s); return p.s[i] === m && p.s.filter(x => x === m).length === 1; }, { max: 300 });
add('stats', 'atkspa', 'Name a Pokémon with', 'higher Sp. Atk than Attack', 'by 50 or more', p => p.s[3] - p.s[1] >= 50);
add('stats', 'defspd', 'Name a Pokémon with', 'Defense of 130+', 'and Speed under 50', p => p.s[2] >= 130 && p.s[5] < 50, { min: 8 });

// body
add('body', 'tall:2', 'Name a Pokémon', 'taller than 2 m', '(6′7″)', p => p.h > 2);
add('body', 'short:0.3', 'Name a Pokémon', '30 cm tall or less', '(about 1 ft)', p => p.h !== null && p.h <= .3);
add('body', 'heavy:200', 'Name a Pokémon', 'heavier than 200 kg', '(441 lb)', p => p.w > 200);
add('body', 'light:1', 'Name a Pokémon', 'lighter than 1 kg', '(2.2 lb)', p => p.w < 1);
add('body', 'heavy:500', 'Name a Pokémon', 'heavier than 500 kg', '(1,102 lb)', p => p.w > 500, { min: 6 });
add('body', 'tall:1.5', 'Name a Pokémon', 'taller than 1.5 m', '(4′11″)', p => p.h > 1.5, { max: 260 });
add('body', 'tall:3', 'Name a Pokémon', 'taller than 3 m', '(9′10″)', p => p.h > 3, { min: 8 });
add('body', 'short:0.5', 'Name a Pokémon', '50 cm tall or less', '(1′8″)', p => p.h !== null && p.h <= .5, { max: 300 });
add('body', 'heavy:100', 'Name a Pokémon', 'heavier than 100 kg', '(220 lb)', p => p.w > 100, { max: 300 });
add('body', 'light:5', 'Name a Pokémon', 'lighter than 5 kg', '(11 lb)', p => p.w < 5, { max: 300 });
add('body', 'tall:light', 'Name a Pokémon', 'taller than 1.5 m but under 50 kg', '(tall and light)', p => p.h > 1.5 && p.w < 50, { min: 8 });
add('body', 'short:heavy', 'Name a Pokémon', 'under 1 m tall but over 100 kg', '(short and heavy)', p => p.h !== null && p.h < 1 && p.w > 100, { min: 8 });
for (const c of ['black', 'blue', 'brown', 'gray', 'green', 'pink', 'purple', 'red', 'white', 'yellow']) for (const T of TYPES) add('body', `ctype:${c}:${T}`, `Name a`, `${c} ${T}-type`, 'Pokémon (its main color)', p => p.c === c && p.t.includes(T), { min: 8, max: 70 });
for (const c of ['black', 'blue', 'brown', 'gray', 'green', 'pink', 'purple', 'red', 'white', 'yellow']) add('body', 'color:' + c, `Name a`, `${c}`, 'Pokémon (its main color)', p => p.c === c, { max: 200 });

// evolution
const ansOf = s => idx.get(s);
add('evo', 'evo:stone', 'Name a Pokémon that', 'evolves with a stone', '(any evolution stone)', p => p.eto.some(e => STONES.has(e.it)));
add('evo', 'evo:trade', 'Name a Pokémon that', 'evolves by trading', '', p => p.eto.some(e => e.ty === 'trade'), { min: 8 });
add('evo', 'evo:friend', 'Name a Pokémon that', 'evolves through friendship', '', p => p.eto.some(e => e.ty === 'levelFriendship'), { min: 8 });
add('evo', 'evo:none', 'Name a Pokémon that', 'doesn’t evolve at all', '(no pre-evolution either)', p => !p.ln, { max: 500 });
add('evo', 'evo:stage3', 'Name a Pokémon that’s', 'the final stage', 'of a three-stage line', p => p.st === 3 && !p.ev);
add('evo', 'evo:baby', 'Name a', 'baby Pokémon', '', p => p.bb === 1, { min: 8 });
add('evo', 'evo:branch', 'Name a Pokémon that', 'can evolve into two different Pokémon', '', p => p.eto.length >= 2, { min: 8 });
add('evo', 'evo:base3', 'Name the', 'first stage', 'of a three-stage evolution line', p => p.st === 1 && p.eto.some(e => species[idx.get(e.d)] && species[idx.get(e.d)].ev === 1));
add('evo', 'evo:item', 'Name a Pokémon that', 'evolves with a special item', '(not a stone: Metal Coat, King’s Rock…)', p => p.eto.some(e => e.it && !STONES.has(e.it)), { min: 8 });
add('evo', 'evo:lv40', 'Name a Pokémon that', 'evolves at level 40 or higher', '', p => p.eto.some(e => e.ty === 'level' && e.lv >= 40), { min: 8 });
add('evo', 'evo:full2', 'Name the', 'final form', 'of a two-stage line', p => p.st === 2 && !p.ev && !!p.pre, { max: 300 });
for (const stn of ['Fire Stone', 'Water Stone', 'Thunder Stone', 'Leaf Stone', 'Moon Stone', 'Sun Stone', 'Dusk Stone', 'Shiny Stone']) add('evo', 'stone:' + stn, 'Name a Pokémon that evolves with', `a ${stn}`, '', p => p.eto.some(e => e.it === stn), { min: 4 });
add('evo', 'evo:typechange', 'Name a Pokémon whose', 'type changes', 'when it evolves', p => p.eto.some(e => { const t = species[idx.get(e.d)].t; return t.length !== p.t.length || t.some(x => !p.t.includes(x)); }), { max: 300 });
add('evo', 'evo:gaintype', 'Name a Pokémon that', 'gains a second type', 'when it evolves', p => p.t.length === 1 && p.eto.some(e => species[idx.get(e.d)].t.length === 2));
add('evo', 'evo:legline', 'Name a Legendary or Mythical', 'that evolves', 'or has a pre-evolution', p => !!p.tg && 'RLM'.includes(p.tg) && (!!p.pre || p.ev === 1), { min: 6 });
add('evo', 'evo:16', 'Name a Pokémon that', 'evolves at level 16', '', p => p.eto.some(e => e.ty === 'level' && e.lv === 16));
add('evo', 'evo:mid', 'Name a', 'middle-stage', 'Pokémon (evolves from AND into something)', p => !!p.pre && p.ev === 1);
for (const T of ['Fire', 'Water', 'Grass']) add('evo', 'starter:' + T, `Name ${an(T)}`, `${T} starter`, '(any stage)', p => p.st0 === 1 && p.t.includes(T));
add('evo', 'starter', 'Name a', 'starter Pokémon', '(any stage, any gen)', p => p.st0 === 1);
add('evo', 'form:mega', 'Name a Pokémon that has', 'a Mega Evolution', '', p => p.fm.includes('mega'));
add('evo', 'form:gmax', 'Name a Pokémon with', 'a Gigantamax form', '', p => p.fm.includes('gmax'));
add('evo', 'form:alola', 'Name a Pokémon with', 'an Alolan form', '', p => p.fm.includes('alola'));
add('evo', 'form:galar', 'Name a Pokémon with', 'a Galarian form', '', p => p.fm.includes('galar'));
add('evo', 'form:hisui', 'Name a Pokémon with', 'a Hisuian form', '', p => p.fm.includes('hisui'));
add('evo', 'form:regional', 'Name a Pokémon with', 'any regional form', '(Alola, Galar, Hisui or Paldea)', p => p.fm.some(f => ['alola', 'galar', 'hisui', 'paldea'].includes(f)));

// lore
add('lore', 'leg', 'Name a', 'Legendary', 'Pokémon (not Mythical)', p => p.tg === 'R' || p.tg === 'L');
add('lore', 'leg:box', 'Name a', 'box-art Legendary', '(the restricted big ones)', p => p.tg === 'R');
add('lore', 'myth', 'Name a', 'Mythical', 'Pokémon', p => p.tg === 'M');
add('lore', 'ub', 'Name an', 'Ultra Beast', '', p => p.tg === 'U', { min: 6 });
add('lore', 'paradox', 'Name a', 'Paradox', 'Pokémon', p => p.tg === 'P');
add('lore', 'gd:N', 'Name a', 'genderless', 'Pokémon', p => p.gd === 'N');
add('lore', 'gd:F', 'Name a Pokémon that’s', 'always female', '', p => p.gd === 'F');
add('lore', 'gd:M', 'Name a Pokémon that’s', 'always male', '', p => p.gd === 'M', { min: 6 });
add('lore', 'dex:100', 'Name a Pokémon whose Pokédex number is', 'a multiple of 100', '(#100, #200…)', p => p.d % 100 === 0, { min: 6 });
add('lore', 'dex:rep', 'Name a Pokémon whose Pokédex number is', 'one digit repeated', '(#111, #222…)', p => p.d >= 100 && p.d < 1000 && /^(\d)\1\1$/.test(String(p.d)), { min: 6 });
add('lore', 'dex:50', 'Name a Pokémon with', 'a Pokédex number under 50', '', p => p.d < 50);
add('lore', 'dex:1000', 'Name a Pokémon with', 'a 4-digit Pokédex number', '(#1000+)', p => p.d >= 1000, { min: 6 });
for (const e of ['Dragon', 'Fairy', 'Monster', 'Amorphous', 'Mineral', 'Undiscovered']) add('lore', 'egg:' + e, 'Name a Pokémon in the', `${e} Egg Group`, '', p => p.eg.includes(e));
const ABIL = ['Levitate', 'Intimidate', 'Swift Swim', 'Chlorophyll', 'Sturdy', 'Static', 'Flash Fire', 'Pressure', 'Synchronize', 'Keen Eye', 'Thick Fat', 'Run Away', 'Water Absorb', 'Rock Head', 'Guts', 'Cursed Body', 'Technician', 'Sheer Force', 'Adaptability', 'Regenerator', 'Prankster', 'Moxie', 'Justified', 'Frisk', 'Pickup', 'Cute Charm', 'Natural Cure', 'Clear Body', 'Iron Fist', 'Inner Focus', 'Shell Armor', 'Insomnia', 'Serene Grace', 'Sniper', 'Hustle', 'Poison Point', 'Shed Skin', 'Oblivious', 'Own Tempo', 'Sand Veil', 'Swarm', 'Infiltrator', 'Unaware', 'Magic Guard', 'Huge Power'];
for (const ab of ABIL) add('lore', 'ab:' + ab, 'Name a Pokémon that can have', ab, 'as an ability', p => p.a.includes(ab), { min: 8, max: 90 });

/* ---------------- difficulty ---------------- */
for (const q of pool) q.df = q.a.length >= 60 ? 1 : q.a.length >= 20 ? 2 : 3;
pool.forEach((q, i) => (q.i = i));

/* ---------------- daily schedule ---------------- */
// one prompt per group per day, never repeating a prompt within ~two months
const GROUPS = ['type', 'region', 'name', 'stats', 'body', 'evo', 'lore'];
const byGroup = Object.fromEntries(GROUPS.map(g => [g, pool.filter(q => q.gp === g)]));
function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const DAYS = 1500, lastUsed = new Map(), days = [];
const r = rng(0x60D9AC);
for (let d = 1; d <= DAYS; d++) {
  const pick = [];
  let hard = 0;
  for (const g of GROUPS) {
    const cand = byGroup[g];
    const win = Math.min(70, Math.floor(cand.length * .8));
    let best = null, bestScore = -1;
    for (let tries = 0; tries < 40; tries++) {
      const q = cand[Math.floor(r() * cand.length)];
      const since = d - (lastUsed.get(q.i) ?? -9999);
      if (since <= win) continue;
      if (q.df === 3 && hard >= 2) continue;
      // keep region prompts from leaning on the same gen too often, prefer accessible prompts a bit
      const s = since + (q.df === 1 ? 6 : q.df === 2 ? 4 : 0) + r() * 10;
      if (s > bestScore) { best = q; bestScore = s; }
    }
    if (!best) best = cand.reduce((a, b) => ((lastUsed.get(a.i) ?? -9999) < (lastUsed.get(b.i) ?? -9999) ? a : b));
    if (best.df === 3) hard++;
    lastUsed.set(best.i, d); pick.push(best.i);
  }
  // shuffle order within the day, but keep an easy prompt first
  for (let i = pick.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [pick[i], pick[j]] = [pick[j], pick[i]]; }
  const ei = pick.findIndex(i => pool[i].df === 1);
  if (ei > 0) [pick[0], pick[ei]] = [pick[ei], pick[0]];
  days.push(pick);
}

/* ---------------- output ---------------- */
function evoNote(p) {
  const e = p.eto[0]; if (!e) return '';
  const into = species[idx.get(e.d)].n;
  if (e.it) return `Evolves into ${into} with ${/^[AEIOU]/.test(e.it) ? 'an' : 'a'} ${e.it}`;
  if (e.ty === 'trade') return `Evolves into ${into} by trade`;
  if (e.ty === 'levelFriendship') return `Evolves into ${into} with friendship`;
  if (e.lv) return `Evolves into ${into} at level ${e.lv}`;
  return `Evolves into ${into}`;
}
const out = {
  v: 1,
  epoch: '2026-11-04',
  types: TYPES,
  taken: Object.fromEntries(TYPES.map(t => [t, TYPES.map(a => taken[t][a])])),
  species: species.map(p => ({ n: p.n, id: p.id, d: p.d, t: p.t, g: p.g, s: p.s, b: p.b, a: p.a, h: p.h, w: p.w, c: p.c, eg: p.eg, st: p.st, ev: p.ev, ln: p.ln, tg: p.tg, gd: p.gd, cat: p.cat, f: p.f, em: evoNote(p) })),
  pool: pool.map(q => ({ k: q.k, gp: q.gp, lead: q.lead, key: q.key, tail: q.tail, df: q.df, a: q.a })),
  days
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out));
const sizes = {}; for (const q of pool) sizes[q.gp] = (sizes[q.gp] || 0) + 1;
console.log('species', species.length, 'pool', pool.length, sizes, 'days', days.length, 'bytes', fs.statSync(OUT).size);
console.log('genus words with 4+:', Object.entries(genusWords).filter(([, n]) => n >= 4).sort((a, b) => b[1] - a[1]).slice(0, 60).map(([w, n]) => w + ':' + n).join(' '));
