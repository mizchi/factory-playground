import { observe, play, start, type Cue, type Move, type Rules, type Seat, type State } from "./game.mts";

export function possibleEffect(rules: Rules, seed: number) {
  if (rules.pattern === "islands") {
    const first = 0 as const;
    const actions: Move[] = ["supply", "supply", "yard", "supply", "supply", "supply", "supply", "ocean"];
    let state = start(rules, seed, first);
    for (const move of actions) {
      const result = play(rules, state, move);
      if (result.cue) return { first, actions, cue: result.cue };
      state = result.state;
    }
    return null;
  }
  const path: Move[] = [];
  const visited = new Set<string>();
  function walk(state: State): { actions: Move[]; cue: Cue } | null {
    const facts = state.resonance ? [state.resonance.charges, state.resonance.surges] : rules.pattern === "claim" ? state.carry : state.players.map(player => {
      if (rules.pattern === "duel") return [...player.used].sort();
      if (rules.pattern === "auction") return player.funds;
      if (rules.pattern === "mine") return player.cargo;
      return [player.funds, player.level, player.netInvest];
    });
    const key = JSON.stringify([state.round, state.first, state.pending, state.pressure, facts]);
    if (visited.has(key)) return null;
    visited.add(key);
    for (const option of observe(rules, state, state.turn).options) {
      const next = play(rules, state, option.id);
      path.push(option.id);
      if (next.cue) return { actions: [...path], cue: next.cue };
      const deeper = walk(next.state);
      if (deeper) return deeper;
      path.pop();
    }
    return null;
  }
  for (const first of [0, 1] satisfies Seat[]) {
    visited.clear();
    const result = walk(start(rules, seed, first));
    if (result) return { first, ...result };
  }
  return null;
}
