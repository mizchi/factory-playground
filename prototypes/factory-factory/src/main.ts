import './style.css'
import { advance, BUILD_COST, createWorld, DEFAULT_SEED, GREEN, JOB_POWER, nearbyReserves, survey } from './simulation.ts'
import type { Activity, MissionEvent, Policy } from './simulation.ts'
import {
  assign, canAssign, canPlayTurn, createPlacement, isFinished, MAX_SHIFTS, OBJECTIVES, playTurn,
  reservedPower, SHIFT_DAYS, shiftsPlayed, unassign, workerCapacity, workersAvailable,
} from './placement.ts'
import { showTerrain } from './terrain.ts'
import type { MapMode } from './terrain.ts'

const get = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
const seedInput = get<HTMLInputElement>('seed')
const runButton = get<HTMLButtonElement>('run')
const stepButton = get<HTMLButtonElement>('step')
const progress = get<HTMLProgressElement>('coverage')
const layout = get('playfield')
const destination = get<HTMLSelectElement>('deployment-factory')
const commit = get<HTMLButtonElement>('commit-shift')
const jobButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-job]')]
const operationButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-operation]')]
const events = get<HTMLOListElement>('events')
const policyButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-policy]')]
const mapButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-map]')]
const speedButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-speed]')]
const hints: Record<Policy, string> = {
  expand: '緑化を止め、鉱石と氷を子工場の建設に回す。',
  balance: '採掘・建設を進め、余った電力と氷を緑化に使う。',
  restore: '新規建設を止め、氷の採掘と緑化を進める。着工済みの工場は完成する。',
}
const activityLabels: Record<Activity, string> = { ore: '鉱石採掘', ice: '氷採掘', terraform: '緑化', build: '子工場に着工' }

type Operation = 'automatic' | 'placement'
const seeds: Record<Operation, number> = { placement: DEFAULT_SEED, automatic: DEFAULT_SEED }
let operation: Operation = 'placement'
let automatic = createWorld()
let placement = createPlacement()
let world = placement.world
let targetFactory = 0
let availableFactories = ''
let selected = world.factories[0].tile
let mode: MapMode = 'surface'
let timer: number | undefined
let speed = 1
let previousEvent = world.events[0]
let renderMap: ReturnType<typeof showTerrain> | undefined

function setText(id: string, value: string | number) {
  get(id).textContent = String(value)
}

function factoryName(id: number) {
  return `F-${String(id + 1).padStart(2, '0')}`
}

function eventLabel(event: MissionEvent) {
  const name = factoryName(event.factory)
  if (event.kind === 'build') return `${factoryName(event.parent ?? 0)} → ${name} 着工`
  return event.kind === 'online' ? `${name} 稼働開始` : `母工場 ${name} が着陸`
}

function showEvents() {
  const items = world.events.slice(0, 5).map(event => {
    const item = document.createElement('li')
    item.dataset.kind = event.kind
    const day = item.appendChild(document.createElement('span'))
    day.textContent = String(event.day).padStart(3, '0') + ' 日'
    item.append(eventLabel(event))
    return item
  })
  events.replaceChildren(...items)
  const badge = document.createElement('span')
  badge.textContent = eventLabel(world.events[0])
  badge.dataset.kind = world.events[0].kind
  get('map-event').replaceChildren(badge)
  previousEvent = world.events[0]
}

function displayPlacement(stats: ReturnType<typeof survey>) {
  const finished = isFinished(placement)
  const ready = world.factories.filter(factory => factory.remaining === 0)
  const options = ready.map(factory => factory.id).join(',')
  if (options !== availableFactories) {
    destination.replaceChildren(...ready.map(factory => new Option(factoryName(factory.id), String(factory.id))))
    availableFactories = options
  }
  destination.value = String(targetFactory)
  const target = world.factories[targetFactory]
  const reserves = nearbyReserves(world, target)
  const capacity = workerCapacity(placement)
  const available = workersAvailable(placement)
  const planned = placement.plan.get(targetFactory)
  const power = reservedPower(placement, targetFactory)
  const sunlight = world.tiles[target.tile].sunlight

  setText('crew-count', `残り ${available} / ${capacity} 班`)
  setText('power-budget', `電力 ${power} / ${sunlight}`)
  setText('local-stock', `在庫 鉱石 ${target.ore}・氷 ${target.ice} ｜ 周辺埋蔵 ${reserves.ore}・${reserves.ice}`)
  for (const button of jobButtons) {
    const job = button.dataset.job as Activity
    const occupied = planned?.has(job) ?? false
    button.setAttribute('aria-pressed', String(occupied))
    button.disabled = finished || (!occupied && !canAssign(placement, targetFactory, job))
    button.querySelector('small')!.textContent = occupied ? '配置済み · 解除' : `電力 ${JOB_POWER[job]}`
  }
  setText('placement-note', finished ? '' : `建設には鉱石 ${BUILD_COST.ore}・氷 ${BUILD_COST.ice}。班は${SHIFT_DAYS}日後に戻ります。`)
  setText('shift-number', finished ? '作戦終了' : `第 ${shiftsPlayed(placement) + 1} / ${MAX_SHIFTS} 手`)
  commit.disabled = !canPlayTurn(placement)
  const achieved = stats.active >= OBJECTIVES.active && stats.green >= OBJECTIVES.green
  const objective = `${SHIFT_DAYS * MAX_SHIFTS}日までに稼働 ${OBJECTIVES.active} 基・緑化 ${OBJECTIVES.green} 区画`
  setText('objectives', finished ? (achieved ? '作戦達成' : '作戦終了 · 目標未達') : objective)
  const last = placement.lastShift
  setText('shift-result', last
    ? `前の手 · 採掘 ${last.ore} / 採氷 ${last.ice} / 着工 ${last.started} / 稼働 +${last.commissioned} / 緑化 +${last.green}`
    : '')
  const assignments = [...placement.plan].map(([factory, jobs]) => `${factoryName(factory)} ×${jobs.size}`)
  setText('deployment-summary', assignments.length ? `配置済み · ${assignments.join(' / ')}` : '')
}

function display() {
  const stats = survey(world)
  setText('day', String(world.day).padStart(3, '0'))
  setText('active', stats.active)
  setText('building', stats.building)
  setText('generation', stats.generation)
  setText('green', `${stats.green} / ${world.tiles.length}`)
  progress.value = stats.green
  setText('ore', stats.ore.toLocaleString('ja-JP'))
  setText('ice', stats.ice.toLocaleString('ja-JP'))

  const tile = world.tiles[selected]
  setText('coordinates', `X ${String(tile.x + 1).padStart(2, '0')} / Y ${String(tile.z + 1).padStart(2, '0')}`)
  setText('tile-info', `鉱石 ${tile.ore} ・ 氷 ${tile.ice} ・ 発電 ${tile.sunlight}/日 ・ 緑化 ${tile.green * 100 / GREEN}%`)
  const factory = tile.factory === null ? undefined : world.factories[tile.factory]
  setText('factory-title', factory ? `${factoryName(factory.id)} ・ 第${factory.generation}世代` : '')
  setText('factory-info', factory ? [
    factory.parent === null ? '母工場' : `親工場 ${factoryName(factory.parent)}`,
    `在庫 鉱石 ${factory.ore} / 氷 ${factory.ice}`,
    `余剰電力 ${factory.power}`,
  ].join(' ・ ') : '')
  setText('factory-activity', factory
    ? factory.remaining > 0
      ? `建設中 ${BUILD_COST.days - factory.remaining} / ${BUILD_COST.days} 日`
      : `稼働中${factory.activity.length ? ' ・ ' + factory.activity.map(job => activityLabels[job]).join(' / ') : ''}`
    : '')

  if (operation === 'placement') displayPlacement(stats)
  if (previousEvent !== world.events[0]) showEvents()
  renderMap?.(world, mode, selected, operation === 'placement' ? { plan: placement.plan, factory: targetFactory } : undefined)
}

function tick() {
  advance(world)
  display()
}

function setRunning(running: boolean) {
  if (timer !== undefined) window.clearInterval(timer)
  timer = running ? window.setInterval(tick, 650 / speed) : undefined
  runButton.textContent = running ? 'Ⅱ 停止' : '▶ 実行'
  stepButton.disabled = running
}

function selectPolicy(policy: Policy) {
  world.policy = policy
  setText('policy-hint', hints[policy])
  for (const button of policyButtons) button.setAttribute('aria-pressed', String(button.dataset.policy === policy))
}

function chooseOperation(next: Operation) {
  if (next === operation) return
  setRunning(false)
  operation = next
  layout.dataset.operation = next
  const manual = next === 'placement'
  world = manual ? placement.world : automatic
  selected = world.factories[manual ? targetFactory : 0].tile
  seedInput.value = String(seeds[next])
  get('placement-panel').hidden = !manual
  get('deployment-summary').hidden = !manual
  get('objectives').hidden = !manual
  get('crew-key').hidden = !manual
  get('automatic-panel').hidden = manual
  get('automatic-controls').hidden = manual
  get('speed-controls').hidden = manual
  for (const button of operationButtons) button.setAttribute('aria-pressed', String(button.dataset.operation === next))
  if (!manual) selectPolicy(world.policy)
  display()
}

try {
  renderMap = showTerrain(get('viewport'), index => {
    selected = index
    const factory = world.tiles[index].factory
    if (operation === 'placement' && factory !== null && world.factories[factory].remaining === 0) {
      targetFactory = factory
    }
    display()
  })
} catch (error) {
  console.error('3D map initialization failed', error)
  get('map-error').hidden = false
  for (const button of mapButtons) button.disabled = true
}

runButton.addEventListener('click', () => setRunning(timer === undefined))
stepButton.addEventListener('click', tick)
get('reset').addEventListener('click', () => {
  if (!seedInput.reportValidity()) return
  const seed = Number.isNaN(seedInput.valueAsNumber) ? DEFAULT_SEED : seedInput.valueAsNumber
  seedInput.value = String(seed)
  setRunning(false)
  seeds[operation] = seed
  if (operation === 'placement') {
    placement = createPlacement(seed)
    targetFactory = 0
    world = placement.world
  } else {
    automatic = createWorld(seed)
    world = automatic
    selectPolicy(world.policy)
  }
  selected = world.factories[0].tile
  display()
})
for (const button of policyButtons) button.addEventListener('click', () => selectPolicy(button.dataset.policy as Policy))
for (const button of mapButtons) button.addEventListener('click', () => {
  mode = button.dataset.map as MapMode
  for (const option of mapButtons) option.setAttribute('aria-pressed', String(option === button))
  display()
})
for (const button of speedButtons) button.addEventListener('click', () => {
  speed = Number(button.dataset.speed)
  for (const option of speedButtons) option.setAttribute('aria-pressed', String(option === button))
  if (timer !== undefined) setRunning(true)
})

for (const button of operationButtons) button.addEventListener('click', () => chooseOperation(button.dataset.operation as Operation))
destination.addEventListener('change', () => {
  targetFactory = Number(destination.value)
  selected = world.factories[targetFactory].tile
  display()
})
for (const button of jobButtons) button.addEventListener('click', () => {
  const job = button.dataset.job as Activity
  if (placement.plan.get(targetFactory)?.has(job)) unassign(placement, targetFactory, job)
  else assign(placement, targetFactory, job)
  display()
})
commit.addEventListener('click', () => {
  if (playTurn(placement)) display()
})

showEvents()
display()
