import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'
import * as THREE from 'three'
import { HalfFloatType, WebGPURenderer } from 'three/webgpu'
import { ExtendedSRGBColorSpace, ExtendedSRGBColorSpaceImpl } from 'three/addons/math/ColorSpaces.js'

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

    let cancelled = false
    let disposeScene: (() => void) | undefined
    void (async () => {
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 60)
    camera.position.set(0, 4.2, 9.6)
    camera.lookAt(0, 0, 0)
    const hdrCapable = 'gpu' in navigator && window.matchMedia('(dynamic-range: high)').matches
    let hdrOutput = false
    let renderer: THREE.WebGLRenderer | WebGPURenderer
    if (hdrCapable) {
      try {
        THREE.ColorManagement.define({ [ExtendedSRGBColorSpace]: ExtendedSRGBColorSpaceImpl })
        const webgpuRenderer = new WebGPURenderer({ antialias: true, alpha: true, outputType: HalfFloatType })
        webgpuRenderer.outputColorSpace = ExtendedSRGBColorSpace
        await webgpuRenderer.init()
        renderer = webgpuRenderer
        hdrOutput = true
      } catch {
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' })
      }
    } else {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' })
    }
    if (cancelled) {
      renderer.dispose()
      return
    }
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.6))
    if (!hdrOutput) renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.domElement.setAttribute('aria-hidden', 'true')
    renderer.domElement.dataset.outputRange = hdrOutput ? 'hdr' : 'sdr'
    host.appendChild(renderer.domElement)

    const hemisphereLight = new THREE.HemisphereLight(0xa9ffe0, 0x111327, hdrOutput ? 0.65 : 2.2)
    scene.add(hemisphereLight)
    const roseLight = new THREE.PointLight(0xff7f8f, hdrOutput ? 8 : 18, 18)
    roseLight.position.set(-4, 4, 4)
    scene.add(roseLight)
    const violetLight = new THREE.PointLight(0x8c70d6, hdrOutput ? 8 : 18, 18)
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

    const glintGeometry = new THREE.OctahedronGeometry(0.055, 0)
    const glintMaterials = Array.from({ length: 12 }, () => new THREE.MeshStandardMaterial({ color: 0x101716, emissive: 0xd8fff2, emissiveIntensity: 0, roughness: 0.08, metalness: 0.15, transparent: true, opacity: 0 }))
    const glints = glintMaterials.map((material, index) => {
      const angle = index / glintMaterials.length * Math.PI * 2
      const glint = new THREE.Mesh(glintGeometry, material)
      const radius = index % 2 ? 2.15 : 2.65
      glint.position.set(Math.cos(angle) * radius, 0.35 + Math.sin(index * 1.9) * 0.8, Math.sin(angle) * radius)
      scene.add(glint)
      return glint
    })

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
      analyser.smoothingTimeConstant = 0.5
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
    let energyEnvelope = 0
    let beatEnvelope = 0
    let bassEnvelope = 0
    let midEnvelope = 0
    let trebleEnvelope = 0
    let sparkEnvelope = 0
    let delightEnvelope = 0
    let stageFlowEnvelope = 0
    let delightStartedAt = -Infinity
    let delightFlashStartedAt = -Infinity
    let lastStageBeatAt = -Infinity
    let nextDelightAt = 9000
    let delightEvent = -1
    let stageBeatLatched = false
    let overburnEnvelope = 0
    let overburnRelease = 0
    let overburnWasActive = false
    let lastRenderTime = 0
    let stageRotationOffset = 0
    let rhythmicBaseline = 0
    let spectrumReady = false
    const jamBands = Array.from({ length: 6 }, () => 0)
    const previousFrequencies = new Uint8Array(frequencies.length)
    const render = (time: number) => {
      const frameFactor = lastRenderTime ? Math.min(4, (time - lastRenderTime) / 16.667) : 1
      lastRenderTime = time
      analyser?.getByteFrequencyData(frequencies)
      let energy = 0
      let audibleBins = 0
      let rhythmicEnergy = 0
      let rhythmicBins = 0
      let midEnergy = 0
      let midBins = 0
      let trebleEnergy = 0
      let trebleBins = 0
      let spectralFlux = 0
      let fluxBins = 0
      let highFlux = 0
      let highFluxBins = 0
      const jamBandEnergy = [0, 0, 0, 0, 0, 0]
      const jamBandBins = [0, 0, 0, 0, 0, 0]
      frequencies.forEach((frequency, index) => {
        const hz = index * hzPerBin
        if (hz >= 8000) return
        const value = frequency / 255
        const jamBand = hz < 140 ? 0 : hz < 300 ? 1 : hz < 700 ? 2 : hz < 1500 ? 3 : hz < 3500 ? 4 : 5
        jamBandEnergy[jamBand] += value
        jamBandBins[jamBand] += 1
        energy += value
        audibleBins += 1
        if (hz < 350) {
          rhythmicEnergy += value
          rhythmicBins += 1
        } else if (hz < 2000) {
          midEnergy += value
          midBins += 1
        } else {
          trebleEnergy += value
          trebleBins += 1
        }
        if (spectrumReady && hz >= 45 && hz < 2000) {
          spectralFlux += Math.max(0, frequency - previousFrequencies[index]) / 255
          fluxBins += 1
        }
        if (spectrumReady && hz >= 2000) {
          highFlux += Math.max(0, frequency - previousFrequencies[index]) / 255
          highFluxBins += 1
        }
        previousFrequencies[index] = frequency
      })
      spectrumReady = true
      barMeshes.forEach((bar, index) => {
        const value = frequencies[index % frequencies.length] / 255
        const height = 0.18 + value * 3.8
        bar.scale.y += (height - bar.scale.y) * 0.14
        bar.position.y = (bar.scale.y - 1) * 0.5
      })
      energy /= audibleBins || 1
      rhythmicEnergy /= rhythmicBins || 1
      midEnergy /= midBins || 1
      trebleEnergy /= trebleBins || 1
      spectralFlux /= fluxBins || 1
      highFlux /= highFluxBins || 1
      const axisSignal = (value: number, floor: number, gain: number) => Math.min(1, Math.max(0, (value - floor) * gain))
      const fullSignal = axisSignal(energy, 0.35, 3)
      energyEnvelope += (fullSignal - energyEnvelope) * 0.025
      const bassSignal = axisSignal(rhythmicEnergy, 0.28, 1.7)
      const midSignal = axisSignal(midEnergy, 0.3, 1.8)
      const trebleSignal = axisSignal(trebleEnergy, 0.22, 2.1)
      bassEnvelope += (bassSignal - bassEnvelope) * 0.08
      midEnvelope += (midSignal - midEnvelope) * 0.055
      trebleEnvelope += (trebleSignal - trebleEnvelope) * 0.09
      if (!rhythmicBaseline) rhythmicBaseline = rhythmicEnergy
      rhythmicBaseline += (rhythmicEnergy - rhythmicBaseline) * (rhythmicEnergy > rhythmicBaseline ? 0.008 : 0.04)
      const beatDrive = Math.min(1, Math.max(0, (rhythmicEnergy - rhythmicBaseline - 0.02) * 3 + spectralFlux * 5.5))
      beatEnvelope += (beatDrive - beatEnvelope) * (beatDrive > beatEnvelope ? 0.5 : 0.12)
      const sparkDrive = Math.min(1, highFlux * 11)
      sparkEnvelope += (sparkDrive - sparkEnvelope) * (sparkDrive > sparkEnvelope ? 0.62 : 0.11)
      if (time >= nextDelightAt && beatDrive > 0.42 && bassSignal > 0.12) {
        delightEnvelope = 0.65
        delightStartedAt = time
        delightFlashStartedAt = time
        lastStageBeatAt = time
        stageBeatLatched = true
        delightEvent = (delightEvent + 1) % 3
        signalTargetRef.current?.setAttribute('data-delight-event', ['shockwave', 'prism', 'surge'][delightEvent])
        nextDelightAt = time + 15000 + Math.random() * 12000
      } else {
        delightEnvelope *= 0.97
      }
      const stageAge = time - delightStartedAt
      const stageActive = stageAge < 7200
      if (beatDrive < 0.16) stageBeatLatched = false
      if (stageActive && beatDrive > 0.3 && !stageBeatLatched && time - lastStageBeatAt > 180) {
        lastStageBeatAt = time
        delightFlashStartedAt = time
        delightEnvelope = Math.max(delightEnvelope, 0.32)
        stageBeatLatched = true
      }
      const stageFade = stageActive ? Math.min(1, (7200 - stageAge) / 1500) : 0
      const stageTarget = stageFade * Math.min(1, 0.08 + bassEnvelope * 0.34 + midEnvelope * 0.2 + beatEnvelope * 0.16 + sparkEnvelope * 0.08)
      stageFlowEnvelope += (stageTarget - stageFlowEnvelope) * (1 - Math.pow(stageTarget > stageFlowEnvelope ? 0.94 : 0.975, frameFactor))
      const stageLevel = stageFlowEnvelope
      jamBands.forEach((value, index) => {
        const bandSignal = axisSignal(jamBandEnergy[index] / (jamBandBins[index] || 1), index < 2 ? 0.2 : 0.12, index < 2 ? 2.2 : 2.8)
        jamBands[index] = value + (bandSignal - value) * (bandSignal > value ? 0.34 : 0.09)
      })
      const rhythmicSignal = Math.min(1, energyEnvelope * 0.24 + beatEnvelope * 0.76)
      displayedSignal += (rhythmicSignal - displayedSignal) * (rhythmicSignal > displayedSignal ? 0.16 : 0.08)
      const signalTarget = signalTargetRef.current
      const overburnActive = signalTarget?.hasAttribute('data-overburn') ?? false
      if (overburnActive) {
        overburnEnvelope += (1 - overburnEnvelope) * (1 - Math.pow(0.91, frameFactor))
        overburnRelease = 0
      } else {
        if (overburnWasActive) overburnRelease = 1
        overburnEnvelope *= Math.pow(0.72, frameFactor)
        overburnRelease *= Math.pow(0.82, frameFactor)
      }
      overburnWasActive = overburnActive
      const overburnLevel = Math.max(overburnEnvelope, overburnRelease)
      signalTarget?.style.setProperty('--climate-year', String(1979 + displayedSignal * 71))
      signalTarget?.style.setProperty('--climate-pulse', String(1 + energyEnvelope * 0.025 + displayedSignal * 0.055))
      signalTarget?.style.setProperty('--climate-beat', String(displayedSignal))
      signalTarget?.style.setProperty('--jam-bang', String(2.5 + energyEnvelope * 4 + displayedSignal * 3.5))
      signalTarget?.style.setProperty('--jam-punch', String(displayedSignal * 10))
      signalTarget?.style.setProperty('--jam-crumble', String(midEnvelope * 5))
      signalTarget?.style.setProperty('--jam-splatter', String(sparkEnvelope * 5))
      signalTarget?.style.setProperty('--jam-beat', String(displayedSignal))
      signalTarget?.style.setProperty('--jam-mid', String(midEnvelope))
      signalTarget?.style.setProperty('--jam-spark', String(sparkEnvelope))
      const delightProgress = Math.min(1, Math.max(0, stageAge / 7200))
      const delightDirection = delightEvent % 2 ? -1 : 1
      signalTarget?.style.setProperty('--delight-level', String(Math.min(1, stageLevel * 0.72 + delightEnvelope * 0.22)))
      signalTarget?.style.setProperty('--delight-progress', String(delightProgress))
      signalTarget?.style.setProperty('--delight-offset', `${(delightProgress * 180 - 90) * delightDirection}%`)
      signalTarget?.style.setProperty('--delight-angle', delightDirection < 0 ? '54deg' : '90deg')
      signalTarget?.style.setProperty('--delight-scale', String(0.5 + delightProgress * 7))
      signalTarget?.style.setProperty('--delight-stripe-offset', `${delightProgress * 7.5}vh`)
      signalTarget?.style.setProperty('--overburn-opacity', String(Math.min(0.82, overburnEnvelope * 0.26 + overburnRelease * 0.72)))
      signalTarget?.style.setProperty('--overburn-scale', String(overburnActive ? 1 : 1 + (1 - overburnRelease) * 1.8))
      signalTarget?.style.setProperty('--overburn-cover-brightness', String(1 + overburnLevel * 1.65))
      signalTarget?.style.setProperty('--overburn-cover-saturation', String(1 + overburnEnvelope * 0.35))
      signalTarget?.style.setProperty('--overburn-cover-flare', String(Math.min(0.92, overburnEnvelope * 0.46 + overburnRelease * 0.9)))
      signalTarget?.style.setProperty('--overburn-cover-glow', String(Math.min(0.9, overburnEnvelope * 0.5 + overburnRelease * 0.9)))
      signalTarget?.style.setProperty('--overburn-cover-radius', `${overburnLevel * 110}px`)
      signalTarget?.style.setProperty('--overburn-cover-scale', String(1 + overburnEnvelope * 0.035 + overburnRelease * 0.08))
      signalTarget?.style.setProperty('--overburn-cover-lift', `${overburnLevel * -34}px`)
      signalTarget?.style.setProperty('--overburn-cover-y', `${12 + overburnLevel * 8}deg`)
      signalTarget?.style.setProperty('--overburn-cover-x', `${2 + overburnLevel * 5}deg`)
      signalTarget?.style.setProperty('--overburn-cover-roll', `${overburnLevel * -2.5}deg`)
      signalTarget?.style.setProperty('--overburn-cover-skew', `${overburnLevel * -2}deg`)
      signalTarget?.style.setProperty('--overburn-cover-shadow-y', `${30 + overburnLevel * 28}px`)
      jamBands.forEach((value, index) => signalTarget?.style.setProperty(`--jam-band-${index}`, String(value)))
      signalTarget?.style.setProperty('--lab-bevel', String(sparkEnvelope * 1000))
      signalTarget?.style.setProperty('--lab-roundness', String(displayedSignal * 1000))
      signalTarget?.style.setProperty('--lab-quad', String(displayedSignal * 1000))
      signalTarget?.style.setProperty('--lab-scale', String(180 + bassEnvelope * 820))
      const pulse = 1 + energyEnvelope * 0.12 + bassEnvelope * 0.18 + Math.sin(time * 0.0007) * 0.02
      barMaterials.forEach((material, index) => {
        material.color.lerp(barTargetColors[index], 0.045)
        material.emissive.copy(material.color).multiplyScalar(hdrOutput ? 1 : 0.28)
        const reflection = Math.max(0, beatEnvelope - Math.abs((index / BAR_COUNT) - ((time * 0.00018) % 1)) * 2.8)
        const delightPosition = Math.min(1, Math.max(0, (time - delightFlashStartedAt) / 520))
        const delightReflection = Math.max(0, delightEnvelope - Math.abs(index / BAR_COUNT - delightPosition) * 5.5)
        material.emissiveIntensity = hdrOutput ? 0.65 + bassEnvelope * 0.35 + reflection * 2.5 + delightReflection * 4.2 + overburnLevel * 7 : 0.8 + delightReflection * 0.45 + overburnLevel
        material.roughness = 0.34 - midEnvelope * 0.16
      })
      coreMaterial.color.lerp(targetPalette.secondary, 0.045)
      coreMaterial.emissive.copy(coreMaterial.color).multiplyScalar(hdrOutput ? 1 : 0.48)
      coreMaterial.emissiveIntensity = hdrOutput ? 1.35 + bassEnvelope * 0.65 + overburnLevel * 6 : 1.3 + overburnLevel
      shellMaterial.color.lerp(targetPalette.accent, 0.045)
      ringMaterial.color.lerp(targetPalette.primary, 0.045)
      hemisphereLight.color.lerp(targetPalette.primary, 0.045)
      roseLight.color.lerp(targetPalette.accent, 0.045)
      violetLight.color.lerp(targetPalette.secondary, 0.045)
      hemisphereLight.intensity = (hdrOutput ? 0.65 : 2.2) + overburnLevel * (hdrOutput ? 1.4 : 0.4)
      roseLight.intensity = (hdrOutput ? 8 : 18) + overburnLevel * (hdrOutput ? 18 : 4)
      violetLight.intensity = (hdrOutput ? 8 : 18) + overburnLevel * (hdrOutput ? 18 : 4)
      core.scale.setScalar(pulse)
      core.rotation.x = time * 0.00008
      core.rotation.y = time * 0.00013
      shell.scale.setScalar(1 + energyEnvelope * 0.12 + stageLevel * (0.1 + bassEnvelope * 0.1))
      shell.rotation.x = -time * 0.0001
      shell.rotation.y = time * 0.00016
      stageRotationOffset += stageLevel * 0.00045 * frameFactor * delightDirection
      bars.rotation.y = time * 0.000025 + stageRotationOffset
      bars.scale.setScalar(1 + stageLevel * (0.035 + bassEnvelope * 0.045))
      ring.rotation.z = time * 0.000025
      glints.forEach((glint, index) => {
        const phase = (index * 0.37 + time * 0.00016) % 1
        const delightPhase = Math.max(0, 1 - Math.abs((time - delightFlashStartedAt) / 520 - index / glints.length) * 7)
        const flash = Math.max(0, sparkEnvelope - phase * 1.8, delightEnvelope * delightPhase, overburnLevel * 0.92)
        const material = glintMaterials[index]
        material.emissive.copy(index % 3 === 0 ? targetPalette.accent : index % 3 === 1 ? targetPalette.primary : targetPalette.secondary)
        material.emissiveIntensity = hdrOutput ? flash * (overburnLevel > 0.01 ? 8 : delightPhase > 0 ? 6.5 : 4.5) : flash * 0.9
        material.opacity = flash * (hdrOutput ? 0.95 : 0.45)
        glint.scale.setScalar(0.65 + flash * 1.6)
      })
      camera.position.x = Math.sin(time * 0.00006) * 0.65 + Math.sin(time * 0.0012) * stageLevel * 0.06
      camera.position.z = 9.6 - stageLevel * (0.22 + bassEnvelope * 0.28) - overburnLevel * 0.28
      camera.lookAt(0, 0.2, 0)
      renderer.render(scene, camera)
      frame = requestAnimationFrame(render)
    }
    frame = requestAnimationFrame(render)

    disposeScene = () => {
      active = false
      cancelAnimationFrame(frame)
      observer.disconnect()
      for (const property of ['climate-year', 'climate-pulse', 'climate-beat', 'jam-bang', 'jam-punch', 'jam-crumble', 'jam-splatter', 'jam-beat', 'jam-mid', 'jam-spark', 'jam-band-0', 'jam-band-1', 'jam-band-2', 'jam-band-3', 'jam-band-4', 'jam-band-5', 'lab-bevel', 'lab-roundness', 'lab-quad', 'lab-scale', 'delight-level', 'delight-progress', 'delight-offset', 'delight-angle', 'delight-scale', 'delight-stripe-offset', 'overburn-opacity', 'overburn-scale', 'overburn-cover-brightness', 'overburn-cover-saturation', 'overburn-cover-flare', 'overburn-cover-glow', 'overburn-cover-radius', 'overburn-cover-scale', 'overburn-cover-lift', 'overburn-cover-y', 'overburn-cover-x', 'overburn-cover-roll', 'overburn-cover-skew', 'overburn-cover-shadow-y']) signalTargetRef.current?.style.removeProperty(`--${property}`)
      signalTargetRef.current?.removeAttribute('data-delight-event')
      signalTargetRef.current?.removeAttribute('data-overburn')
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
      glintGeometry.dispose()
      glintMaterials.forEach(material => material.dispose())
      renderer.dispose()
      if (renderer instanceof THREE.WebGLRenderer) renderer.forceContextLoss()
      renderer.domElement.remove()
      scene.clear()
    }
    })()

    return () => {
      cancelled = true
      disposeScene?.()
    }
  }, [artworkUrl, audioRef, selectionKey, signalTargetRef])

  return <div ref={hostRef} className="now-playing-visualizer" />
}
