import { useEffect, useRef } from 'react'
import * as THREE from 'three'

const MAX_PIXEL_RATIO = 1.35
const FRAME_INTERVAL = 1000 / 30

function graniteGeometry(): THREE.SphereGeometry {
  const geometry = new THREE.SphereGeometry(1, 24, 16)
  const positions = geometry.attributes.position
  const direction = new THREE.Vector3()
  for (let index = 0; index < positions.count; index += 1) {
    direction.fromBufferAttribute(positions, index)
    const radius = 1 + Math.sin(direction.x * 5.3 + direction.y * 2.1) * 0.055 + Math.cos(direction.z * 6.7 - direction.y * 3.2) * 0.045
    direction.normalize().multiplyScalar(radius)
    positions.setXYZ(index, direction.x, direction.y, direction.z)
  }
  geometry.computeVertexNormals()
  return geometry
}

export type HabitatZone = 'library' | 'wanted' | 'imports' | 'activity'

interface EcoSceneProps {
  zone: HabitatZone
  section: 'albums' | 'artists' | 'songs'
  activity: number
  playing: boolean
}

const ZONE_LOOK_AT: Record<HabitatZone, [number, number, number]> = {
  library: [1.4, -0.6, -4],
  wanted: [-3.2, -0.3, -5],
  imports: [3.8, -0.45, -6],
  activity: [0, 0.1, -8],
}

/** Arcadia's slow-moving dry-tropical shoreline, shared by every library view. */
export default function EcoScene({ zone, section, activity, playing }: EcoSceneProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const stateRef = useRef({ zone, section, activity, playing })

  useEffect(() => {
    stateRef.current = { zone, section, activity, playing }
  }, [zone, section, activity, playing])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0xf1c992)
    scene.fog = new THREE.Fog(0xe8b77e, 14, 46)

    const camera = new THREE.PerspectiveCamera(43, 1, 0.1, 70)
    camera.position.set(0, 4.8, 11)

    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'low-power' })
    } catch {
      return
    }
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.05
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO))
    renderer.domElement.style.cssText = 'display:block;width:100%;height:100%'
    renderer.domElement.setAttribute('aria-hidden', 'true')
    host.appendChild(renderer.domElement)

    const skyLight = new THREE.HemisphereLight(0xffe4b6, 0x496f5b, 2.25)
    scene.add(skyLight)
    const sunLight = new THREE.DirectionalLight(0xffc46b, 3.4)
    sunLight.position.set(-8, 10, 5)
    scene.add(sunLight)
    const lagoonLight = new THREE.DirectionalLight(0x6fc6bd, 0.75)
    lagoonLight.position.set(5, 1, 4)
    scene.add(lagoonLight)

    const sunMaterial = new THREE.MeshBasicMaterial({ color: 0xffe2a2, transparent: true, opacity: 0.92 })
    const sun = new THREE.Mesh(new THREE.SphereGeometry(1.7, 24, 16), sunMaterial)
    sun.position.set(-8.5, 7, -19)
    scene.add(sun)

    const oceanGeometry = new THREE.PlaneGeometry(56, 40, 34, 24)
    const oceanBase = new Float32Array(oceanGeometry.attributes.position.array)
    const oceanMaterial = new THREE.MeshStandardMaterial({ color: 0x438e98, roughness: 0.34, metalness: 0.06, transparent: true, opacity: 0.94, flatShading: false })
    const ocean = new THREE.Mesh(oceanGeometry, oceanMaterial)
    ocean.rotation.x = -Math.PI / 2
    ocean.position.set(0, -2.15, -8)
    scene.add(ocean)

    const glimmerGeometry = new THREE.PlaneGeometry(4.8, 30)
    const glimmerMaterial = new THREE.MeshBasicMaterial({ color: 0xffdd9c, transparent: true, opacity: 0.13, blending: THREE.AdditiveBlending, depthWrite: false })
    const glimmer = new THREE.Mesh(glimmerGeometry, glimmerMaterial)
    glimmer.rotation.x = -Math.PI / 2
    glimmer.rotation.z = -0.08
    glimmer.position.set(-5.1, -2.07, -7)
    scene.add(glimmer)

    const island = new THREE.Group()
    island.position.set(0, -1.5, -14)
    scene.add(island)
    const graniteMaterials = [0xa87767, 0xb48670, 0x8d675d, 0xbf9477].map(color => new THREE.MeshStandardMaterial({ color, roughness: 0.96, metalness: 0 }))
    const boulderGeometry = graniteGeometry()
    const boulders: THREE.Mesh[] = []
    const boulderPositions: [number, number, number, number][] = [
      [-8.5, 0.1, 0, 2.7], [-6.2, 0.45, -1, 2.25], [-3.7, 0.05, 0.5, 1.8],
      [2.8, 0.1, -1.5, 1.85], [5.4, 0.35, -1, 2.35], [8.2, 0.05, 0.4, 2.8],
    ]
    boulderPositions.forEach(([x, y, z, scale], index) => {
      const boulder = new THREE.Mesh(boulderGeometry, graniteMaterials[index % graniteMaterials.length])
      boulder.position.set(x, y, z)
      boulder.rotation.set(index * 0.34, index * 0.72, index * 0.15)
      boulder.scale.set(scale, scale * (0.65 + index % 2 * 0.12), scale * 0.85)
      island.add(boulder)
      boulders.push(boulder)
    })

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(30, 8),
      new THREE.MeshStandardMaterial({ color: 0x7c8f55, roughness: 1, metalness: 0 }),
    )
    ground.rotation.x = -Math.PI / 2
    ground.position.y = -0.75
    island.add(ground)

    const trunkGeometry = new THREE.CylinderGeometry(0.08, 0.15, 2.2, 7)
    const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x76513b, roughness: 1 })
    const crownGeometry = new THREE.SphereGeometry(0.72, 16, 12)
    const foliageMaterials = [0x446b4d, 0x577a4d, 0x70834f].map(color => new THREE.MeshStandardMaterial({ color, roughness: 1 }))
    const trees: THREE.Group[] = []
    ;[-7.1, -4.7, 3.9, 6.7].forEach((x, index) => {
      const tree = new THREE.Group()
      const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial)
      trunk.position.y = 0.85
      tree.add(trunk)
      const crown = new THREE.Mesh(crownGeometry, foliageMaterials[index % foliageMaterials.length])
      crown.position.y = 2.05
      crown.scale.set(0.85, 1.3, 0.8)
      tree.add(crown)
      tree.position.set(x, 0, -0.4 + index % 2 * 0.5)
      tree.rotation.z = index % 2 ? 0.08 : -0.06
      tree.userData.baseRotation = tree.rotation.z
      island.add(tree)
      trees.push(tree)
    })

    const birdMaterial = new THREE.LineBasicMaterial({ color: 0x5a493d, transparent: true, opacity: 0.5 })
    const birds = Array.from({ length: 4 }, (_, index) => {
      const geometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-0.3, 0, 0), new THREE.Vector3(0, -0.12, 0), new THREE.Vector3(0.3, 0, 0),
      ])
      const bird = new THREE.Line(geometry, birdMaterial)
      bird.position.set(-6 + index * 3.2, 3.3 + index % 2 * 0.5, -9 - index)
      scene.add(bird)
      return bird
    })

    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    let reducedMotion = motionQuery.matches
    let animationFrame = 0
    let previousFrame = 0
    let pointerX = 0
    let pointerY = 0

    const draw = () => renderer.render(scene, camera)
    const animate = (time: number) => {
      animationFrame = window.requestAnimationFrame(animate)
      if (document.hidden || reducedMotion || time - previousFrame < FRAME_INTERVAL) return
      previousFrame = time
      const habitat = stateRef.current
      const positions = oceanGeometry.attributes.position
      const waveStrength = habitat.playing ? 0.14 : habitat.activity > 0 ? 0.1 : 0.055
      for (let index = 0; index < positions.count; index += 1) {
        const offset = index * 3
        const x = oceanBase[offset]
        const y = oceanBase[offset + 1]
        positions.setZ(index, Math.sin(x * 0.4 + time * 0.00045) * waveStrength + Math.cos(y * 0.55 - time * 0.00032) * waveStrength * 0.65)
      }
      positions.needsUpdate = true
      if (Math.floor(time / 250) !== Math.floor((time - FRAME_INTERVAL) / 250)) oceanGeometry.computeVertexNormals()
      const target = ZONE_LOOK_AT[habitat.zone]
      const sectionShift = habitat.section === 'artists' ? -0.45 : habitat.section === 'songs' ? 0.45 : 0
      camera.position.x += (pointerX + sectionShift - camera.position.x) * 0.018
      camera.position.y += (4.8 + pointerY - camera.position.y) * 0.018
      camera.lookAt(target[0] * 0.16, target[1], target[2])
      glimmerMaterial.opacity = 0.1 + Math.sin(time * 0.0011) * 0.025 + (habitat.playing ? 0.06 : 0)
      sunMaterial.opacity = 0.88 + Math.sin(time * 0.00035) * 0.06
      sunLight.intensity = 3.2 + (habitat.playing ? Math.sin(time * 0.002) * 0.22 : 0) + Math.min(habitat.activity, 4) * 0.08
      trees.forEach((tree, index) => { tree.rotation.z = Number(tree.userData.baseRotation) + Math.sin(time * 0.00065 + index) * (habitat.playing ? 0.025 : 0.012) })
      birds.forEach((bird, index) => {
        bird.position.x += 0.004 + index * 0.0007
        bird.position.y += Math.sin(time * 0.0008 + index) * 0.0008
        if (bird.position.x > 8) bird.position.x = -8
      })
      boulders.forEach((boulder, index) => { boulder.rotation.y += habitat.playing ? 0.00004 * (index % 2 ? 1 : -1) : 0 })
      draw()
    }
    const startAnimation = () => {
      if (animationFrame || document.hidden || reducedMotion) return
      animationFrame = window.requestAnimationFrame(animate)
    }
    const stopAnimation = () => {
      if (animationFrame) window.cancelAnimationFrame(animationFrame)
      animationFrame = 0
    }
    const resize = () => {
      const width = Math.max(host.clientWidth, 1)
      const height = Math.max(host.clientHeight, 1)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO))
      renderer.setSize(width, height, false)
      draw()
    }
    const onVisibilityChange = () => document.hidden ? stopAnimation() : startAnimation()
    const onPointerMove = (event: PointerEvent) => {
      if (reducedMotion) return
      pointerX = ((event.clientX / window.innerWidth) - 0.5) * 1.8
      pointerY = -((event.clientY / window.innerHeight) - 0.5) * 0.5
    }
    const onMotionChange = (event: MediaQueryListEvent) => {
      reducedMotion = event.matches
      if (reducedMotion) { stopAnimation(); draw() } else startAnimation()
    }

    window.addEventListener('resize', resize)
    window.addEventListener('pointermove', onPointerMove, { passive: true })
    document.addEventListener('visibilitychange', onVisibilityChange)
    motionQuery.addEventListener('change', onMotionChange)
    resize()
    startAnimation()

    return () => {
      stopAnimation()
      window.removeEventListener('resize', resize)
      window.removeEventListener('pointermove', onPointerMove)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      motionQuery.removeEventListener('change', onMotionChange)
      scene.traverse(object => {
        if (!(object instanceof THREE.Mesh || object instanceof THREE.Line)) return
        object.geometry.dispose()
        const materials = Array.isArray(object.material) ? object.material : [object.material]
        materials.forEach(material => material.dispose())
      })
      renderer.dispose()
      renderer.forceContextLoss()
      renderer.domElement.remove()
      scene.clear()
    }
  }, [])

  return <div ref={hostRef} className="eco-scene" aria-hidden="true" />
}
