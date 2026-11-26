export const SIZE = 18
export const DEFAULT_SEED = 7
export const BUILD_COST = { ore: 20, ice: 4, days: 4 } as const
export const GREEN = 5

export type Policy = 'expand' | 'balance' | 'restore'
export type Resource = 'ore' | 'ice'
export type Activity = 'ore' | 'ice' | 'terraform' | 'build'
export const JOB_POWER: Readonly<Record<Activity, number>> = { ore: 2, ice: 1, terraform: 2, build: 2 }
export type WorkPlan = ReadonlyMap<number, ReadonlySet<Activity>>
export interface Tile {
  x: number
  z: number
  elevation: number
  sunlight: number
  ore: number
  ice: number
  green: number
  factory: number | null
}
export interface Factory {
  id: number
  tile: number
  parent: number | null
  generation: number
  ore: number
  ice: number
  remaining: number
  power: number
  activity: Activity[]
}
export interface MissionEvent {
  day: number
  kind: 'seed' | 'build' | 'online'
  factory: number
  parent: number | null
}
export interface World {
  day: number
  policy: Policy
  tiles: Tile[]
  factories: Factory[]
  events: MissionEvent[]
}

function noise(x: number, z: number, seed: number) {
  let hash = Math.imul(x + 1, 0x9e3779b1) ^ Math.imul(z + 1, 0x85ebca6b) ^ seed
  hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b)
  return ((hash ^ (hash >>> 16)) >>> 0) / 4294967296
}

export function createWorld(seed = DEFAULT_SEED): World {
  const tiles = Array.from({ length: SIZE * SIZE }, (_, index): Tile => {
    const x = index % SIZE
    const z = Math.floor(index / SIZE)
    const random = noise(x, z, seed)
    const ridge = Math.sin(x * .46 + z * .52) * .55 + Math.cos(x * .77 - z * .38) * .30
    const dry = Math.sin(x * .55 + 1) * Math.cos(z * .37 - .4)
    const frost = Math.cos(x * .43 - z * .41) + (z / SIZE - .5)
    return {
      x, z,
      elevation: .42 + ridge * .38 + random * .18 + Math.max(0, ridge) ** 2 * .37,
      sunlight: Math.max(4, Math.min(7, Math.round(5.7 - z * .08 + ridge + random))),
      ore: Math.max(0, Math.round(3 + dry * 7 + random * 8)),
      ice: Math.max(0, Math.round(frost * 5 + noise(x, z, seed + 91) * 5 - 1)),
      green: 0,
      factory: null,
    }
  })
  const world: World = { day: 0, policy: 'balance', tiles, factories: [], events: [] }
  const seedTile = 9 * SIZE + 8
  const factory = place(world, seedTile, null)
  factory.ore = 8
  factory.ice = 2
  return world
}

function place(world: World, tile: number, parent: Factory | null) {
  const factory: Factory = {
    id: world.factories.length,
    tile,
    parent: parent?.id ?? null,
    generation: parent ? parent.generation + 1 : 0,
    ore: 0,
    ice: 0,
    remaining: parent ? BUILD_COST.days : 0,
    power: world.tiles[tile].sunlight,
    activity: [],
  }
  world.tiles[tile].factory = factory.id
  world.factories.push(factory)
  record(world, parent ? 'build' : 'seed', factory)
  return factory
}

function record(world: World, kind: MissionEvent['kind'], factory: Factory) {
  world.events.unshift({ day: world.day, kind, factory: factory.id, parent: factory.parent })
  if (world.events.length > 60) world.events.pop()
}

function distance(a: Tile, b: Tile) {
  return Math.abs(a.x - b.x) + Math.abs(a.z - b.z)
}

const neighbors = Array.from({ length: SIZE * SIZE }, (_, index) => {
  const x = index % SIZE
  const z = Math.floor(index / SIZE)
  const nearby: number[] = []
  for (let dz = -3; dz <= 3; dz++) {
    for (let dx = -3; dx <= 3; dx++) {
      const nx = x + dx
      const nz = z + dz
      if (Math.abs(dx) + Math.abs(dz) <= 3 && nx >= 0 && nx < SIZE && nz >= 0 && nz < SIZE) {
        nearby.push(nz * SIZE + nx)
      }
    }
  }
  return nearby
})

export function workArea(world: World, index: number) {
  return neighbors[index].map(i => world.tiles[i]).filter(tile => distance(tile, world.tiles[index]) <= 2)
}

export function nearbyReserves(world: World, factory: Factory) {
  return workArea(world, factory.tile).reduce((totals, tile) => {
    totals.ore += tile.ore
    totals.ice += tile.ice
    return totals
  }, { ore: 0, ice: 0 })
}

function buildSite(world: World, factory: Factory) {
  let best: number | null = null
  let bestScore = 0
  for (const index of neighbors[factory.tile]) {
    const tile = world.tiles[index]
    if (tile.green > 0 || workArea(world, index).some(other =>
      other.factory !== null && distance(tile, other) <= 1
    )) continue
    const area = workArea(world, index)
    const ore = area.reduce((total, neighbor) => total + neighbor.ore, 0)
    if (ore < BUILD_COST.ore) continue
    const ice = area.reduce((total, neighbor) => total + neighbor.ice, 0)
    const score = ore + Math.min(ice, 18) * 3 + tile.sunlight * 10
    if (score > bestScore) {
      best = index
      bestScore = score
    }
  }
  return best
}

const jobs: Record<Policy, readonly Activity[]> = {
  expand: ['build', 'ore', 'ice'],
  balance: ['build', 'ore', 'ice', 'terraform'],
  restore: ['ice', 'terraform'],
}

function mine(area: Tile[], factory: Factory, resource: Resource) {
  const cost = JOB_POWER[resource]
  const capacity = resource === 'ore' ? 32 : 14
  if (factory.power < cost || factory[resource] >= capacity) return
  const deposit = area.reduce<Tile | undefined>((richest, tile) =>
    tile[resource] > (richest?.[resource] ?? 0) ? tile : richest, undefined)
  if (!deposit) return
  const amount = Math.min(deposit[resource], capacity - factory[resource], resource === 'ore' ? 3 : 2)
  deposit[resource] -= amount
  factory[resource] += amount
  factory.power -= cost
  factory.activity.push(resource)
}

function terraform(area: Tile[], factory: Factory) {
  if (factory.power < JOB_POWER.terraform || factory.ice < 1) return
  const target = area
    .filter(tile => tile.factory === null && tile.green < GREEN)
    .sort((a, b) => b.green - a.green || b.ice - a.ice)[0]
  if (!target) return
  target.green++
  factory.ice--
  factory.power -= JOB_POWER.terraform
  factory.activity.push('terraform')
}

function build(world: World, factory: Factory) {
  if (factory.power < JOB_POWER.build || factory.ore < BUILD_COST.ore || factory.ice < BUILD_COST.ice) return
  const site = buildSite(world, factory)
  if (site === null) return
  factory.ore -= BUILD_COST.ore
  factory.ice -= BUILD_COST.ice
  factory.power -= JOB_POWER.build
  factory.activity.push('build')
  place(world, site, factory)
}

export function advance(world: World, plan?: WorkPlan) {
  world.day++
  const existing = world.factories.length
  for (let id = 0; id < existing; id++) {
    const factory = world.factories[id]
    factory.activity = []
    factory.power = world.tiles[factory.tile].sunlight
    if (factory.remaining > 0) {
      factory.power -= 2
      factory.remaining--
      if (factory.remaining === 0) record(world, 'online', factory)
      continue
    }

    const orders = plan?.get(id)
    if (plan && !orders?.size) continue
    const area = workArea(world, factory.tile)
    for (const job of plan ? jobs.balance : jobs[world.policy]) {
      if (orders && !orders.has(job)) continue
      if (job === 'build') build(world, factory)
      else if (job === 'terraform') terraform(area, factory)
      else mine(area, factory, job)
    }
  }
}

export function survey(world: World) {
  const active = world.factories.filter(factory => factory.remaining === 0).length
  const ore = world.tiles.reduce((total, tile) => total + tile.ore, 0)
  const ice = world.tiles.reduce((total, tile) => total + tile.ice, 0)
  const green = world.tiles.filter(tile => tile.green === GREEN).length
  const generation = Math.max(...world.factories.map(factory => factory.generation))
  return { active, building: world.factories.length - active, ore, ice, green, generation }
}
