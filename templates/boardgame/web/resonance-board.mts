import type { Move, Rules, TableView, View } from "../game.mts";
import { resonanceRounds, thresholds, wires, type Discharge, type Pulse, type Resonance } from "../resonance.mts";
import { element } from "./dom.mts";

export type Playback = { discharge: Discharge; chargesBefore: Resonance["charges"]; round: number;
  publicEvents: number; start: number; duration: number };
export const signalDuration = (pulses: Pulse[]) => pulses.length === 1 ? 240 : 420 + Math.floor(pulses.at(-1)!.to / 3) * 160;

const width = 1120;
const height = 600;
const colors = ["#f8b54a", "#48e6fa", "#e39cfb"];
const position = (index: number) => ({ x: width * ((index % 3) + .5) / 3, y: height * (Math.floor(index / 3) + .5) / 3 });

function drawBeam(ctx: CanvasRenderingContext2D, from: number, to: number, color: string, glow: number, portion = 1) {
  const a = position(from);
  const b = position(to);
  ctx.strokeStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = glow;
  ctx.lineWidth = glow ? 6 : 2;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(a.x + (b.x - a.x) * portion, a.y + (b.y - a.y) * portion);
  ctx.stroke();
  ctx.shadowBlur = 0;
}

function drawBurst(ctx: CanvasRenderingContext2D, pulse: Pulse, age: number) {
  const center = position(pulse.to);
  const color = colors[pulse.to % 3];
  const tower = pulse.to >= 6;
  const progress = Math.min(1, age / 390);
  ctx.globalAlpha = 1 - progress;
  ctx.shadowBlur = 18;
  ctx.shadowColor = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = tower ? 5 : 3;
  const radius = (tower ? 38 : 24) + progress * (tower ? 130 : 70);
  ctx.beginPath();
  ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
  ctx.stroke();
  for (let particle = 0; particle < (tower ? 16 : 9); particle++) {
    const angle = particle * 2.4;
    const distance = radius * (1 + (particle % 3) * .13);
    ctx.fillStyle = particle % 3 ? color : "#fff5d2";
    ctx.fillRect(center.x + Math.cos(angle) * distance, center.y + Math.sin(angle) * distance, 5, 5);
  }
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;
}

export function resonanceBoard(rules: Rules, view: View, table: Extract<TableView, { kind: "resonance" }>,
  select: (move: Move) => void, playback: Playback | null) {
  const root = element("div", "", "resonance-table");
  const info = element("div", "", "signal-info");
  info.append(element("span", "増幅の残り"), element("strong", `あなた ${table.network.surges[0]} ／ 相手 ${table.network.surges[1]}`));
  if (resonanceRounds.includes(playback?.round ?? view.round) && (playback || !view.done))
    info.append(element("span", "共鳴ラウンド", "signal-resonant"));
  const inspect = element("button", "経路を下見", "signal-inspect");
  inspect.type = "button";
  inspect.setAttribute("aria-pressed", "false");
  info.append(inspect);
  root.append(info);
  const field = element("div", "", "signal-field");
  field.setAttribute("aria-label", "三列の送電回路");
  const canvas = element("canvas", "");
  canvas.width = width;
  canvas.height = height;
  canvas.setAttribute("aria-hidden", "true");
  field.append(canvas);
  const stamp = element("div", "", "signal-stamp");
  stamp.hidden = true;
  stamp.setAttribute("aria-hidden", "true");
  if (playback?.discharge.points) stamp.append(
    element("span", playback.discharge.towers === 2 ? "二塔連鎖" : "得点塔 放電"),
    element("strong", `＋${playback.discharge.points}`),
  );
  field.append(stamp);
  const cells = table.network.charges.flat().map((amount, index) => {
    const row = Math.floor(index / 3);
    const lane = index % 3;
    const cell = element("div", "", "signal-node");
    const anchor = position(index);
    cell.style.left = `${100 * anchor.x / width}%`;
    cell.style.top = `${100 * anchor.y / height}%`;
    cell.style.setProperty("--signal", colors[lane]);
    cell.dataset.row = String(row);
    const label = row === 0 ? rules.labels[lane] : row === 1 ? `中継 ${lane + 1}` : `${rules.values[lane]} 点塔`;
    const title = element("strong", label);
    const meter = element("span", "", "signal-meter");
    const level = element("span", "", "signal-level");
    for (let i = 0; i < thresholds[row]; i++) meter.append(element("i", ""));
    const fill = (charge: number) => {
      if (cell.dataset.charge === String(charge)) return;
      cell.dataset.charge = String(charge);
      level.textContent = `${charge}/${thresholds[row]}`;
      for (const [i, pip] of Array.from(meter.children).entries()) pip.classList.toggle("filled", i < charge);
    };
    fill(amount);
    cell.append(title, meter, level);
    field.append(cell);
    return { cell, fill, amount };
  });
  root.append(field);

  let highlighted: Pulse[] = [];
  const active = playback?.discharge.pulses ?? [];
  const initialCharges = playback?.chargesBefore.flat();
  const context = canvas.getContext("2d");
  function renderFrame(now: number, animate: boolean) {
    const elapsed = playback ? now - playback.start : Infinity;
    const running = playback && elapsed < playback.duration;
    stamp.hidden = !(running && elapsed >= 320 && playback.discharge.points);
    if (context) {
      context.clearRect(0, 0, width, height);
      for (const wire of wires) drawBeam(context, wire.from, wire.to, "#577386", 0);
      for (const pulse of highlighted) if (pulse.from !== null) drawBeam(context, pulse.from, pulse.to, colors[pulse.to % 3], 0);
    }
    for (const [index, current] of cells.entries()) {
      const pulse = active.find(candidate => candidate.to === index);
      const age = elapsed - Math.floor(index / 3) * 160;
      current.fill(running && initialCharges ? (pulse && age >= 0 ? pulse.after : initialCharges[index]) : current.amount);
      current.cell.classList.toggle("signal-hit", Boolean(running && pulse && age >= 0 && age < 390));
      current.cell.classList.toggle("signal-burst", Boolean(running && pulse?.burst && age >= 0 && age < 390));
      current.cell.classList.toggle("signal-preview", highlighted.some(event => event.to === index));
      if (context && running && pulse) {
        if (pulse.from !== null && age >= -125 && age < 210) {
          drawBeam(context, pulse.from, pulse.to, colors[index % 3], 22, Math.min(1, (age + 125) / 125));
        }
        if (pulse.burst && age >= 0 && age < 390) drawBurst(context, pulse, age);
      }
    }
    if (running && animate) requestAnimationFrame(time => { if (root.isConnected) renderFrame(time, true); });
  }
  renderFrame(performance.now(), true);

  const controls = element("div", "", "signal-controls");
  const enabled = new Set(view.options.map(option => option.id));
  const locked = playback && performance.now() < playback.start + playback.duration;
  const confirm = element("button", "この手で送電", "signal-inspect signal-confirm");
  confirm.type = "button";
  confirm.hidden = true;
  inspect.disabled = Boolean(locked) || enabled.size === 0;
  let inspectMode = false;
  let picked: Move | null = null;
  inspect.onclick = () => {
    inspectMode = !inspectMode;
    inspect.setAttribute("aria-pressed", String(inspectMode));
    confirm.hidden = true;
    picked = null;
    highlighted = [];
    renderFrame(performance.now(), false);
  };
  confirm.onclick = () => { if (picked) select(picked); };
  for (const [lane, label] of rules.labels.entries()) {
    const group = element("div", "", "signal-controls-lane");
    group.style.setProperty("--signal", colors[lane]);
    group.append(element("strong", label));
    for (const preview of table.previews.filter(item => item.lane === lane)) {
      const button = element("button", "", "signal-send choice");
      button.type = "button";
      button.disabled = Boolean(locked) || !enabled.has(preview.move);
      button.dataset.signal = preview.move;
      button.append(element("span", preview.amount === 2 ? "増幅 ＋2" : "送電 ＋1"),
        element("strong", `＋${preview.points}点`), element("span", `相手に残る最大 ${preview.rival}点`, "rival-points"));
      button.onclick = () => {
        if (!inspectMode) {
          select(preview.move);
          return;
        }
        picked = preview.move;
        highlighted = preview.pulses;
        confirm.hidden = false;
        confirm.textContent = `${rules.labels[lane]}に${preview.amount === 2 ? "増幅" : "送電"} · ＋${preview.points}点`;
        renderFrame(performance.now(), false);
      };
      const highlight = () => { highlighted = preview.pulses; renderFrame(performance.now(), false); };
      const clear = () => {
        highlighted = table.previews.find(item => item.move === picked)?.pulses ?? [];
        renderFrame(performance.now(), false);
      };
      button.addEventListener("mouseenter", highlight);
      button.addEventListener("mouseleave", clear);
      button.addEventListener("focus", highlight);
      button.addEventListener("blur", clear);
      group.append(button);
    }
    controls.append(group);
  }
  root.append(controls);
  root.append(confirm);
  return root;
}
