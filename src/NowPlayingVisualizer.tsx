import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'
import * as THREE from 'three'

const BAR_COUNT = 48

export default function NowPlayingVisualizer({ audioRef, signalTargetRef, selectionKey }: { audioRef: RefObject<HTMLAudioElement | null>; signalTargetRef: RefObject<HTMLElement | null>; selectionKey: number }) {
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

    scene.add(new THREE.HemisphereLight(0xa9ffe0, 0x111327, 2.2))
    const roseLight = new THREE.PointLight(0xff7f8f, 18, 18)
    roseLight.position.set(-4, 4, 4)
    scene.add(roseLight)
    const violetLight = new THREE.PointLight(0x8c70d6, 18, 18)
    violetLight.position.set(4, 1, 2)
    scene.add(violetLight)

    const bars = new THREE.Group()
    scene.add(bars)
    const barGeometry = new THREE.BoxGeometry(0.13, 1, 0.13)
    const barMaterial = new THREE.MeshStandardMaterial({ color: 0x8fd8bf, emissive: 0x173f37, emissiveIntensity: 0.8, roughness: 0.3, metalness: 0.35 })
    const barMeshes = Array.from({ length: BAR_COUNT }, (_, index) => {
      const angle = index / BAR_COUNT * Math.PI * 2
      const bar = new THREE.Mesh(barGeometry, barMaterial)
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
      cancelAnimationFrame(frame)
      observer.disconnect()
      for (const axis of ['year', 'pulse']) signalTargetRef.current?.style.removeProperty(`--climate-${axis}`)
      source?.disconnect()
      analyser?.disconnect()
      void context?.close()
      barGeometry.dispose()
      barMaterial.dispose()
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
  }, [audioRef, selectionKey, signalTargetRef])

  return <div ref={hostRef} className="now-playing-visualizer" />
}
