import assert from 'node:assert/strict'
import { test } from 'node:test'
import { assign, createPlacement, playTurn, unassign, workersAvailable } from './placement.ts'
import { survey } from './simulation.ts'

test('a crew occupies one factory job and shifts consume scarce crews and local power', () => {
  const game = createPlacement()
  const home = game.world.factories[0]
  assert.equal(workersAvailable(game), 3)
  assert.equal(assign(game, 0, 'ore'), true)
  assert.equal(assign(game, 0, 'ore'), false)
  assert.equal(assign(game, 0, 'build'), true)
  assert.equal(assign(game, 0, 'terraform'), false)
  assert.equal(assign(game, 0, 'ice'), true)
  assert.equal(workersAvailable(game), 0)
  assert.equal(assign(game, 1, 'ice'), false)
  unassign(game, 0, 'build')
  assert.equal(workersAvailable(game), 1)
  assert.equal(assign(game, 0, 'build'), true)
  assert.equal(playTurn(game)?.ore, 15)
  assert.equal(game.world.day, 5)
  assert.equal(survey(game.world).green, 0)
  assert.equal(home.ore, 3)
  assert.equal(survey(game.world).building, 1)
  assert.equal(workersAvailable(game), 3)
})

test('a child unlocks a new deployment site and recruits one crew after entering service', () => {
  const game = createPlacement()
  for (const job of ['ore', 'ice'] as const) assert.equal(assign(game, 0, job), true)
  playTurn(game)
  assert.equal(assign(game, 0, 'build'), true)
  assert.equal(assign(game, 1, 'ice'), false)
  assert.equal(playTurn(game)?.started, 1)
  assert.equal(game.world.day, 10)
  assert.equal(survey(game.world).active, 2)
  assert.equal(workersAvailable(game), 4)
  assign(game, 1, 'ice')
  assign(game, 1, 'terraform')
  const shift = playTurn(game)
  assert.ok(shift && shift.ice > 0 && shift.green > 0)
  assert.equal(game.world.factories[0].activity.length, 0)
})

test('the deadline ends deployment and returns a result without advancing past day 40', () => {
  const game = createPlacement()
  assert.equal(playTurn(game), null)
  for (let turn = 0; turn < 8; turn++) {
    assign(game, 0, 'ice')
    assign(game, 0, 'terraform')
    assert.ok(playTurn(game))
  }
  assert.equal(game.world.day, 40)
  assert.equal(assign(game, 0, 'ore'), false)
  assert.equal(playTurn(game), null)
})
