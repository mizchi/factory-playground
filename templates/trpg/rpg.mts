// Scenario-specific values are authored once. Outcomes can be replayed from public actions.
export type Module = "hp" | "items" | "dungeon";
export type Rules = {
  obstacle: string;
  hp?: { max: number; damage: number; wound: string };
  item?: { name: string; uses: number };
  rooms?: string[];
};
export type State = { hp?: number[]; stock?: number; positions?: number[] };
type Move = { code: string; label: string; to?: number; damage?: number; uses?: number };
export function modules(value: unknown): Module[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some(x => !["hp","items","dungeon"].includes(x)) || new Set(value).size !== value.length)
    throw new Error("mechanics には hp, items, dungeon を重複なく指定してください");
  return value;
}

export function design(active: Module[], scenes: number) {
  const fields: Record<string,string> = {};
  if (!active.length) return fields;
  fields.obstacle = "繰り返し立ちはだかる障害の短い名称（例「潮門の逆流」）。数値や解決手順は含めず、全欄を公開情報にする";
  if (active.includes("hp")) Object.assign(fields,{maxHp:"全員が同じ値で開始する。2〜6の半角数字1文字だけ（例 3）。名前・単位を付けない",damage:"全員共通の消費HP。1〜初期HPの半角数字1文字だけ（例 1）",wound:"HPが0になったPCが負う具体的な負傷"});
  if (active.includes("items")) Object.assign(fields,{item:"障害を一度突破できる消耗品の名前",stock:"全員で共有する使用回数、1〜3の整数のみ"});
  if (active.includes("dungeon")) {
    const count = scenes === 2 ? 3 : 4;
    for (let i=1;i<=count;i++) fields[`room${i}`] = `異なる場所の名前。第1地点は入口、第${count}地点は目的地。順路のほか入口と目的地の間には障害のある近道がある`;
  }
  return fields;
}

export function rulesFrom(s: Record<string,string>, active: Module[], scenes: number): Rules | undefined {
  if (!active.length) return;
  const fields = design(active,scenes);
  for (const k of Object.keys(fields)) if (!s[k]?.trim()) throw new Error("RPG設定がありません: "+k);
  const number = (key:string,max:number) => {
    const n=Number(s[key]);
    if (!Number.isInteger(n) || n < 1 || n > max) throw new Error("RPG設定の数値が範囲外です: "+key);
    return n;
  };
  const rules: Rules = {obstacle:s.obstacle};
  if (active.includes("hp")) {
    const max=number("maxHp",6);
    if (max<2) throw new Error("初期HPは2以上です");
    rules.hp={max,damage:number("damage",max),wound:s.wound};
  }
  if (active.includes("items")) rules.item={name:s.item,uses:number("stock",3)};
  if (active.includes("dungeon")) {
    rules.rooms=Object.keys(fields).filter(k=>k.startsWith("room")).map(k=>s[k].trim());
    if(new Set(rules.rooms).size!==rules.rooms.length) throw new Error("地点名が重複しています");
  }
  return rules;
}

export function initial(r:Rules,seats:number):State {
  return { ...(r.hp && {hp:Array<number>(seats).fill(r.hp.max)}), ...(r.item && {stock:r.item.uses}),
    ...(r.rooms && {positions:Array<number>(seats).fill(0)}) };
}

export function choices(r:Rules,state:State,seat:number):Move[] {
  const moves:Move[]=[{code:"stay",label:"ここで行動する（移動・突破なし）"}];
  let destination:number|undefined;
  if (r.rooms && state.positions) {
    const here=state.positions[seat], last=r.rooms.length-1;
    for (const to of [here-1,here+1]) if (r.rooms[to])
      moves.push({code:`walk-${to+1}`,label:`順路を一歩進み「${r.rooms[to]}」へ移動`,to});
    if (here===0 || here===last) destination=here===0 ? last : 0;
    // With only a map enabled, the obstacle blocks the shortcut. The detour costs turns.
  }
  const target = destination === undefined ? r.obstacle+"を突破" : `近道で「${r.rooms![destination]}」へ移動`;
  const canCross = !r.rooms || destination !== undefined;
  if (canCross && r.hp && state.hp && state.hp[seat]>=r.hp.damage)
    moves.push({code:"risk",label:`${target}（HP−${r.hp.damage}）`,damage:r.hp.damage,to:destination});
  if (r.item && (state.stock ?? 0)>0) {
    if (canCross) moves.push({code:"use",label:`${target}（共有の${r.item.name}を1回使用）`,uses:1,to:destination});
    moves.push({code:"use-here",label:`ここで${r.item.name}を使う（残り${state.stock}回から1回消費）`,uses:1});
  }
  return moves;
}

export function resolveMove(r:Rules,state:State,seat:number,code:string) {
  const move=choices(r,state,seat).find(m=>m.code===code);
  if (!move) throw new Error(`席${seat+1}が選べないRPG行動: ${code}`);
  if (move.to !== undefined && state.positions) state.positions[seat] = move.to;
  if (move.damage && state.hp) state.hp[seat] -= move.damage;
  if (move.uses && state.stock !== undefined) state.stock -= move.uses;
  const wound=state.hp?.[seat]===0 ? ` 負傷「${r.hp!.wound}」。` : "";
  return move.label+"。"+wound;
}

export function ruleSheet(r:Rules) {
  return [`障害　${r.obstacle}`,
    r.hp && `各PCのHP ${r.hp.max}。突破の代償 ${r.hp.damage}。0で「${r.hp.wound}」。負傷後も交渉・援護は可能。`,
    r.item && `共有品「${r.item.name}」は${r.item.uses}回分。1回で障害を突破するか、現在地で本来の用途に使う。`,
    r.rooms && `地図　${r.rooms.join(" ⇄ ")}。各PCは入口から1手番1区間。入口と目的地の近道は障害を突破したときに通れる。`]
    .filter(Boolean).join("\n");
}
