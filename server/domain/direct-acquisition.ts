import { posix } from 'node:path'
import type { OperationContext } from '../integrations/common.js'
import type { ReleaseMetadataPort } from '../integrations/musicbrainz.js'
import { groupAndMatch, type SearchResults } from '../integrations/slskd-candidates.js'
import type { SlskdTransferSummary } from '../integrations/slskd.js'
import type { AcquisitionRepository, DirectAcquisitionWorkflow } from './acquisition-repository.js'

export interface DirectSlskdPort {
  search(query:string,context:OperationContext):Promise<SearchResults>
  submitDownloadBatch(searchId:string,username:string,files:readonly {filename:string,size:number}[],destination:string,context:OperationContext,externalId?:string):Promise<string>
  rollbackBatches(ids:readonly string[],context:OperationContext):Promise<void>
  summarizeBatches(ids:readonly string[],expected:number,context:OperationContext):Promise<SlskdTransferSummary>
}
export interface DirectAcquisitionOptions { downloadsRoot?:string; pathMappings?:readonly {id:string;providerPrefix:string;needlePrefix:string}[]; maxCandidates?:number; autoSelectLead?:number }

export class DirectAcquisitionService {
  readonly #root:string;readonly #mappings:DirectAcquisitionOptions['pathMappings'];readonly #max:number;readonly #lead:number
  constructor(readonly repository:AcquisitionRepository,readonly metadata:ReleaseMetadataPort,readonly slskd:DirectSlskdPort,options:DirectAcquisitionOptions={}){this.#root=trim(options.downloadsRoot??'/downloads');this.#mappings=options.pathMappings??[{id:'orb-downloads',providerPrefix:'/downloads',needlePrefix:'/music_path/inbox'}];this.#max=options.maxCandidates??100;this.#lead=options.autoSelectLead??10}
  async search(jobId:string,context:OperationContext):Promise<DirectAcquisitionWorkflow>{
    const job=this.repository.get(jobId);if(!job?.musicBrainzReleaseGroupId||!job.artist||!job.release)throw new Error('Direct acquisition requires artist, release, and MusicBrainz release-group ID')
    const destination=`needle/${job.id}/${sanitize(`${job.artist} - ${job.release}`)}`;this.repository.beginDirectSearch(job.id,destination)
    try{const editions=await this.metadata.listReleaseEditions(job.musicBrainzReleaseGroupId,context);const searches:SearchResults[]=[]
      const queries=[`${job.artist} ${job.release}`,...(job.release.trim().split(/\s+/).length>=2?[job.release]:[])]
      for(const query of queries){const result=await this.slskd.search(query,context);searches.push(result);const ranked=groupAndMatch(searches,job.artist,job.release,editions);if(ranked.some(c=>c.score>=35&&!c.matches[0]?.rejected))break}
      const candidates=groupAndMatch(searches,job.artist,job.release,editions).slice(0,this.#max);let workflow=this.repository.storeDirectCandidates(job.id,editions,candidates,searches.map(s=>s.searchId));const top=candidates[0],next=candidates.find(c=>c.id!==top?.id)
      if(top?.autoSelectEligible&&(!next||top.score-next.score>=this.#lead))workflow=await this.select(job.id,top.id,context,`Automatic selection: score ${top.score}${next?`, lead ${top.score-next.score}`:', only candidate'}`)
      return workflow
    }catch(error){const current=this.repository.getDirectWorkflow(job.id);if(current&&this.repository.get(job.id)?.state==='searching')this.repository.storeDirectCandidates(job.id,[],[],[]);throw error}
  }
  async retry(id:string,context:OperationContext){const workflow=this.repository.getDirectWorkflow(id),job=this.repository.get(id)
    if(workflow?.submissionState==='submitted'&&job?.state==='failed'){await this.slskd.rollbackBatches(workflow.batchIds,context);this.repository.resetFailedDirectTransfer(id)}
    return this.search(id,context)}
  async select(id:string,candidateId:string,context:OperationContext,explanation='Manually selected'):Promise<DirectAcquisitionWorkflow>{
    const workflow=this.repository.getDirectWorkflow(id);if(!workflow)throw new Error('Direct workflow not found');if(workflow.submissionState!=='none')throw new Error('Transfer submission has already begun')
    const candidate=workflow.candidates.find(c=>c.id===candidateId);if(!candidate)throw new Error('Candidate not found');const match=candidate.matches[0];if(!match||match.rejected)throw new Error('Rejected candidate cannot be selected')
    const provider=posix.join(this.#root,workflow.relativeDestination),needle=this.#map(provider);this.repository.beginDirectTransfer(id,candidate.id,match.editionId,`${explanation}; ${match.reasons.join('; ')}`,candidate.audioFiles.length,provider,needle)
    const searchId=candidate.sourceSearchIds[0];if(!searchId){this.repository.markDirectSubmissionUnknown(id,'Selected candidate has no source search');throw new Error('Selected candidate has no source search')}
    const groups=new Map<string,typeof candidate.audioFiles>();for(const file of candidate.audioFiles){const relative=relativeDisc(candidate.path,file.path);const dir=posix.dirname(relative);groups.set(dir,[...(groups.get(dir)??[]),file])}
    const batches:string[]=[]
    try{for(const [dir,files] of groups){batches.push(await this.slskd.submitDownloadBatch(searchId,candidate.peer,files.map(f=>({filename:f.path,size:f.size})),dir==='.'?workflow.relativeDestination:posix.join(workflow.relativeDestination,dir),context,id))}}
    catch(error){try{await this.slskd.rollbackBatches(batches,context)}catch{}this.repository.markDirectSubmissionUnknown(id,`Submission failed after ${batches.length} batch(es); successful transfers were removed but files may remain`);throw error}
    try{return this.repository.confirmDirectBatches(id,batches)}catch(error){this.repository.markDirectSubmissionUnknown(id,'Provider accepted transfer but durable confirmation failed');throw error}
  }
  async reconcile(id:string,context:OperationContext){const workflow=this.repository.getDirectWorkflow(id),job=this.repository.get(id);if(!workflow||workflow.submissionState!=='submitted'||job?.state==='importing'||job?.importRef)return{workflow,summary:undefined};const summary=await this.slskd.summarizeBatches(workflow.batchIds,workflow.expectedFileCount,context);return{workflow:this.repository.reconcileDirect(id,summary.state,summary.error),summary}}
  #map(provider:string){for(const m of this.#mappings??[]){const p=trim(m.providerPrefix);if(provider===p||provider.startsWith(`${p}/`))return `${trim(m.needlePrefix)}${provider.slice(p.length)}`}return provider}
}
function sanitize(value:string){return value.normalize('NFKC').replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').replace(/\s+/g,' ').trim().slice(0,180)||'release'}
function trim(value:string){return value.length>1?value.replace(/\/+$/,''):value}
function relativeDisc(root:string,file:string){const normalize=(s:string)=>s.replace(/\\/g,'/');const r=normalize(root),f=normalize(file);return f.startsWith(`${r}/`)?f.slice(r.length+1):posix.basename(f)}
