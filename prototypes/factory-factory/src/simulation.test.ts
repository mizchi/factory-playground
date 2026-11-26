import assert from 'node:assert/strict'
import { test } from 'node:test'
import { advance, BUILD_COST, createWorld, survey } from './simulation.ts'

test('a landed seed mines and commissions descendants with the same production capabilities', () => {
  const world = createWorld()
  const initial = survey(world)
  world.policy = 'expand'
  for (let day = 0; day < 40; day++) advance(world)
  const result = survey(world)
  assert.ok(result.active > 5)
  assert.ok(result.generation >= 2)
  assert.ok(result.ore < initial.ore)
  assert.ok(result.ice < initial.ice)
  assert.equal(result.green, 0)
  assert.equal(new Set(world.factories.map(factory => factory.tile)).size, world.factories.length)
  assert.ok(world.factories.some(factory => factory.generation > 0 && factory.activity.length > 0))
})

test('water and ore are accounted for across mining, construction, and terraforming', () => {
  const world = createWorld()
  const initial = survey(world)
  for (let day = 0; day < 120; day++) {
    advance(world)
    const result = survey(world)
    const storedOre = world.factories.reduce((sum, factory) => sum + factory.ore, 0)
    const storedIce = world.factories.reduce((sum, factory) => sum + factory.ice, 0)
    const terraformed = world.tiles.reduce((sum, tile) => sum + tile.green, 0)
    assert.equal(result.ore + storedOre + (world.factories.length - 1) * BUILD_COST.ore, initial.ore + 8)
    assert.equal(result.ice + storedIce + (world.factories.length - 1) * BUILD_COST.ice + terraformed, initial.ice + 2)
    assert.ok(world.tiles.every(tile => tile.ore >= 0 && tile.ice >= 0))
    assert.ok(world.factories.every(factory => factory.power >= 0))
  }
  assert.ok(survey(world).generation >= 2)
  assert.ok(survey(world).green > 0)
})

test('switching to restoration stops new builds, finishes funded work and greens the surface', () => {
  const world = createWorld()
  world.policy = 'expand'
  while (world.factories.length < 2 && world.day < 20) advance(world)
  assert.equal(survey(world).building, 1)
  const count = world.factories.length
  world.policy = 'restore'
  for (let day = 0; day < 24; day++) advance(world)
  assert.equal(world.factories.length, count)
  assert.equal(survey(world).building, 0)
  assert.ok(survey(world).green > 0)
})

test('same seed and decisions reproduce the same mission', () => {
  const a = createWorld(48)
  const b = createWorld(48)
  for (let day = 0; day < 80; day++) {
    a.policy = b.policy = day < 30 ? 'balance' : 'restore'
    advance(a)
    advance(b)
  }
  assert.deepEqual(a, b)
  assert.notDeepEqual(createWorld(48).tiles, createWorld(49).tiles)
})
