import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'
import * as THREE from 'three'

const BAR_COUNT = 48

interface VisualizerPalette {
  primary: THREE.Color
  secondary: THREE.Color
  accent: THREE.Color
}

function styledArtworkColor(red: number, green: number, blue: number): THREE.Color {
  const color = new THREE.Color(red / 255, green / 255, blue / 255)
  const hsl = { h: 0, s: 0, l: 0 }
  color.getHSL(hsl)
  color.setHSL(hsl.h, Math.max(0.42, hsl.s), Math.min(0.7, Math.max(0.32, hsl.l)))
  return color
}

function colorDistanceSquared(left: THREE.Color, right: THREE.Color): number {
  return (left.r - right.r) ** 2 + (left.g - right.g) ** 2 + (left.b - right.b) ** 2
}

async function extractArtworkPalette(url: string): Promise<VisualizerPalette> {
  const image = new Image()
  image.crossOrigin = 'anonymous'
  image.src = url
  await image.decode()
  const canvas = document.createElement('canvas')
  canvas.width = 32
  canvas.height = 32
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('Canvas unavailable')
  context.drawImage(image, 0, 0, 32, 32)
  const pixels = context.getImageData(0, 0, 32, 32).data
  const bins = new Map<number, { red: number; green: number; blue: number; count: number; score: number }>()
  for (let index = 0; index < pixels.length; index += 4) {
    if (pixels[index + 3] < 192) continue
    const red = pixels[index]
    const green = pixels[index + 1]
    const blue = pixels[index + 2]
    const max = Math.max(red, green, blue)
    const min = Math.min(red, green, blue)
    const lightness = (max + min) / 510
    if (lightness < 0.06 || lightness > 0.94) continue
    const saturation = max === min ? 0 : (max - min) / (255 - Math.abs(max + min - 255))
    const key = (red >> 5) << 6 | (green >> 5) << 3 | blue >> 5
    const bin = bins.get(key) ?? { red: 0, green: 0, blue: 0, count: 0, score: 0 }
    bin.red += red
    bin.green += green
    bin.blue += blue
    bin.count += 1
    bin.score += 0.35 + saturation * 1.65
    bins.set(key, bin)
  }
  const colors = [...bins.values()]
    .sort((left, right) => right.score - left.score)
    .map(bin => styledArtworkColor(bin.red / bin.count, bin.green / bin.count, bin.blue / bin.count))
  if (!colors.length) throw new Error('Artwork has no usable colors')
  const primary = colors[0]
  const distinct = colors.filter(color => colorDistanceSquared(color, primary) > 0.12)
  const secondary = distinct[0] ?? primary.clone().offsetHSL(0.14, 0, 0.08)
  const accent = distinct.find(color => colorDistanceSquared(color, secondary) > 0.1) ?? primary.clone().offsetHSL(0.48, 0.08, 0.12)
  return { primary, secondary, accent }
}

export default function NowPlayingVisualizer({ audioRef, signalTargetRef, selectionKey, artworkUrl }: { audioRef: RefObject<HTMLAudioElement | null>; signalTargetRef: RefObject<HTMLElement | null>; selectionKey: number; artworkUrl?: string }) {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = hostRef.current
    const audio = audioRef.current
    if (!host || !audio) return

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 60)
    camera.position.set(0, 4.2, 9.6)
    camera.lookAt(0, 0, 0)
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' })
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.6))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.domElement.setAttribute('aria-hidden', 'true')
    host.appendChild(renderer.domElement)

    const hemisphereLight = new THREE.HemisphereLight(0xa9ffe0, 0x111327, 2.2)
    scene.add(hemisphereLight)
    const roseLight = new THREE.PointLight(0xff7f8f, 18, 18)
    roseLight.position.set(-4, 4, 4)
    scene.add(roseLight)
    const violetLight = new THREE.PointLight(0x8c70d6, 18, 18)
    violetLight.position.set(4, 1, 2)
    scene.add(violetLight)

    const bars = new THREE.Group()
    scene.add(bars)
    const barGeometry = new THREE.BoxGeometry(0.13, 1, 0.13)
    const barMaterials = Array.from({ length: BAR_COUNT }, () => new THREE.MeshStandardMaterial({ color: 0x8fd8bf, emissive: 0x173f37, emissiveIntensity: 0.8, roughness: 0.3, metalness: 0.35 }))
    const barMeshes = Array.from({ length: BAR_COUNT }, (_, index) => {
      const angle = index / BAR_COUNT * Math.PI * 2
      const bar = new THREE.Mesh(barGeometry, barMaterials[index])
      bar.position.set(Math.cos(angle) * 3.15, 0, Math.sin(angle) * 3.15)
      bar.rotation.y = -angle
      bars.add(bar)
      return bar
    })

    const coreGeometry = new THREE.IcosahedronGeometry(1.15, 2)
    const coreMaterial = new THREE.MeshStandardMaterial({ color: 0x695da3, emissive: 0x352b67, emissiveIntensity: 1.3, roughness: 0.2, metalness: 0.5, flatShading: true, transparent: true, opacity: 0.88 })
    const core = new THREE.Mesh(coreGeometry, coreMaterial)
    scene.add(core)
    const shellGeometry = new THREE.IcosahedronGeometry(1.75, 1)
    const shellMaterial = new THREE.MeshBasicMaterial({ color: 0xa6e6ce, wireframe: true, transparent: true, opacity: 0.22 })
    const shell = new THREE.Mesh(shellGeometry, shellMaterial)
    scene.add(shell)
    const ringGeometry = new THREE.TorusGeometry(3.15, 0.018, 4, 128)
    const ringMaterial = new THREE.MeshBasicMaterial({ color: 0x9de0c8, transparent: true, opacity: 0.3 })
    const ring = new THREE.Mesh(ringGeometry, ringMaterial)
    ring.rotation.x = Math.PI / 2
    scene.add(ring)

    const targetPalette: VisualizerPalette = {
      primary: new THREE.Color(0x8fd8bf),
      secondary: new THREE.Color(0x695da3),
      accent: new THREE.Color(0xff7f8f),
    }
    const barTargetColors = Array.from({ length: BAR_COUNT }, () => new THREE.Color())
    const updateBarPalette = () => {
      barTargetColors.forEach((color, index) => {
        const cycle = index / BAR_COUNT * 3
        const segment = Math.floor(cycle)
        const blend = cycle - segment
        const from = segment === 0 ? targetPalette.primary : segment === 1 ? targetPalette.secondary : targetPalette.accent
        const to = segment === 0 ? targetPalette.secondary : segment === 1 ? targetPalette.accent : targetPalette.primary
        color.copy(from).lerp(to, blend).offsetHSL(index % 2 ? 0.018 : -0.012, 0.04, index % 3 === 0 ? 0.06 : -0.025)
      })
    }
    updateBarPalette()
    let active = true
    if (artworkUrl) {
      void extractArtworkPalette(artworkUrl).then(palette => {
        if (!active) return
        targetPalette.primary.copy(palette.primary)
        targetPalette.secondary.copy(palette.secondary)
        targetPalette.accent.copy(palette.accent)
        updateBarPalette()
      }).catch(() => { /* Keep the default habitat palette when artwork cannot be sampled. */ })
    }

    let context: AudioContext | undefined
    let source: MediaElementAudioSourceNode | undefined
    let analyser: AnalyserNode | undefined
    let frequencies = new Uint8Array(BAR_COUNT)
    try {
      context = new AudioContext()
      analyser = context.createAnalyser()
      analyser.fftSize = 512
      analyser.smoothingTimeConstant = 0.72
      frequencies = new Uint8Array(analyser.frequencyBinCount)
      source = context.createMediaElementSource(audio)
      source.connect(analyser)
      analyser.connect(context.destination)
      void context.resume()
    } catch { /* The scene keeps its idle motion if Web Audio is unavailable. */ }
    const hzPerBin = (context?.sampleRate ?? 48000) / (frequencies.length * 2)

    const resize = () => {
      const width = Math.max(host.clientWidth, 1)
      const height = Math.max(host.clientHeight, 1)
      renderer.setSize(width, height, false)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(host)
    resize()

    let frame = 0
    let displayedSignal = 0
    const render = (time: number) => {
      analyser?.getByteFrequencyData(frequencies)
      let energy = 0
      let audibleBins = 0
      frequencies.forEach((frequency, index) => {
        const hz = index * hzPerBin
        if (hz >= 8000) return
        energy += frequency / 255
        audibleBins += 1
      })
      barMeshes.forEach((bar, index) => {
        const value = frequencies[index % frequencies.length] / 255
        const height = 0.18 + value * 3.8
        bar.scale.y += (height - bar.scale.y) * 0.24
        bar.position.y = (bar.scale.y - 1) * 0.5
      })
      energy /= audibleBins || 1
      const axisSignal = (value: number, floor: number, gain: number) => Math.min(1, Math.max(0, (value - floor) * gain))
      const fullSignal = axisSignal(energy, 0.35, 3)
      displayedSignal += (fullSignal - displayedSignal) * 0.045
      const signalTarget = signalTargetRef.current
      signalTarget?.style.setProperty('--climate-year', String(1979 + displayedSignal * 71))
      signalTarget?.style.setProperty('--climate-pulse', String(1 + displayedSignal * 0.075))
      const pulse = 1 + energy * 0.48 + Math.sin(time * 0.0014) * 0.025
      barMaterials.forEach((material, index) => {
        material.color.lerp(barTargetColors[index], 0.045)
        material.emissive.copy(material.color).multiplyScalar(0.28)
      })
      coreMaterial.color.lerp(targetPalette.secondary, 0.045)
      coreMaterial.emissive.copy(coreMaterial.color).multiplyScalar(0.48)
      shellMaterial.color.lerp(targetPalette.accent, 0.045)
      ringMaterial.color.lerp(targetPalette.primary, 0.045)
      hemisphereLight.color.lerp(targetPalette.primary, 0.045)
      roseLight.color.lerp(targetPalette.accent, 0.045)
      violetLight.color.lerp(targetPalette.secondary, 0.045)
      core.scale.setScalar(pulse)
      core.rotation.x = time * 0.00008
      core.rotation.y = time * 0.00013
      shell.scale.setScalar(1 + energy * 0.18)
      shell.rotation.x = -time * 0.0001
      shell.rotation.y = time * 0.00016
      bars.rotation.y = time * 0.000035
      ring.rotation.z = time * 0.000025
      camera.position.x = Math.sin(time * 0.00008) * 0.65
      camera.lookAt(0, 0.2, 0)
      renderer.render(scene, camera)
      frame = requestAnimationFrame(render)
    }
    frame = requestAnimationFrame(render)

    return () => {
      active = false
      cancelAnimationFrame(frame)
      observer.disconnect()
      for (const axis of ['year', 'pulse']) signalTargetRef.current?.style.removeProperty(`--climate-${axis}`)
      source?.disconnect()
      analyser?.disconnect()
      void context?.close()
      barGeometry.dispose()
      barMaterials.forEach(material => material.dispose())
      coreGeometry.dispose()
      coreMaterial.dispose()
      shellGeometry.dispose()
      shellMaterial.dispose()
      ringGeometry.dispose()
      ringMaterial.dispose()
      renderer.dispose()
      renderer.forceContextLoss()
      renderer.domElement.remove()
      scene.clear()
    }
  }, [artworkUrl, audioRef, selectionKey, signalTargetRef])

  return <div ref={hostRef} className="now-playing-visualizer" />
}
