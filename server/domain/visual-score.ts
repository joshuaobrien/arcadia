import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const ANALYZER_VERSION = 2
const SAMPLE_RATE = 8_000
const FRAME_SECONDS = 0.05

export type VisualSectionKind = 'hush' | 'flow' | 'surge'

export interface VisualScore {
  version: number
  durationSeconds: number
  tempoBpm: number
  beats: readonly number[]
  energy: readonly { time: number; value: number }[]
  sections: readonly { start: number; end: number; kind: VisualSectionKind; energy: number }[]
  peaks: readonly { time: number; strength: number; kind: 'drop' | 'climax' }[]
}

export type VisualScoreRequest =
  | { state: 'ready'; score: VisualScore }
  | { state: 'analyzing' }
  | { state: 'unavailable'; retryAfterSeconds: number }

export interface VisualScorePort {
  request(trackId: string, loadAudio: () => Promise<ReadableStream<Uint8Array>>): VisualScoreRequest
  close?(): void
}

interface ScoreRow { score_json: string }

export class VisualScoreRepository {
  readonly #database: DatabaseSync

  constructor(path: string) {
    const databasePath = resolve(path)
    mkdirSync(dirname(databasePath), { recursive: true })
    this.#database = new DatabaseSync(databasePath)
    this.#database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS visual_scores (
        track_id TEXT NOT NULL,
        analyzer_version INTEGER NOT NULL,
        score_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (track_id, analyzer_version)
      );
    `)
  }

  get(trackId: string): VisualScore | null {
    const row = this.#database.prepare('SELECT score_json FROM visual_scores WHERE track_id = ? AND analyzer_version = ?')
      .get(trackId, ANALYZER_VERSION) as unknown as ScoreRow | undefined
    return row ? JSON.parse(row.score_json) as VisualScore : null
  }

  put(trackId: string, score: VisualScore): void {
    this.#database.prepare(`
      INSERT INTO visual_scores (track_id, analyzer_version, score_json, created_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT (track_id, analyzer_version) DO UPDATE SET score_json = excluded.score_json, created_at = excluded.created_at
    `).run(trackId, ANALYZER_VERSION, JSON.stringify(score), new Date().toISOString())
  }

  close(): void { this.#database.close() }
}

interface VisualScoreStore {
  get(trackId: string): VisualScore | null
  put(trackId: string, score: VisualScore): void
  close?(): void
}

export class VisualScoreService implements VisualScorePort {
  readonly #pending = new Map<string, Promise<void>>()
  readonly #failures = new Map<string, number>()
  #queue: Promise<void> = Promise.resolve()

  constructor(
    readonly store: VisualScoreStore,
    readonly analyze: (audio: ReadableStream<Uint8Array>) => Promise<VisualScore> = analyzeVisualScore,
  ) {}

  request(trackId: string, loadAudio: () => Promise<ReadableStream<Uint8Array>>): VisualScoreRequest {
    const cached = this.store.get(trackId)
    if (cached) return { state: 'ready', score: cached }
    const failedAt = this.#failures.get(trackId)
    if (failedAt && Date.now() - failedAt < 60_000) return { state: 'unavailable', retryAfterSeconds: 60 }
    if (!this.#pending.has(trackId)) {
      const pending = this.#queue
        .then(loadAudio)
        .then(audio => this.analyze(audio))
        .then(score => { this.store.put(trackId, score); this.#failures.delete(trackId) })
        .catch(() => { this.#failures.set(trackId, Date.now()) })
        .finally(() => { this.#pending.delete(trackId) })
      this.#pending.set(trackId, pending)
      this.#queue = pending.catch(() => {})
    }
    return { state: 'analyzing' }
  }

  close(): void { this.store.close?.() }
}

export async function analyzeVisualScore(audio: ReadableStream<Uint8Array>): Promise<VisualScore> {
  const child = spawn(process.env.FFMPEG_PATH?.trim() || 'ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-vn', '-ac', '1', '-ar', String(SAMPLE_RATE), '-f', 's16le', 'pipe:1',
  ], { stdio: ['pipe', 'pipe', 'pipe'] })
  let stderr = ''
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', chunk => { if (stderr.length < 8_192) stderr += chunk })
  const completion = new Promise<void>((resolveCompletion, rejectCompletion) => {
    child.once('error', rejectCompletion)
    child.once('close', code => code === 0 ? resolveCompletion() : rejectCompletion(new Error(stderr.trim() || `ffmpeg exited with code ${code}`)))
  })
  const input = pipeline(Readable.fromWeb(audio as unknown as Parameters<typeof Readable.fromWeb>[0]), child.stdin)
    .catch(error => { child.kill(); throw error })
  const samplesPerFrame = Math.round(SAMPLE_RATE * FRAME_SECONDS)
  const rmsFrames: number[] = []
  let carry = Buffer.alloc(0)
  let sumSquares = 0
  let sampleCount = 0
  for await (const rawChunk of child.stdout) {
    const chunk = carry.length ? Buffer.concat([carry, rawChunk as Buffer]) : rawChunk as Buffer
    const usableLength = chunk.length - chunk.length % 2
    for (let offset = 0; offset < usableLength; offset += 2) {
      const sample = chunk.readInt16LE(offset) / 32_768
      sumSquares += sample * sample
      sampleCount += 1
      if (sampleCount === samplesPerFrame) {
        rmsFrames.push(Math.sqrt(sumSquares / sampleCount))
        sumSquares = 0
        sampleCount = 0
      }
    }
    carry = usableLength === chunk.length ? Buffer.alloc(0) : chunk.subarray(usableLength)
  }
  if (sampleCount) rmsFrames.push(Math.sqrt(sumSquares / sampleCount))
  await Promise.all([input, completion])
  if (rmsFrames.length < 20) throw new Error('Audio is too short to create a visual score')
  return scoreEnergyFrames(rmsFrames, FRAME_SECONDS)
}

export function scoreEnergyFrames(rmsFrames: readonly number[], frameSeconds = FRAME_SECONDS): VisualScore {
  const sorted = [...rmsFrames].sort((left, right) => left - right)
  const percentile = (value: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * value))]
  const floor = percentile(0.1)
  const ceiling = Math.max(floor + 0.0001, percentile(0.95))
  const normalized = rmsFrames.map(value => Math.min(1, Math.max(0, (value - floor) / (ceiling - floor))))
  const smoothWindow = Math.max(1, Math.round(0.5 / frameSeconds))
  const energy = movingAverage(normalized, smoothWindow)
  const onsetWindow = Math.max(1, Math.round(0.2 / frameSeconds))
  const baseline = movingAverage(normalized, onsetWindow)
  const onsets = normalized.map((value, index) => Math.max(0, value - baseline[index]))
  const minLag = Math.max(1, Math.round(0.3 / frameSeconds))
  const maxLag = Math.max(minLag, Math.round(0.9 / frameSeconds))
  let beatLag = Math.round(0.5 / frameSeconds)
  let bestCorrelation = -Infinity
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let correlation = 0
    for (let index = lag; index < onsets.length; index += 1) correlation += onsets[index] * onsets[index - lag]
    correlation /= Math.max(1, onsets.length - lag)
    if (correlation > bestCorrelation) { bestCorrelation = correlation; beatLag = lag }
  }
  let beatOffset = 0
  let bestPhase = -Infinity
  for (let offset = 0; offset < beatLag; offset += 1) {
    let phase = 0
    for (let index = offset; index < onsets.length; index += beatLag) phase += onsets[index]
    if (phase > bestPhase) { bestPhase = phase; beatOffset = offset }
  }
  const durationSeconds = rmsFrames.length * frameSeconds
  const beats: number[] = []
  for (let index = beatOffset; index < rmsFrames.length; index += beatLag) beats.push(round(index * frameSeconds))
  const pointStep = Math.max(1, Math.round(0.5 / frameSeconds))
  const energyPoints = []
  for (let index = 0; index < energy.length; index += pointStep) {
    energyPoints.push({ time: round(index * frameSeconds), value: round(average(energy, index, Math.min(energy.length, index + pointStep))) })
  }
  const sectionStep = Math.max(1, Math.round(2 / frameSeconds))
  const sectionBins: { start: number; end: number; kind: VisualSectionKind; energy: number }[] = []
  for (let index = 0; index < energy.length; index += sectionStep) {
    const value = average(energy, index, Math.min(energy.length, index + sectionStep))
    const kind: VisualSectionKind = value < 0.24 ? 'hush' : value > 0.68 ? 'surge' : 'flow'
    const previous = sectionBins.at(-1)
    const end = Math.min(durationSeconds, (index + sectionStep) * frameSeconds)
    if (previous?.kind === kind) {
      const previousDuration = previous.end - previous.start
      const duration = end - previous.end
      previous.energy = round((previous.energy * previousDuration + value * duration) / (previousDuration + duration))
      previous.end = round(end)
    } else sectionBins.push({ start: round(index * frameSeconds), end: round(end), kind, energy: round(value) })
  }
  const preFrames = Math.max(1, Math.round(2 / frameSeconds))
  const postFrames = Math.max(1, Math.round(1 / frameSeconds))
  const outroFrames = Math.max(postFrames, Math.round(8 / frameSeconds))
  const peakCandidates: { time: number; strength: number; kind: 'drop' | 'climax' }[] = []
  for (let index = preFrames; index < energy.length - outroFrames; index += 1) {
    const before = average(energy, index - preFrames, index)
    const after = average(energy, index, index + postFrames)
    const rise = after - before
    const strength = Math.min(1, rise * 0.9 + after * 0.35 + onsets[index] * 0.5)
    if (rise > 0.2 && after > 0.45 && strength >= (peakCandidates.at(-1)?.strength ?? 0) * 0.45) {
      peakCandidates.push({ time: round(index * frameSeconds), strength: round(strength), kind: 'drop' })
    }
  }
  const peaks: { time: number; strength: number; kind: 'drop' | 'climax' }[] = []
  for (const candidate of peakCandidates.sort((left, right) => right.strength - left.strength)) {
    if (peaks.every(peak => Math.abs(peak.time - candidate.time) >= 35)) peaks.push(candidate)
    if (peaks.length === 3) break
  }
  if (!peaks.length) {
    const strongest = onsets
      .slice(preFrames, Math.max(preFrames, onsets.length - outroFrames))
      .map((value, index) => ({ index: index + preFrames, value: value + energy[index + preFrames] * 0.2 }))
      .sort((left, right) => right.value - left.value)[0]
    if (strongest?.value > 0.35) peaks.push({ time: round(strongest.index * frameSeconds), strength: round(Math.min(1, strongest.value)), kind: 'climax' })
  }
  peaks.sort((left, right) => left.time - right.time)
  return {
    version: ANALYZER_VERSION,
    durationSeconds: round(durationSeconds),
    tempoBpm: round(60 / (beatLag * frameSeconds)),
    beats,
    energy: energyPoints,
    sections: sectionBins,
    peaks,
  }
}

function movingAverage(values: readonly number[], radius: number): number[] {
  const output: number[] = []
  let sum = 0
  for (let index = 0; index < values.length; index += 1) {
    sum += values[index]
    if (index >= radius) sum -= values[index - radius]
    output.push(sum / Math.min(index + 1, radius))
  }
  return output
}

function average(values: readonly number[], start: number, end: number): number {
  let sum = 0
  for (let index = start; index < end; index += 1) sum += values[index]
  return sum / Math.max(1, end - start)
}

function round(value: number): number { return Math.round(value * 1_000) / 1_000 }
