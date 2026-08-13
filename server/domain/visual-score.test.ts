import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { scoreEnergyFrames, VisualScoreRepository, VisualScoreService, type VisualScore } from './visual-score.js'

test('visual scoring finds tempo, sections, and a sparse arrangement peak', () => {
  const frameSeconds = 0.05
  const frames = Array.from({ length: 1_200 }, (_, index) => {
    const time = index * frameSeconds
    const section = time < 16 ? 0.08 : time < 44 ? 0.72 : 0.28
    const beat = time >= 16 && Math.abs((time - 16) % 0.5) < frameSeconds ? 0.2 : 0
    return section + beat
  })
  const score = scoreEnergyFrames(frames, frameSeconds)
  assert.equal(score.version, 2)
  assert.ok(score.tempoBpm >= 110 && score.tempoBpm <= 130)
  assert.equal(score.sections[0].kind, 'hush')
  assert.ok(score.sections.some(section => section.kind === 'surge'))
  assert.ok(score.peaks.some(peak => peak.time >= 15 && peak.time <= 17))
  assert.ok(score.peaks.length <= 3)
})

test('visual scoring ignores an end-of-file transient', () => {
  const frames = Array.from({ length: 1_200 }, (_, index) => index >= 1_160 && index < 1_180 ? 1 : 0.05)
  const score = scoreEnergyFrames(frames, 0.05)
  assert.equal(score.peaks.length, 0)
})

test('visual score service deduplicates analysis and persists the result', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'needle-visual-score-'))
  const path = join(directory, 'scores.sqlite')
  const score: VisualScore = { version: 2, durationSeconds: 10, tempoBpm: 120, beats: [0, 0.5], energy: [], sections: [], peaks: [] }
  let analyses = 0
  const repository = new VisualScoreRepository(path)
  const service = new VisualScoreService(repository, async () => { analyses += 1; return score })
  const loadAudio = async () => new Response('audio').body!
  assert.equal(service.request('track', loadAudio).state, 'analyzing')
  assert.equal(service.request('track', loadAudio).state, 'analyzing')
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.deepEqual(service.request('track', loadAudio), { state: 'ready', score })
  assert.equal(analyses, 1)
  service.close()
  const reopened = new VisualScoreRepository(path)
  assert.deepEqual(reopened.get('track'), score)
  reopened.close()
  await rm(directory, { recursive: true, force: true })
})
