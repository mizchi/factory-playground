import type { Entry } from "./session.mts";
import type { Rules, State } from "./rpg.mts";

export type SeatView = {
  draft:number; turn:number; seat:number; title:string; promise:string; question:string; cast:string[];
  handout:{name:string; desire:string; clue:string; win:string}; events:Entry[];
  rules?:Rules; state?:State;
};
export type Option = {code:string; label:string};
export type Action = { action:string; move?:string };
export type Survey = { satisfaction:string; surprise:string; fairness:string; agency:string; victory:string; tension?:string; challenge?:string };
export interface HumanSeat {
  seat:number; // 1-based, consistent with handout filenames and public action IDs
  observe?(view:SeatView):void;
  act(view:SeatView, options:Option[]):Promise<Action>;
  reply(view:SeatView):Promise<string>;
  survey(view:SeatView):Promise<Survey>;
}

export function seatNumber(value:string, count:number) {
  const n=Number(value);
  if (!/^[1-9]\d*$/.test(value) || n>count) throw new Error(`人間が担当する席は1〜${count}を指定してください`);
  return n;
}
