import type { OperationContext } from './common.js'
import type { ConcreteRelease, ReleaseMetadataPort } from './musicbrainz.js'
import { groupAndMatch, type SearchResults, type SoulseekCandidate } from './slskd-candidates.js'

export interface SoulseekSearchPort { search(query: string, context: OperationContext): Promise<SearchResults> }
export interface DiscoveryRequest { artist: string; title: string; releaseGroupMbid: string; artistAliases?: readonly string[]; context: OperationContext }
export class SoulseekDiscoveryService {
  constructor(readonly metadata: ReleaseMetadataPort, readonly searcher: SoulseekSearchPort) {}
  async discoverCandidates(request: DiscoveryRequest): Promise<readonly SoulseekCandidate[]> {
    const editions = await this.metadata.listReleaseEditions(request.releaseGroupMbid, request.context)
    for (const queries of tiers(request)) { const searches = await Promise.all([...new Set(queries)].map(q => this.searcher.search(q, request.context))); const candidates = groupAndMatch(searches, request.artist, request.title, editions); if (candidates.some(c => c.matches.some(m => !m.rejected && m.score >= 35))) return candidates }
    return []
  }
}
function tiers(r: DiscoveryRequest): string[][] { const stripped = r.title.replace(/\s*[([][^)\]]+[)\]]\s*$/, '').trim(); const first = [`${r.artist} ${r.title}`]; if (stripped !== r.title) first.push(`${r.artist} ${stripped}`); const result = [first]; if (r.title.trim().split(/\s+/).length >= 2) result.push([r.title]); const alias = r.artistAliases?.find(a => a.trim().length >= 4 && a.toLowerCase() !== r.artist.toLowerCase()); if (alias) result.push([`${alias} ${r.title}`]); return result }
