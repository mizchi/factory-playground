import * as THREE from 'three'
import { LineMaterial } from 'three/addons/lines/LineMaterial.js'
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js'
import { SIZE } from './simulation.ts'

export type EffectKind = 'ore' | 'ice' | 'build' | 'online' | 'green'

const visuals = {
  ore: { color: 0xffa448, duration: 770, radius: .58, sparks: 9, beam: 0 },
  ice: { color: 0x68d5ff, duration: 770, radius: .58, sparks: 9, beam: 0 },
  build: { color: 0xffb141, duration: 1360, radius: 1.12, sparks: 16, beam: 1.85 },
  online: { color: 0x54faff, duration: 1520, radius: 1.85, sparks: 20, beam: 2.6 },
  green: { color: 0x92ff62, duration: 1180, radius: 1.1, sparks: 13, beam: 0 },
} satisfies Record<EffectKind, {color: number; duration: number; radius: number; sparks: number; beam: number}>

const MAX_BURSTS = 28
const ringGeometry = new THREE.RingGeometry(.89, 1, 48).rotateX(-Math.PI / 2)
const beamGeometry = new THREE.CylinderGeometry(.18, .31, 1, 12, 1, true)
const sparkGeometry = new THREE.OctahedronGeometry(1)

function glowTexture() {
  const side = 64
  const data = new Uint8Array(side * side * 4)
  for (let z = 0; z < side; z++) {
    for (let x = 0; x < side; x++) {
      const radius = Math.hypot(x - 31.5, z - 31.5) / 31
      const i = (z * side + x) * 4
      data[i] = data[i + 1] = data[i + 2] = 255
      data[i + 3] = Math.round(255 * Math.max(0, 1 - radius) ** 2)
    }
  }
  const texture = new THREE.DataTexture(data, side, side)
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearFilter
  texture.needsUpdate = true
  return texture
}

export function createBursts(scene: THREE.Scene) {
  const glow = glowTexture()
  const sparks = new THREE.InstancedMesh(sparkGeometry, new THREE.MeshBasicMaterial(), MAX_BURSTS * 20)
  sparks.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  sparks.frustumCulled = false
  sparks.count = 0
  scene.add(sparks)

  const transform = new THREE.Object3D()
  const sparkColor = new THREE.Color()
  const white = new THREE.Color(0xffffff)

  function create(kind: EffectKind, position: THREE.Vector3, start: number) {
    const visual = visuals[kind]
    const group = new THREE.Group()
    group.position.copy(position)
    const material = new THREE.MeshBasicMaterial({
      color: visual.color, transparent: true, depthWrite: false,
    })
    const ring = new THREE.Mesh(ringGeometry, material)
    const echo = new THREE.Mesh(ringGeometry, material)
    echo.position.y = .02
    group.add(ring, echo)

    const flare = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glow, color: visual.color, blending: THREE.AdditiveBlending, depthWrite: false,
    }))
    flare.position.y = .18
    group.add(flare)

    const beam = new THREE.Mesh(beamGeometry, material)
    if (visual.beam) group.add(beam)
    group.visible = false
    scene.add(group)
    return { visual, group, ring, echo, flare, beam, material, start }
  }

  type Burst = ReturnType<typeof create>
  const bursts: Burst[] = []

  function remove(burst: Burst) {
    scene.remove(burst.group)
    burst.material.dispose()
    burst.flare.material.dispose()
  }

  function emit(kind: EffectKind, position: THREE.Vector3, start: number) {
    if (bursts.length === MAX_BURSTS) remove(bursts.shift()!)
    bursts.push(create(kind, position, start))
  }

  function clear() {
    for (const burst of bursts) remove(burst)
    bursts.length = 0
    sparks.count = 0
  }

  function update(now: number) {
    let count = 0
    for (let index = bursts.length - 1; index >= 0; index--) {
      const burst = bursts[index]
      const { visual, group, ring, echo, flare, beam, material, start } = burst
      const time = (now - start) / visual.duration
      if (time < 0) continue
      if (time >= 1) {
        remove(burst)
        bursts.splice(index, 1)
        continue
      }
      group.visible = true
      const spread = 1 - (1 - time) ** 2
      const fade = (1 - time) ** 1.3
      ring.scale.setScalar(.10 + visual.radius * spread)
      echo.scale.setScalar(.07 + visual.radius * spread * .68)
      material.opacity = fade * .93
      flare.scale.setScalar((.45 + spread) * visual.radius * 2.65)
      flare.material.opacity = fade * .9
      const height = visual.beam * Math.sin(Math.PI * Math.min(1, .12 + time * .88))
      beam.position.y = height * .5
      beam.scale.set(1 + time * .9, height, 1 + time * .9)
      for (let i = 0; i < visual.sparks; i++) {
        const angle = i * 2.39996 + group.position.x
        const radius = visual.radius * spread * (.32 + (i % 5) * .14)
        const lift = (.6 + (i % 7) * .14) * Math.sin(Math.PI * time ** .70)
        transform.position.set(group.position.x + Math.cos(angle) * radius, group.position.y + lift, group.position.z + Math.sin(angle) * radius)
        transform.rotation.set(time * 5 + i, time * 3, 0)
        transform.scale.setScalar((.038 + (i % 3) * .023) * Math.sqrt(fade))
        transform.updateMatrix()
        sparks.setMatrixAt(count, transform.matrix)
        sparkColor.setHex(visual.color).lerp(white, (i % 4) * .12)
        sparks.setColorAt(count++, sparkColor)
      }
    }
    sparks.count = count
    if (count) {
      sparks.instanceMatrix.needsUpdate = true
      if (sparks.instanceColor) sparks.instanceColor.needsUpdate = true
    }
    return bursts.length > 0
  }

  return { emit, update, clear }
}

export interface LineagePath {
  from: THREE.Vector3
  to: THREE.Vector3
  building: boolean
  focused: boolean
}

export function createLineage(scene: THREE.Scene) {
  const segments = 8
  const capacity = SIZE * SIZE
  const points = new Float32Array(capacity * segments * 6)
  const colors = new Float32Array(points.length)
  const geometry = new LineSegmentsGeometry().setPositions(points).setColors(colors)
  const positions = (geometry.getAttribute('instanceStart') as THREE.InterleavedBufferAttribute).data
  const tint = (geometry.getAttribute('instanceColorStart') as THREE.InterleavedBufferAttribute).data
  positions.setUsage(THREE.DynamicDrawUsage)
  tint.setUsage(THREE.DynamicDrawUsage)
  geometry.instanceCount = 0
  const lines = new LineSegments2(geometry, new LineMaterial({
    linewidth: 2, vertexColors: true, transparent: true, opacity: .87, depthTest: false, depthWrite: false,
  }))
  lines.frustumCulled = false
  lines.renderOrder = 1
  scene.add(lines)

  const signals = new THREE.InstancedMesh(sparkGeometry, new THREE.MeshBasicMaterial({ depthTest: false }), capacity)
  signals.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  signals.frustumCulled = false
  signals.renderOrder = 2
  signals.count = 0
  scene.add(signals)

  const activeColor = new THREE.Color(0x65e8ec)
  const constructionColor = new THREE.Color(0xffbf58)
  const point = new THREE.Vector3()
  const color = new THREE.Color()
  const transform = new THREE.Object3D()
  let paths: LineagePath[] = []

  function sample(path: LineagePath, time: number) {
    point.lerpVectors(path.from, path.to, time)
    point.y += Math.sin(time * Math.PI) * .44
    return point
  }

  function replace(next: LineagePath[]) {
    paths = next
    let cursor = 0
    for (const [index, path] of paths.entries()) {
      const accent = path.building ? constructionColor : activeColor
      for (let i = 0; i < segments; i++) {
        for (const time of [i / segments, (i + 1) / segments]) {
          sample(path, time).toArray(points, cursor)
          color.copy(accent).multiplyScalar((path.focused ? .95 : .42) * (.61 + time * .39)).toArray(colors, cursor)
          cursor += 3
        }
      }
      signals.setColorAt(index, accent)
    }
    geometry.instanceCount = cursor / 6
    positions.needsUpdate = tint.needsUpdate = true
    if (signals.instanceColor) signals.instanceColor.needsUpdate = true
  }

  function update(now: number, animate: boolean) {
    signals.count = animate ? paths.length : 0
    if (!signals.count) return false
    for (const [index, path] of paths.entries()) {
      const phase = (now / 1220 + index * .27) % 1
      transform.position.copy(sample(path, phase))
      transform.scale.setScalar((path.focused ? .115 : .075) * Math.sin(phase * Math.PI) ** .4)
      transform.updateMatrix()
      signals.setMatrixAt(index, transform.matrix)
    }
    signals.instanceMatrix.needsUpdate = true
    return true
  }

  return { replace, update }
}
