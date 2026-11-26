import { defineConfig } from "vite";
import { allMoves, observe, parseRules, play, start, turnLimit, type Move } from "./game.mts";
import { choose, playerRoute, type PlayerRoute } from "./llm.mts";

export default defineConfig({
  base: "./",
  server: { host: "127.0.0.1" },
  plugins: [{
    name: "boardgame-local-opponent",
    configureServer(server) {
      let busy = false;
      server.middlewares.use("/api/move", async (req, res) => {
        function reply(status: number, data: unknown) {
          res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
          res.end(JSON.stringify(data));
        }
        const origin = req.headers.origin;
        if (req.method !== "POST" || req.headers["content-type"]?.split(";")[0] !== "application/json" ||
            (origin && origin !== `http://${req.headers.host}`)) {
          reply(403, { error: "試遊ページから呼び出してください" });
          return;
        }
        if (busy) {
          reply(409, { error: "別の対局でLLMが思考中です" });
          return;
        }
        busy = true;
        try {
          let body = "";
          for await (const part of req) {
            body += part.toString();
            if (body.length > 12_000) {
              reply(413, { error: "リクエストが大きすぎます" });
              return;
            }
          }
          let view;
          let route: PlayerRoute;
          try {
            const input = JSON.parse(body);
            const rules = parseRules(input.rules);
            if (input.opponent !== "jev" && input.opponent !== "llm") throw new Error("対戦相手が不明です");
            route = input.opponent === "jev"
              ? playerRoute("jev", process.env.BOARDGAME_JEV_MODEL)
              : playerRoute(process.env.BOARDGAME_PLAYER2_AGENT, process.env.BOARDGAME_PLAYER2_MODEL);
            if (!Number.isInteger(input.seed) || input.seed < 0 || input.seed > 0xffffffff ||
                ![0, 1].includes(input.first) || !Array.isArray(input.actions) || input.actions.length >= turnLimit(rules))
              throw new Error("対局の形式が不正です");
            const rivalLead = input.rivalLead ?? 0;
            if (![0, 1, 2].includes(rivalLead)) throw new Error("相手の先行点が不正です");
            let state = start(rules, input.seed, input.first, rivalLead);
            for (const move of input.actions) {
              if (!allMoves.includes(move)) throw new Error("不明な手です");
              state = play(rules, state, move as Move).state;
            }
            if (state.turn !== 1) throw new Error("LLMの手番ではありません");
            view = observe(rules, state, 1);
          } catch (error) {
            reply(400, { error: error instanceof Error ? error.message : "対局の形式が不正です" });
            return;
          }
          if (view.options.length === 1) {
            reply(200, { move: view.options[0].id });
            return;
          }
          try {
            const decision = await choose(route, view);
            reply(200, { move: decision.move });
          } catch (error) {
            server.config.logger.error(String(error));
            const message = route.agent === "jev" && !process.env.TYPESAFE_API_KEY?.trim()
              ? "Jevには、TYPESAFE_API_KEYを設定して起動したViteが必要です。"
              : "対戦相手の手を取得できませんでした。再試行するか、CPUに切り替えてください。";
            reply(502, { error: message });
          }
        } finally {
          busy = false;
        }
      });
    },
  }],
});
