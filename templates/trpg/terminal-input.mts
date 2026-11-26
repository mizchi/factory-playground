import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";

export class PlayInterrupted extends Error {}

export interface TerminalInput {
  readLine(prompt: string): Promise<string>;
  close(): void;
}

export function terminalInput(input: Readable = process.stdin, output: Writable = process.stdout): TerminalInput {
  const rl = createInterface({ input, output, crlfDelay: Infinity });
  const lines = rl[Symbol.asyncIterator]();
  rl.on("SIGINT", () => rl.close());
  return {
    async readLine(prompt) {
      output.write(prompt);
      const line = await lines.next();
      if (line.done || line.value.trim() === "/quit") throw new PlayInterrupted("人間の入力が終了しました");
      return line.value.trim();
    },
    close: () => rl.close()
  };
}
