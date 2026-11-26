import { seatCriteria, type SeatMetric } from "./seat-review.mts";
import { terminalInput, type TerminalInput } from "./terminal-input.mts";
export { PlayInterrupted } from "./terminal-input.mts";
import type { Readable, Writable } from "node:stream";
import type { HumanSeat, SeatView } from "./human.mts";
import type { Entry } from "./session.mts";
import { ruleSheet } from "./rpg.mts";


function short(text:string) {
  const line=text.trim().replace(/\s+/gu," ");
  if ([...line].length <= 52) return line;
  const head=[...line].slice(0,50).join("");
  return head.match(/^.*[。！？][」』]?/u)?.[0] ?? head+"…";
}

function describe(event:Entry) {
  if (event.id.startsWith("D") && event.brief) return event.brief.trim();
  return short(event.brief || event.text);
}

function status(v:SeatView) {
  const i=v.seat-1, hp=v.state?.hp?.[i], position=v.state?.positions?.[i];
  return [position===undefined ? "" : v.rules?.rooms?.[position],
    hp===undefined ? "" : `HP ${hp}/${v.rules?.hp?.max ?? hp}`,
    hp===0 ? v.rules?.hp?.wound : "",
    v.rules?.item ? `${v.rules.item.name} 残り${v.state?.stock}回` : ""].filter(Boolean).join("　");
}

export function terminalSeat(seat:number, input: Readable | TerminalInput = process.stdin, output:Writable=process.stdout,
    viewMode: "player" | "audience" = "player"): HumanSeat & {close():void} {
  const reader = "readLine" in input ? input : terminalInput(input, output);
  const print=(s:string)=>{output.write(s+"\n")};
  let lastDraft=0, seen=0;

  function hand(v:SeatView) {
    return `望み　${v.handout.desire}\n手がかり　${v.handout.clue}\n勝利条件　${v.handout.win}`;
  }

  async function ask(v:SeatView,cue:string,label:string):Promise<string> {
    for (;;) {
      print("\n"+cue);
      const answer=await reader.readLine(label+" > ");
      if (answer==="/log") print(v.events.map(e=>`[${e.id}] ${e.text}`).join("\n"));
      else if (answer==="/hand") print(viewMode === "audience" ? "この画面は会場用です。手札は伏せて遊びます。" : hand(v));
      else if (answer==="/rules") print(v.rules ? ruleSheet(v.rules) : "この卓に追加のルールはありません。");
      else if (answer) return answer;
      else print("一行入力してください。");
    }
  }

  async function rate(view:SeatView, cue:string, metric:SeatMetric) {
    const {question,options} = seatCriteria[metric];
    const menu = options.map((label,i) => `${i+1}. ${label}`).join("　");
    for (;;) {
      const answer = await ask(view, cue+"\n"+question+"\n"+menu+"　0. パス", "番号と、そう思った理由は？");
      if (answer === "0") return "未回答";
      const match = /^([1-9])\s+(.+)$/u.exec(answer);
      const label = match && options[Number(match[1])-1];
      if (label && match) return `${label}|本人申告|${match[2]}`;
      print("例「1 相手の提案で手を変えられた」。パスは 0 です。");
    }
  }

  function show(v:SeatView) {
    if (lastDraft!==v.draft) {
      lastDraft=v.draft;
      seen=0;
      print(`\n${v.title}　あなたは${v.handout.name}です。`);
      if (viewMode === "player") print(hand(v));
      print(viewMode === "player" ? "/log 全文　/hand 手札　/rules ルール　/quit 中断" : "/log 全文　/rules ルール　/quit 中断");
    }
    for (const e of v.events.slice(seen)) print(viewMode === "audience" && e.id === "S0" ? e.text : describe(e));
    seen=v.events.length;
  }

  return { seat, observe:show, close:reader.close,
    async act(v,options) {
      show(v);
      const world=v.events.findLast(e=>e.id.startsWith("S"));
      const decision=v.events.findLast(e=>e.id===`D${v.turn-1}`);
      const decisionCue=decision && describe(decision)+" 別案も出せます。";
      const latest=v.events.at(-1);
      const situation=[`第${v.turn}場面　${v.handout.name}`,status(v),world && describe(world),
        latest && latest!==world && latest!==decision && describe(latest),decisionCue].filter(Boolean).join("\n");
      let selected;
      if(options.length) {
        const menu=options.map((m,i)=>`${i+1}. ${m.label}`).join("\n");
        const cue=situation+"\n"+menu;
        while(!selected) {
          const n=await ask(v,cue,"行動の番号");
          if (/^[1-9]\d*$/.test(n)) selected=options[Number(n)-1];
          if(!selected) print(`1〜${options.length}を選んでください。`);
        }
      }
      const declaration=selected ? [status(v),decisionCue,"選んだ行動　"+selected.label].filter(Boolean).join("\n") : situation;
      const action=await ask(v,declaration,"あなたの台詞や行動は？");
      return {action,move:selected?.code};
    },
    async reply(v) {
      show(v);
      const offers=v.events.filter(e=>e.id.match(/^[AR]/) && Number(e.id.slice(1).split(".")[0])===v.turn && !e.id.endsWith("."+v.seat));
      const latestBySeat=new Map<string,Entry>();
      for (const e of offers) latestBySeat.set(e.id.split(".")[1],e);
      const proposals=[...latestBySeat.values()].map(describe);
      return ask(v,proposals.length ? "相手の提案\n"+proposals.join("\n") : "全員が最終案を出しました。","どう返しますか？（会話のみ）");
    },
    async survey(v) {
      show(v);
      const last=v.events.findLast(e=>e.id.startsWith("S"));
      const outcome=last ? "結末　"+describe(last) : "卓が終わりました。";
      const action=v.events.findLast(e=>e.id.startsWith("A") && e.id.endsWith("."+v.seat));
      return {satisfaction:await rate(v,outcome,"enjoyment"),
        surprise:await ask(v,outcome,"意外だったことは？"),
        fairness:await rate(v,outcome,"credibility"),
        agency:await ask(v,action ? "あなたの最後の行動　"+describe(action) : outcome,"どの選択が効きましたか？"),
        tension:await rate(v,outcome,"tension"),
        challenge:await rate(v,action ? "あなたの最後の行動　"+describe(action) : outcome,"gameFeel"),
        victory:viewMode === "audience" ? "会場では個別の勝利条件を伏せたため未評価。" :
          await ask(v,"あなたの目標　"+short(v.handout.win),"勝利条件を達成しましたか？")};
    }
  };
}
