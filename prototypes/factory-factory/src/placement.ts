import { advance, createWorld, JOB_POWER, survey } from './simulation.ts'
import type { Activity, World } from './simulation.ts'

export const SHIFT_DAYS = 5
export const MAX_SHIFTS = 8
export const OBJECTIVES = { active: 4, green: 8 } as const

export interface ShiftResult {
  ore: number
  ice: number
  started: number
  commissioned: number
  green: number
}

export interface Placement {
  world: World
  plan: Map<number, Set<Activity>>
  lastShift: ShiftResult | null
}

export function createPlacement(seed?: number): Placement {
  return { world: createWorld(seed), plan: new Map(), lastShift: null }
}

export function shiftsPlayed(game: Placement) {
  return game.world.day / SHIFT_DAYS
}

export function isFinished(game: Placement) {
  return shiftsPlayed(game) >= MAX_SHIFTS
}

export function workerCapacity(game: Placement) {
  const active = game.world.factories.filter(factory => factory.remaining === 0).length
  return Math.min(8, 2 + active)
}

export function workersAvailable(game: Placement) {
  const assigned = [...game.plan.values()].reduce((total, jobs) => total + jobs.size, 0)
  return workerCapacity(game) - assigned
}

export function reservedPower(game: Placement, factoryId: number) {
  const jobs = game.plan.get(factoryId) ?? []
  let total = 0
  for (const job of jobs) total += JOB_POWER[job]
  return total
}

export function canAssign(game: Placement, factoryId: number, job: Activity) {
  const factory = game.world.factories[factoryId]
  return !isFinished(game)
    && factory?.remaining === 0
    && !game.plan.get(factoryId)?.has(job)
    && workersAvailable(game) > 0
    && reservedPower(game, factoryId) + JOB_POWER[job] <= game.world.tiles[factory.tile].sunlight
}

export function assign(game: Placement, factoryId: number, job: Activity) {
  if (!canAssign(game, factoryId, job)) return false
  const jobs = game.plan.get(factoryId) ?? new Set<Activity>()
  jobs.add(job)
  game.plan.set(factoryId, jobs)
  return true
}

export function unassign(game: Placement, factoryId: number, job: Activity) {
  const jobs = game.plan.get(factoryId)
  jobs?.delete(job)
  if (jobs?.size === 0) game.plan.delete(factoryId)
}

export function canPlayTurn(game: Placement) {
  return !isFinished(game)
    && (game.plan.size > 0 || game.world.factories.some(factory => factory.remaining > 0))
}

export function playTurn(game: Placement): ShiftResult | null {
  if (!canPlayTurn(game)) return null
  const before = survey(game.world)
  const factories = game.world.factories.length
  for (let day = 0; day < SHIFT_DAYS; day++) advance(game.world, game.plan)
  game.plan.clear()
  const after = survey(game.world)
  game.lastShift = {
    ore: before.ore - after.ore,
    ice: before.ice - after.ice,
    started: game.world.factories.length - factories,
    commissioned: after.active - before.active,
    green: after.green - before.green,
  }
  return game.lastShift
}
