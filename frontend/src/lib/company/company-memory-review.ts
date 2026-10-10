import {requireClient} from './client';

export interface LegacyMemoryProposal {
 id:string;content:string;memory_type:string;created_at:string;
}
export interface ReviewedCompanyMemory {
 id:string;content:string;memory_type:string;importance:number;
 approved_at:string;source_memory_id:string|null;
}
type ReviewAction='list_proposals'|'list_published'|'publish'|'publish_manual'|'revoke';
async function call(orgId:string,action:ReviewAction,extra:Record<string,unknown>={}):Promise<Record<string,unknown>>{
 if(!orgId)throw Error('company_scope_required');
 const {data,error}=await requireClient().functions.invoke('company-memory-review',{
  body:{organization_id:orgId,action,...extra},
 });
 if(error||!data||typeof data!=='object'||Array.isArray(data)||('error' in data))
  throw Error('company_memory_review_unavailable');
 return data as Record<string,unknown>;
}
export async function loadLegacyProposals(orgId:string):Promise<LegacyMemoryProposal[]>{
 const value=await call(orgId,'list_proposals');
 if(!Array.isArray(value.proposals))throw Error('invalid_review_response');
 return value.proposals as LegacyMemoryProposal[];
}
export async function loadApprovedCompanyMemory(orgId:string):Promise<ReviewedCompanyMemory[]>{
 const value=await call(orgId,'list_published');
 if(!Array.isArray(value.publications))throw Error('invalid_review_response');
 return value.publications as ReviewedCompanyMemory[];
}
export async function publishCompanyMemory(orgId:string,opts:{
 sourceId?:string;content:string;memoryType:'company'|'project'|'instruction'|'decision'|'fact';importance:number;
}):Promise<string>{
 const value=await call(orgId,opts.sourceId?'publish':'publish_manual',{
  content:opts.content,source_memory_id:opts.sourceId??undefined,
  memory_type:opts.memoryType,importance:opts.importance,confirm_reviewed:true,
 });
 if(typeof value.published_id!=='string')throw Error('publication_unconfirmed');
 return value.published_id;
}
export async function revokeCompanyMemory(orgId:string,id:string):Promise<void>{
 const value=await call(orgId,'revoke',{publication_id:id});
 if(value.revoked_id!==id)throw Error('revocation_unconfirmed');
}
