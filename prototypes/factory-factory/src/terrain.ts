import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { BUILD_COST, GREEN, SIZE, workArea } from './simulation.ts'
import type { Tile, WorkPlan, World } from './simulation.ts'
import { createBursts, createLineage } from './terrain-effects.ts'
import type { EffectKind, LineagePath } from './terrain-effects.ts'

export type MapMode = 'surface' | 'ore' | 'ice'

const ground = new THREE.Color(0x76422f)
const ridge = new THREE.Color(0xd59863)
const frost = new THREE.Color(0x85abb5)
const verdant = new THREE.Color(0x67ae50)
const empty = new THREE.Color(0x353d3a)
const oreColor = new THREE.Color(0xe9a554)
const iceColor = new THREE.Color(0x70c9f2)
const box = new THREE.BoxGeometry(1, 1, 1)
const casing = new THREE.MeshLambertMaterial({ color: 0xefe2bf })
const dark = new THREE.MeshLambertMaterial({ color: 0x3b4945 })
const solar = new THREE.MeshLambertMaterial({ color: 0x66818c })
const beacon = new THREE.MeshBasicMaterial({ color: 0xffbd58 })
const onlineLight = new THREE.MeshBasicMaterial({ color: 0x85f7fa })
const scaffold = new THREE.MeshBasicMaterial({ color: 0xffbb58, wireframe: true })
const crewColor = new THREE.Color(0xc2a6ff)
const crewLight = new THREE.MeshBasicMaterial({ color: crewColor })

function block(parent: THREE.Group, material: THREE.Material, width: number, height: number, depth: number, x: number, y: number, z: number) {
  const mesh = new THREE.Mesh(box, material)
  mesh.scale.set(width, height, depth)
  mesh.position.set(x, y, z)
  parent.add(mesh)
  return mesh
}

function factoryModel() {
  const group = new THREE.Group()
  const outline = new THREE.Group()
  outline.position.y = .055
  block(outline, beacon, .72, .025, .024, 0, 0, .35)
  block(outline, beacon, .72, .025, .024, 0, 0, -.35)
  block(outline, beacon, .024, .025, .72, .35, 0, 0)
  block(outline, beacon, .024, .025, .72, -.35, 0, 0)
  group.add(outline)

  const body = new THREE.Group()
  block(body, dark, .69, .085, .62, 0, .045, 0)
  block(body, casing, .38, .3, .45, .095, .19, .05)
  block(body, dark, .15, .07, .08, .12, .22, .29)
  block(body, dark, .12, .15, .13, .17, .39, -.06)
  const lamp = block(body, onlineLight, .15, .075, .15, .17, .49, -.06)
  const frame = block(outline, scaffold, .54, .46, .49, .07, .265, .015)
  const panel = block(body, solar, .23, .04, .50, -.22, .20, -.045)
  panel.rotation.z = -.26
  group.add(body)
  const crew = new THREE.Group()
  for (let slot = 0; slot < 4; slot++) block(crew, crewLight, .13, .075, .13, -.29 + slot * .19, .13, .36)
  group.add(crew)
  return { group, outline, body, lamp, crew, frame, scale: 1, commissionAt: 0 }
}

export function showTerrain(host: HTMLElement, onSelect: (index: number) => void) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
  renderer.domElement.setAttribute('aria-label', '着陸区域の3D地図。矢印キーで隣の区画を調査')
  renderer.domElement.tabIndex = 0
  host.appendChild(renderer.domElement)

  const scene = new THREE.Scene()
  const motion = matchMedia('(prefers-reduced-motion: reduce)')
  const bursts = createBursts(scene)
  const lineage = createLineage(scene)
  scene.add(new THREE.HemisphereLight(0xdfebe9, 0x372a41, 1.92))
  const sun = new THREE.DirectionalLight(0xffe1bb, 2.48)
  sun.position.set(-10, 22, 8)
  scene.add(sun)

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .1, 150)
  camera.position.set(22, 32, 27)
  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enablePan = false
  controls.minZoom = .76
  controls.maxZoom = 2.8
  controls.minPolarAngle = .30
  controls.maxPolarAngle = 1.05
  controls.target.set(0, .2, 0)
  controls.update()

  const terrain = new THREE.InstancedMesh(box, new THREE.MeshLambertMaterial(), SIZE * SIZE)
  scene.add(terrain)
  const plateGeometry = new THREE.BoxGeometry(SIZE + .26, .44, SIZE + .26)
  const plate = new THREE.Mesh(plateGeometry, new THREE.MeshLambertMaterial({ color: 0x323641 }))
  plate.position.y = -.24
  plate.add(new THREE.LineSegments(new THREE.EdgesGeometry(plateGeometry), new THREE.LineBasicMaterial({ color: 0x536473 })))
  scene.add(plate)

  const foliage = new THREE.InstancedMesh(new THREE.ConeGeometry(.16, .40, 4), new THREE.MeshLambertMaterial(), SIZE * SIZE * 3)
  foliage.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  foliage.count = 0
  foliage.frustumCulled = false
  scene.add(foliage)

  const selection = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-.475, 0, -.475), new THREE.Vector3(.475, 0, -.475),
    new THREE.Vector3(.475, 0, .475), new THREE.Vector3(-.475, 0, .475),
  ]), new THREE.LineBasicMaterial({ color: 0xffebaf, depthTest: false }))
  selection.renderOrder = 2
  scene.add(selection)

  const factoryModels: ReturnType<typeof factoryModel>[] = []
  const ray = new THREE.Raycaster()
  const pointer = new THREE.Vector2()
  const transform = new THREE.Object3D()
  const color = new THREE.Color()
  const leaves = new THREE.Color(0xa4d975)
  const shade = new THREE.Color(0x497f3e)
  const leafColors = Array.from({ length: 3 }, (_, index) => shade.clone().lerp(leaves, index * .36))
  const displayedGreen = new Float32Array(SIZE * SIZE)
  const greenTransitions = new Map<number, { from: number; to: number; start: number }>()
  let deposits: Pick<Tile, 'ore' | 'ice' | 'green'>[] = []
  let priorRemaining: number[] = []
  let map: { world: World; mode: MapMode; reach?: Set<Tile> } | undefined
  let frame: number | undefined
  let previousFrame = performance.now()
  let selected = 0

  const surfacePosition = (world: World, index: number, offset = 0) => {
    const tile = world.tiles[index]
    return new THREE.Vector3(tile.x - (SIZE - 1) / 2, tile.elevation + offset, tile.z - (SIZE - 1) / 2)
  }

  function paintTerrain() {
    if (!map) return
    const { world, mode, reach } = map
    let trees = 0
    for (const [index, tile] of world.tiles.entries()) {
      const green = displayedGreen[index]
      if (mode === 'surface') {
        color.copy(ground).lerp(ridge, Math.min(1, tile.elevation))
        color.lerp(frost, Math.max(0, tile.ice - 3) / 21)
        color.lerp(verdant, green / GREEN)
        if (reach?.has(tile)) color.lerp(crewColor, .16)
        const size = Math.max(0, (green - 1.8) / 3.2)
        if (size > 0) {
          for (let leaf = 0; leaf < 3; leaf++) {
            const angle = index * 1.39 + leaf * 2.094
            transform.position.set(
              tile.x - (SIZE - 1) / 2 + Math.cos(angle) * .27,
              tile.elevation + size * (.12 + leaf * .025),
              tile.z - (SIZE - 1) / 2 + Math.sin(angle) * .27,
            )
            transform.scale.set(size, size * (.7 + leaf * .22), size)
            transform.rotation.y = angle
            transform.updateMatrix()
            foliage.setMatrixAt(trees, transform.matrix)
            foliage.setColorAt(trees++, leafColors[leaf])
          }
        }
      } else {
        color.copy(empty).lerp(mode === 'ice' ? iceColor : oreColor, Math.min(1, tile[mode] / 11))
      }
      terrain.setColorAt(index, color)
    }
    foliage.count = trees
    if (trees) {
      foliage.instanceMatrix.needsUpdate = true
      if (foliage.instanceColor) foliage.instanceColor.needsUpdate = true
    }
    if (terrain.instanceColor) terrain.instanceColor.needsUpdate = true
  }

  function requestDraw() {
    if (frame === undefined) frame = requestAnimationFrame(draw)
  }

  function draw(now: number) {
    frame = undefined
    const animate = !motion.matches
    const elapsed = Math.min(40, Math.max(1, now - previousFrame))
    previousFrame = now
    if (greenTransitions.size) {
      for (const [i, change] of greenTransitions) {
        const time = animate ? Math.min(1, Math.max(0, (now - change.start) / 740)) : 1
        displayedGreen[i] = THREE.MathUtils.lerp(change.from, change.to, 1 - (1 - time) ** 3)
        if (time === 1) greenTransitions.delete(i)
      }
      paintTerrain()
    }
    let building = false
    for (const model of factoryModels) {
      if (!model.group.visible) continue
      const commissioning = animate && now < model.commissionAt
      const target = commissioning ? .45 : model.scale
      const current = model.body.scale.y
      const next = !animate || Math.abs(current - target) < .007
        ? target
        : THREE.MathUtils.lerp(current, target, 1 - Math.exp(-elapsed / 165))
      model.body.scale.y = next
      model.outline.visible = commissioning || model.scale < 1
      model.lamp.visible = !model.outline.visible
      model.frame.position.y = animate ? .26 + Math.sin(now / 140 + model.group.position.x) * .052 : .26
      building ||= model.outline.visible || next !== model.scale
    }
    if (!animate) bursts.clear()
    const emitting = bursts.update(now)
    const transmitting = lineage.update(now, animate)
    renderer.render(scene, camera)
    if (animate && (building || emitting || transmitting || greenTransitions.size)) requestDraw()
  }
  motion.addEventListener('change', requestDraw)

  const resize = new ResizeObserver(() => {
    const { clientWidth: width, clientHeight: height } = host
    if (!width || !height) return
    const aspect = width / height
    const span = Math.max(22, 25.8 / aspect)
    camera.left = -span * aspect / 2
    camera.right = -camera.left
    camera.top = span / 2
    camera.bottom = -camera.top
    camera.updateProjectionMatrix()
    renderer.setSize(width, height, false)
    requestDraw()
  })
  resize.observe(host)
  controls.addEventListener('change', requestDraw)

  let origin = { x: 0, y: 0 }
  renderer.domElement.addEventListener('pointerdown', event => {
    origin = { x: event.clientX, y: event.clientY }
  })
  renderer.domElement.addEventListener('pointerup', event => {
    if (event.button !== 0 || Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 5) return
    const bounds = renderer.domElement.getBoundingClientRect()
    pointer.set(
      (event.clientX - bounds.left) / bounds.width * 2 - 1,
      1 - (event.clientY - bounds.top) / bounds.height * 2,
    )
    ray.setFromCamera(pointer, camera)
    const hit = ray.intersectObject(terrain)[0]?.instanceId
    if (hit !== undefined) onSelect(hit)
  })
  renderer.domElement.addEventListener('keydown', event => {
    const x = selected % SIZE
    const z = Math.floor(selected / SIZE)
    const offsets = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }
    const offset = offsets[event.key as keyof typeof offsets]
    if (!offset) return
    event.preventDefault()
    const nextX = Math.min(SIZE - 1, Math.max(0, x + offset[0]))
    const nextZ = Math.min(SIZE - 1, Math.max(0, z + offset[1]))
    onSelect(nextZ * SIZE + nextX)
  })

  let geometry: World['tiles'] | undefined
  const visited = new WeakSet<World>()

  return function render(world: World, mode: MapMode, index: number, deployment?: { plan: WorkPlan; factory: number }) {
    const newTerrain = geometry !== world.tiles
    const animate = !motion.matches
    const now = performance.now()
    if (newTerrain) {
      geometry = world.tiles
      greenTransitions.clear()
      bursts.clear()
    }
    selected = index
    map = { world, mode, reach: deployment && new Set(workArea(world, world.factories[deployment.factory].tile)) }
    const counts = { ore: 0, ice: 0, green: 0, build: 0, online: 0 }
    function emit(kind: EffectKind, tile: number, limit: number, delay = 0) {
      if (!animate || counts[kind] >= limit) return
      bursts.emit(kind, surfacePosition(world, tile, .08), now + delay + 40 * counts[kind]++)
    }

    if (newTerrain && !visited.has(world)) {
      if (world.day === 0) emit('online', world.factories[0].tile, 1)
      visited.add(world)
    }
    for (const [tileIndex, tile] of world.tiles.entries()) {
      if (newTerrain) {
        transform.position.copy(surfacePosition(world, tileIndex))
        transform.position.y /= 2
        transform.scale.set(.956, tile.elevation, .956)
        transform.rotation.y = 0
        transform.updateMatrix()
        terrain.setMatrixAt(tileIndex, transform.matrix)
        displayedGreen[tileIndex] = tile.green
      } else {
        const previous = deposits[tileIndex]
        if (previous.ore > tile.ore) emit('ore', tileIndex, 5)
        if (previous.ice > tile.ice) emit('ice', tileIndex, 5)
        if (previous.green < tile.green) {
          emit('green', tileIndex, 6)
          if (animate) greenTransitions.set(tileIndex, { from: displayedGreen[tileIndex], to: tile.green, start: now })
          else displayedGreen[tileIndex] = tile.green
        }
      }
      deposits[tileIndex] = { ore: tile.ore, ice: tile.ice, green: tile.green }
    }
    if (newTerrain) {
      terrain.instanceMatrix.needsUpdate = true
      terrain.computeBoundingSphere()
    }
    paintTerrain()

    const paths: LineagePath[] = []
    for (const factory of world.factories) {
      let model = factoryModels[factory.id]
      if (!model) {
        model = factoryModel()
        scene.add(model.group)
        factoryModels.push(model)
      }
      model.group.position.copy(surfacePosition(world, factory.tile))
      model.group.visible = true
      model.scale = 1 - factory.remaining / (BUILD_COST.days + 1)
      const previous = priorRemaining[factory.id]
      if (newTerrain || !animate) {
        model.body.scale.y = model.scale
        model.commissionAt = 0
      } else if (previous === undefined) {
        model.body.scale.y = .05
        emit('build', factory.tile, 6)
        model.commissionAt = factory.remaining === 0 ? now + 420 : 0
        if (!factory.remaining) emit('online', factory.tile, 6, 420)
      } else if (previous > 0 && factory.remaining === 0) {
        emit('online', factory.tile, 6)
      }
      const assigned = deployment?.plan.get(factory.id)?.size ?? 0
      model.crew.children.forEach((marker, slot) => { marker.visible = slot < assigned })
      priorRemaining[factory.id] = factory.remaining
      if (factory.parent !== null) {
        const parent = world.factories[factory.parent]
        paths.push({
          from: surfacePosition(world, parent.tile, .61),
          to: surfacePosition(world, factory.tile, .61),
          building: factory.remaining > 0,
          focused: factory.tile === selected || parent.tile === selected,
        })
      }
    }
    priorRemaining.length = world.factories.length
    for (let i = world.factories.length; i < factoryModels.length; i++) factoryModels[i].group.visible = false
    lineage.replace(paths)
    selection.position.copy(surfacePosition(world, selected, .025))
    requestDraw()
  }
}
