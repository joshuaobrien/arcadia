import { useEffect, useRef } from 'react'
import * as THREE from 'three'

const MAX_PIXEL_RATIO = 1.75

/** Decorative, self-contained ambient habitat scene for page backgrounds. */
export default function EcoScene() {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x071d22)
    scene.fog = new THREE.FogExp2(0x071d22, 0.075)

    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 80)
    camera.position.set(0, 4.8, 11)
    camera.lookAt(0, -0.7, 0)

    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'low-power' })
    } catch {
      return
    }
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO))
    renderer.domElement.style.display = 'block'
    renderer.domElement.style.width = '100%'
    renderer.domElement.style.height = '100%'
    renderer.domElement.setAttribute('aria-hidden', 'true')
    host.appendChild(renderer.domElement)

    scene.add(new THREE.HemisphereLight(0x8bd8c8, 0x10162b, 1.7))
    const coralLight = new THREE.DirectionalLight(0xff806f, 1.25)
    coralLight.position.set(-4, 7, 5)
    scene.add(coralLight)
    const violetLight = new THREE.PointLight(0x8668c8, 12, 14)
    violetLight.position.set(5, 2, -2)
    scene.add(violetLight)

    const terrainGeometry = new THREE.PlaneGeometry(18, 14, 20, 14)
    const terrainPositions = terrainGeometry.attributes.position
    for (let index = 0; index < terrainPositions.count; index += 1) {
      const x = terrainPositions.getX(index)
      const y = terrainPositions.getY(index)
      const rise = Math.sin(x * 0.78) * 0.3 + Math.cos(y * 0.61) * 0.24 + Math.sin((x + y) * 1.2) * 0.1
      terrainPositions.setZ(index, rise)
    }
    terrainGeometry.computeVertexNormals()
    const terrain = new THREE.Mesh(
      terrainGeometry,
      new THREE.MeshStandardMaterial({ color: 0x164f53, roughness: 0.92, metalness: 0.04, flatShading: true }),
    )
    terrain.rotation.x = -Math.PI / 2
    terrain.position.y = -2.35
    scene.add(terrain)

    const forms = new THREE.Group()
    scene.add(forms)
    const formMaterials = [
      new THREE.MeshStandardMaterial({ color: 0x32a79d, roughness: 0.4, metalness: 0.28, flatShading: true }),
      new THREE.MeshStandardMaterial({ color: 0x7964ad, roughness: 0.52, metalness: 0.12, flatShading: true }),
      new THREE.MeshStandardMaterial({ color: 0xe67365, roughness: 0.62, metalness: 0.04, flatShading: true }),
      new THREE.MeshStandardMaterial({ color: 0x9fca62, roughness: 0.7, metalness: 0.02, flatShading: true }),
    ]
    const formGeometries: THREE.BufferGeometry[] = [
      new THREE.IcosahedronGeometry(0.85, 1),
      new THREE.OctahedronGeometry(0.72, 1),
      new THREE.ConeGeometry(0.62, 1.8, 6),
      new THREE.DodecahedronGeometry(0.58, 0),
      new THREE.IcosahedronGeometry(0.48, 0),
    ]
    const placements = [
      [-3.8, -0.8, -0.7], [-1.5, 0.45, -1.8], [1.1, -0.55, 0.3], [3.5, 0.6, -1.3], [4.7, -1.1, 1.2],
    ]
    const rotatingForms = formGeometries.map((geometry, index) => {
      const form = new THREE.Mesh(geometry, formMaterials[index % formMaterials.length])
      form.position.set(...(placements[index] as [number, number, number]))
      form.rotation.set(index * 0.4, index * 0.75, index * 0.2)
      form.scale.y = index % 2 ? 1.35 : 1
      forms.add(form)
      return form
    })

    const particleGeometry = new THREE.BufferGeometry()
    const particlePositions = new Float32Array(90 * 3)
    for (let index = 0; index < 90; index += 1) {
      particlePositions[index * 3] = (Math.random() - 0.5) * 16
      particlePositions[index * 3 + 1] = Math.random() * 7 - 2
      particlePositions[index * 3 + 2] = (Math.random() - 0.5) * 10 - 1
    }
    particleGeometry.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3))
    const particleMaterial = new THREE.PointsMaterial({ color: 0x9fcaac, size: 0.035, transparent: true, opacity: 0.48, depthWrite: false })
    const particles = new THREE.Points(particleGeometry, particleMaterial)
    scene.add(particles)

    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    let reducedMotion = motionQuery.matches
    let animationFrame = 0
    let previousTime = 0
    let cameraTargetX = 0
    let cameraTargetY = 4.8

    const draw = () => renderer.render(scene, camera)
    const animate = (time: number) => {
      animationFrame = 0
      if (document.hidden || reducedMotion) return
      const delta = Math.min((time - previousTime) / 1000 || 0, 0.05)
      previousTime = time
      rotatingForms.forEach((form, index) => {
        form.rotation.y += delta * (0.08 + index * 0.012)
        form.rotation.x += delta * 0.025
      })
      particles.rotation.y += delta * 0.012
      camera.position.x += (cameraTargetX - camera.position.x) * 0.018
      camera.position.y += (cameraTargetY - camera.position.y) * 0.018
      camera.lookAt(0, -0.7, 0)
      draw()
      animationFrame = window.requestAnimationFrame(animate)
    }
    const startAnimation = () => {
      if (animationFrame || document.hidden || reducedMotion) return
      previousTime = performance.now()
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
      cameraTargetX = ((event.clientX / window.innerWidth) - 0.5) * 0.9
      cameraTargetY = 4.8 - ((event.clientY / window.innerHeight) - 0.5) * 0.35
    }
    const onMotionChange = (event: MediaQueryListEvent) => {
      reducedMotion = event.matches
      if (reducedMotion) {
        stopAnimation()
        draw()
      } else startAnimation()
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
      terrainGeometry.dispose()
      formGeometries.forEach(geometry => geometry.dispose())
      formMaterials.forEach(material => material.dispose())
      ;(terrain.material as THREE.Material).dispose()
      particleGeometry.dispose()
      particleMaterial.dispose()
      renderer.dispose()
      renderer.forceContextLoss()
      renderer.domElement.remove()
      scene.clear()
    }
  }, [])

  return (
    <div
      ref={hostRef}
      className="eco-scene"
      aria-hidden="true"
    />
  )
}
