import assert from 'node:assert/strict'
import test from 'node:test'
import type { ConcreteRelease } from './musicbrainz.js'
import { groupAndMatch } from './slskd-candidates.js'
import { SoulseekDiscoveryService } from './soulseek-discovery.js'

const edition = (count: number, media = 1): ConcreteRelease => ({ id: `edition-${count}-${media}`, media: Array.from({ length: media }, (_, i) => ({ position: i + 1, tracks: [] })), tracks: Array.from({ length: count }, (_, i) => ({ mediumPosition: Math.floor(i / Math.ceil(count / media)) + 1, position: i + 1, title: `Song ${i + 1}` })) })
const result = (files: string[]) => [{ searchId: 'search', responses: [{ username: 'peer', files: files.map(filename => ({ filename, size: 1000 })) }] }]

test('candidate matching distinguishes complete, missing, extra, punctuation and one-track editions', () => {
  const complete = groupAndMatch(result(['Artist\\Album\\01 Song 1.flac', 'Artist\\Album\\02 Song 2.flac']), 'Artist', 'Album', [edition(2)])[0]
  assert.equal(complete.autoSelectEligible, true)
  assert.equal(groupAndMatch(result(['Artist\\Album\\01 Song 1.flac']), 'Artist', 'Album', [edition(2)])[0].matches[0].rejected, true)
  assert.equal(groupAndMatch(result(['Artist\\Album\\01 Song 1.flac', 'Artist\\Album\\02 Song 2.flac', 'Artist\\Album\\03 Bonus.flac']), 'Artist', 'Album', [edition(2)])[0].autoSelectEligible, false)
  assert.ok(groupAndMatch(result(['Artist\\Album!\\01 Song-1.flac']), 'Artist', 'Album', [edition(1)])[0].score > 80)
  assert.equal(groupAndMatch(result(['Artist\\Single\\01 Song 1.flac']), 'Artist', 'Single', [edition(1)])[0].autoSelectEligible, true)
})

test('multi-disc folders merge and compilation regression is hard rejected', () => {
  const multi = groupAndMatch(result(['Artist\\Album\\CD1\\01 Song 1.flac', 'Artist\\Album\\CD2\\02 Song 2.flac']), 'Artist', 'Album', [edition(2, 2)])
  assert.equal(multi.length, 1); assert.equal(multi[0].audioFiles.length, 2)
  const regression = groupAndMatch(result(['Various Artists\\Bravo Hits 115\\223_dua_lipa_-_love_again.mp3']), 'Dua Lipa', 'Dua Lipa', [edition(12)])[0]
  assert.equal(regression.matches[0].rejected, true); assert.equal(regression.autoSelectEligible, false)
})

test('candidate matching deduplicates sibling searches and accepts strong self-titled evidence', () => {
  const files = ['Dua Lipa\\Dua Lipa\\01 Song 1.flac', 'Dua Lipa\\Dua Lipa\\02 Song 2.flac']
  const candidates = groupAndMatch([...result(files), { ...result(files)[0], searchId: 'sibling' }], 'Dua Lipa', 'Dua Lipa', [edition(2)])
  assert.equal(candidates[0].audioFiles.length, 2)
  assert.deepEqual(candidates[0].sourceSearchIds, ['search', 'sibling'])
  assert.equal(candidates[0].matches[0].rejected, false)
  assert.equal(candidates[0].autoSelectEligible, true)
})

test('discovery stops after the first tier with a plausible exact-album candidate', async () => {
  const queries: string[] = []
  const service = new SoulseekDiscoveryService(
    { listReleaseEditions: async () => [edition(2)] },
    { search: async query => { queries.push(query); return result(['Artist\\Album Name\\01 Song 1.flac', 'Artist\\Album Name\\02 Song 2.flac'])[0] } },
  )
  const candidates = await service.discoverCandidates({ artist: 'Artist', title: 'Album Name', releaseGroupMbid: 'unused', artistAliases: ['A', 'Alias'], context: { operationId: 'test' } })
  assert.deepEqual(queries, ['Artist Album Name'])
  assert.equal(candidates[0].autoSelectEligible, true)
})
