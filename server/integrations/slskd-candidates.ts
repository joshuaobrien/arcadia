import { createHash } from 'node:crypto'
import type { ConcreteRelease, ReleaseTrack } from './musicbrainz.js'

export interface SlskdFile { filename: string; size: number; bitRate?: number; length?: number }
export interface SlskdResponse { username: string; files: readonly SlskdFile[] }
export interface SearchResults { searchId: string; responses: readonly SlskdResponse[] }
export interface CandidateFile extends SlskdFile { path: string; name: string; extension: string }
export interface CandidateMatch { editionId: string; score: number; reasons: readonly string[]; mappedTracks: number; missingTracks: number; extraTracks: number; rejected: boolean }
export interface SoulseekCandidate { id: string; peer: string; path: string; sourceSearchIds: readonly string[]; audioFiles: readonly CandidateFile[]; metadataFiles: readonly CandidateFile[]; matches: readonly CandidateMatch[]; score: number; autoSelectEligible: boolean }

const AUDIO = new Set(['flac', 'alac', 'wav', 'ape', 'ogg', 'aac', 'mp3', 'wma', 'm4a'])
const normalize = (s: string) => s.normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().toLowerCase()
const parent = (path: string) => path.replace(/[\\/][^\\/]+$/, '')
const basename = (path: string) => path.split(/[\\/]/).at(-1) ?? path
const mergedParent = (path: string) => { const p = parent(path); return /[\\/](?:cd|disc|disk|side)[ _.-]*\d+$/i.test(p) ? parent(p) : p }

export function groupAndMatch(results: readonly SearchResults[], artist: string, title: string, editions: readonly ConcreteRelease[]): SoulseekCandidate[] {
  const groups = new Map<string, { peer: string; path: string; ids: Set<string>; files: Map<string, CandidateFile> }>()
  for (const result of results) for (const response of result.responses) for (const file of response.files) {
    const path = mergedParent(file.filename); const key = `${response.username}\0${path}`
    const extension = basename(file.filename).split('.').at(-1)?.toLowerCase() ?? ''
    const group = groups.get(key) ?? { peer: response.username, path, ids: new Set(), files: new Map() }
    group.ids.add(result.searchId); group.files.set(`${file.filename}\0${file.size}`, { ...file, path: file.filename, name: basename(file.filename), extension }); groups.set(key, group)
  }
  return [...groups.values()].map(group => {
    const files = [...group.files.values()]
    const audio = files.filter(f => AUDIO.has(f.extension)).sort((a, b) => natural(a.name, b.name)); const metadata = files.filter(f => !AUDIO.has(f.extension))
    const matches = editions.map(edition => match(audio, group.path, artist, title, edition)).sort((a, b) => b.score - a.score || a.editionId.localeCompare(b.editionId))
    const best = matches[0]; const byId = new Map(editions.map(edition => [edition.id, edition])); const unambiguous = !!best && (!matches[1] || best.score - matches[1].score >= 5 || equivalentEditions(byId.get(best.editionId), byId.get(matches[1].editionId)))
    return { id: createHash('sha256').update(`${group.peer}\0${group.path}`).digest('hex').slice(0, 24), peer: group.peer, path: group.path, sourceSearchIds: [...group.ids].sort(), audioFiles: audio, metadataFiles: metadata, matches, score: best?.score ?? 0, autoSelectEligible: !!best && best.score >= 85 && !best.rejected && best.missingTracks === 0 && best.extraTracks === 0 && unambiguous }
  }).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
}

function match(files: CandidateFile[], path: string, artist: string, title: string, edition: ConcreteRelease): CandidateMatch {
  const expected = edition.tracks.length; const reasons: string[] = [`audio/expected counts: ${files.length}/${expected}`]
  const missing = Math.max(0, expected - files.length), extra = Math.max(0, files.length - expected)
  const oneFileReject = files.length === 1 && expected > 1
  const pathText = normalize(path), artistEvidence = pathText.includes(normalize(artist)), titleEvidence = pathText.includes(normalize(title))
  const selfTitled = normalize(artist) === normalize(title)
  const selfTitleOccurrences = pathText.split(normalize(title)).length - 1
  let mapped = 0; let durationPenalty = 0
  for (let i = 0; i < Math.min(files.length, expected); i++) { const track: ReleaseTrack = edition.tracks[i]; const file = files[i]; const titleMatch = normalize(file.name).includes(normalize(track.title)); if (titleMatch) mapped++; if (file.length !== undefined && track.durationMs !== undefined) durationPenalty += Math.min(10, Math.abs(file.length * 1000 - track.durationMs) / 1000 / 3) }
  reasons.push(`mapped tracks: ${mapped}/${expected}`, `missing tracks: ${missing}`, `extra tracks: ${extra}`, `path evidence artist=${artistEvidence} title=${titleEvidence}`, `duration delta penalty: ${durationPenalty.toFixed(1)}`, `media layout: ${edition.media.length} medium(s)`, `codec/bitrate/size: ${[...new Set(files.map(f => f.extension))].join(',') || 'none'}; ${files.reduce((n, f) => n + f.size, 0)} bytes`)
  if (/various artists|compilation|bravo hits/i.test(path)) reasons.push('loose/compilation warning')
  if (oneFileReject) reasons.push('rejected: one file cannot match a multi-track edition')
  if (selfTitled && selfTitleOccurrences < 2) reasons.push('self-titled warning: one path mention is insufficient')
  const rejected = oneFileReject || !expected || (selfTitled && selfTitleOccurrences < 2) || /various artists|compilation|bravo hits/i.test(path)
  const countScore = files.length === expected ? 45 : Math.max(0, 45 - 12 * (missing + extra)); const mapScore = expected ? 35 * mapped / expected : 0
  const score = Math.max(0, Math.round(countScore + mapScore + (artistEvidence ? 10 : 0) + (titleEvidence ? 10 : 0) - durationPenalty - (rejected ? 50 : 0)))
  return { editionId: edition.id, score, reasons, mappedTracks: mapped, missingTracks: missing, extraTracks: extra, rejected }
}
function natural(a: string, b: string): number { return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }) }
function equivalentEditions(a: ConcreteRelease | undefined, b: ConcreteRelease | undefined): boolean { return !!a && !!b && a.tracks.length === b.tracks.length && a.tracks.every((track, index) => normalize(track.title) === normalize(b.tracks[index].title)) }
