import type { AdapterHealth, OperationContext, ServiceAdapter } from './common.js'
import { AdapterError } from './errors.js'
import type { SearchResults, SlskdFile, SlskdResponse } from './slskd-candidates.js'

type Fetch = typeof globalThis.fetch
type Json = Record<string, unknown>
export interface SlskdOptions { adapterId?: string; baseUrl: string; apiKey: string; fetch?: Fetch; timeoutMs?: number; pollIntervalMs?: number; searchDeadlineMs?: number; settleIntervalMs?: number; settleDeadlineMs?: number; emptySettleMs?: number; sleep?: (ms: number, signal?: AbortSignal) => Promise<void> }
export interface SlskdDownloadFile { filename: string; size: number }
export interface SlskdBatch { id: string; username?: string; transfers: readonly SlskdTransfer[] }
export interface SlskdTransfer { id: string; username: string; filename?: string; size?: number; bytesTransferred?: number; state: string }
export interface SlskdTransferSummary { state: 'queued'|'transferring'|'completed'|'failed'; visible: number; completed: number; bytesTotal: number; bytesTransferred: number; error?: string }

export class SlskdAdapter implements ServiceAdapter {
  readonly adapterId: string
  readonly kind = 'slskd' as const
  readonly #base: URL; readonly #key: string; readonly #fetch: Fetch; readonly #timeout: number; readonly #poll: number; readonly #deadline: number; readonly #settle: number; readonly #settleDeadline: number; readonly #emptySettle: number; readonly #sleep: SlskdOptions['sleep']
  constructor(options: SlskdOptions) {
    if (!options.apiKey.trim()) throw new Error('slskd API key is required')
    const url = new URL(options.baseUrl); if (!['http:', 'https:'].includes(url.protocol)) throw new Error('slskd URL must use HTTP or HTTPS')
    this.adapterId = options.adapterId ?? 'slskd'; this.#base = new URL(`${url.toString().replace(/\/$/, '')}/api/v0/`); this.#key = options.apiKey; this.#fetch = options.fetch ?? fetch; this.#timeout = options.timeoutMs ?? 10_000; this.#poll = options.pollIntervalMs ?? 750; this.#deadline = options.searchDeadlineMs ?? 30_000; this.#settle = options.settleIntervalMs ?? 600; this.#settleDeadline = options.settleDeadlineMs ?? 8_000; this.#emptySettle = options.emptySettleMs ?? 4_000; this.#sleep = options.sleep ?? delay
  }
  async probe(context: OperationContext): Promise<AdapterHealth> { const started = performance.now(); try { const app = await this.#request('application', 'GET', context) as Json; const version = object(app.version); return { adapterId: this.adapterId, kind: this.kind, state: 'available', checkedAt: new Date().toISOString(), latencyMs: Math.round(performance.now() - started), version: text(version?.current) ?? text(version?.full) ?? text(app.version) ?? text(app.currentVersion), apiVersion: 'v0' } } catch (error) { if (error instanceof AdapterError && error.code !== 'authentication') return { adapterId: this.adapterId, kind: this.kind, state: 'unavailable', checkedAt: new Date().toISOString(), latencyMs: Math.round(performance.now() - started), apiVersion: 'v0', message: error.message }; throw error } }
  async search(query: string, context: OperationContext): Promise<SearchResults> {
    if (!query.trim()) throw this.#error('invalid-request', 'Search query is required', false)
    const created = await this.#request('searches/', 'POST', context, { searchText: query, searchTimeout: 3_000, filterResponses: true, responseLimit: 5_000 }) as Json
    const id = text(created.id) ?? text(created.searchId); if (!id) throw this.#error('transient-provider-failure', 'slskd returned a search without an identifier', true)
    const started = Date.now(); let state = created
    try {
      while (!complete(state)) { if (Date.now() - started >= this.#deadline) throw this.#error('unavailable', 'slskd search timed out', true); await this.#sleep!(this.#poll, context.signal); state = await this.#request(`searches/${encodeURIComponent(id)}?includeResponses=false`, 'GET', context) as Json }
      const settling = Date.now(); let expected = responseCount(state); let best: SearchResults = { searchId: id, responses: [] }
      do {
        state = await this.#request(`searches/${encodeURIComponent(id)}?includeResponses=true`, 'GET', context) as Json
        expected = Math.max(expected, responseCount(state))
        const current = normalize(id, state)
        if (current.responses.length > best.responses.length) best = current
        if (expected > 0 && best.responses.length >= expected) return best
        if (expected === 0 && Date.now() - settling >= this.#emptySettle) return best
        if (Date.now() - settling >= this.#settleDeadline) return best
        await this.#sleep!(this.#settle, context.signal)
      } while (true)
    } catch (error) { if (error instanceof AdapterError && error.message === 'slskd search timed out') { try { await this.#request(`searches/${encodeURIComponent(id)}`, 'DELETE', context) } catch {} } throw error }
  }
  async submitDownloadBatch(searchId:string,username:string,files:readonly SlskdDownloadFile[],destination:string,context:OperationContext,externalId?:string):Promise<string>{
    const value=await this.#request('transfers/downloads/batches/','POST',context,{searchId,username,files:files.map(f=>({filename:f.filename,size:f.size})),options:{destination,...(externalId?{externalId}:{})}}) as Json
    const batch=object(value.batch)??value;const id=text(batch.id)??text(batch.batchId);if(!id)throw this.#error('transient-provider-failure','slskd returned a batch without an identifier',true)
    if(Array.isArray(value.failures)&&value.failures.length){try{await this.rollbackBatches([id],context)}catch{}throw this.#error('transient-provider-failure',`slskd rejected ${value.failures.length} file(s) from the batch`,true)}return id
  }
  async getDownloadBatch(id:string,context:OperationContext):Promise<SlskdBatch>{return normalizeBatch(await this.#request(`transfers/downloads/batches/${encodeURIComponent(id)}`,'GET',context),id)}
  async listDownloads(context:OperationContext):Promise<readonly SlskdTransfer[]>{const value=await this.#request('transfers/downloads/','GET',context);return normalizeTransfers(value)}
  async removeTransfer(username:string,id:string,context:OperationContext):Promise<void>{await this.#request(`transfers/downloads/${encodeURIComponent(username)}/${encodeURIComponent(id)}?remove=true`,'DELETE',context)}
  async rollbackBatches(ids:readonly string[],context:OperationContext):Promise<void>{for(const id of ids){const batch=await this.getDownloadBatch(id,context);for(const transfer of batch.transfers)await this.removeTransfer(transfer.username,transfer.id,context)}}
  async summarizeBatches(ids:readonly string[],expected:number,context:OperationContext):Promise<SlskdTransferSummary>{
    const batches=await Promise.all(ids.map(id=>this.getDownloadBatch(id,context)));const transfers=batches.flatMap(b=>b.transfers);const states=transfers.map(t=>t.state.toLowerCase());const success=states.filter(s=>s.includes('completed')&&s.includes('succeeded')).length
    const bytesTotal=transfers.reduce((n,t)=>n+(t.size??0),0),bytesTransferred=transfers.reduce((n,t)=>n+(t.bytesTransferred??0),0)
    if(transfers.length===expected&&success===expected)return{state:'completed',visible:transfers.length,completed:success,bytesTotal,bytesTransferred}
    if(states.some(s=>/failed|cancelled|aborted|errored/.test(s))||transfers.length<expected&&states.every(s=>/completed|failed|cancelled|aborted|errored/.test(s)))return{state:'failed',visible:transfers.length,completed:success,bytesTotal,bytesTransferred,error:'Terminal or missing transfer'}
    if(states.some(s=>/progress|transferr|download/.test(s)))return{state:'transferring',visible:transfers.length,completed:success,bytesTotal,bytesTransferred}
    return{state:'queued',visible:transfers.length,completed:success,bytesTotal,bytesTransferred}
  }
  async #request(path: string, method: string, context: OperationContext, body?: unknown): Promise<unknown> { const signal = context.signal ? AbortSignal.any([context.signal, AbortSignal.timeout(this.#timeout)]) : AbortSignal.timeout(this.#timeout); let response: Response; try { response = await this.#fetch(new URL(path, this.#base), { method, signal, headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-API-Key': this.#key, 'X-Needle-Operation-Id': context.operationId }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }) } catch (cause) { throw this.#error('unavailable', signal.aborted ? 'slskd request timed out or was cancelled' : 'slskd is unavailable', true, undefined, cause) } if (!response.ok) throw this.#error(response.status === 401 || response.status === 403 ? 'authentication' : response.status === 404 ? 'not-found' : response.status === 429 ? 'rate-limited' : response.status >= 500 ? 'transient-provider-failure' : 'invalid-request', `slskd request failed with status ${response.status}`, response.status === 429 || response.status >= 500, response.status); if (response.status === 204) return undefined; try { return await response.json() } catch (cause) { throw this.#error('transient-provider-failure', 'slskd returned invalid JSON', true, response.status, cause) } }
  #error(code: ConstructorParameters<typeof AdapterError>[0]['code'], message: string, retryable: boolean, providerStatus?: number, cause?: unknown) { return new AdapterError({ code, adapterId: this.adapterId, message, retryable, providerStatus }, { cause }) }
}
export function createSlskdAdapterFromEnv(env: NodeJS.ProcessEnv = process.env): SlskdAdapter | null { const baseUrl = env.SLSKD_URL?.trim(), apiKey = env.SLSKD_API_KEY?.trim(); if (!baseUrl && !apiKey) return null; if (!baseUrl || !apiKey) throw new Error('SLSKD_URL and SLSKD_API_KEY must be configured together'); return new SlskdAdapter({ baseUrl, apiKey }) }
function text(v: unknown) { return typeof v === 'string' && v ? v : undefined }
function object(v: unknown): Json | undefined { return v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Json : undefined }
function complete(v: Json) { const state = (text(v.state) ?? text(v.status) ?? '').toLowerCase(); return ['completed', 'complete', 'finished'].includes(state) || v.isComplete === true }
function responseCount(v: Json) { return typeof v.responseCount === 'number' ? v.responseCount : typeof v.response_count === 'number' ? v.response_count : 0 }
function normalize(id: string, state: Json): SearchResults { const responses: SlskdResponse[] = (Array.isArray(state.responses) ? state.responses : []).flatMap(value => { if (!value || typeof value !== 'object') return []; const r = value as Json; const username = text(r.username) ?? text(r.userName); if (!username) return []; const files: SlskdFile[] = (Array.isArray(r.files) ? r.files : []).flatMap(value => { if (!value || typeof value !== 'object') return []; const f = value as Json; const filename = text(f.filename) ?? text(f.fileName); const size = typeof f.size === 'number' ? f.size : undefined; return filename && size !== undefined ? [{ filename, size, bitRate: typeof f.bitRate === 'number' ? f.bitRate : undefined, length: typeof f.length === 'number' ? f.length : undefined }] : [] }); return [{ username, files }] }); return { searchId: id, responses } }
function normalizeTransfers(value:unknown,username?:string):SlskdTransfer[]{const source=Array.isArray(value)?value:object(value)?.transfers;return(Array.isArray(source)?source:[]).flatMap(v=>{const x=object(v);const id=text(x?.id)??text(x?.transferId),user=text(x?.username)??text(x?.userName)??username,state=text(x?.state)??text(x?.status);return id&&user&&state?[{id,username:user,state,filename:text(x?.filename)??text(x?.fileName),size:typeof x?.size==='number'?x.size:undefined,bytesTransferred:typeof x?.bytesTransferred==='number'?x.bytesTransferred:undefined}]:[]})}
function normalizeBatch(value:unknown,id:string):SlskdBatch{const x=object(value);const username=text(x?.username)??text(x?.userName);return{id:text(x?.id)??text(x?.batchId)??id,username,transfers:normalizeTransfers(x?.transfers??value,username)}}
function delay(ms: number, signal?: AbortSignal) { return new Promise<void>((resolve, reject) => { const timer = setTimeout(resolve, ms); signal?.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason) }, { once: true }) }) }
