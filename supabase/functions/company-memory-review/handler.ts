// CMEM-01: deliberate human publication of company knowledge.
// No model-proposed/ownerless memory is automatically made visible.
// Imports no database secrets on the client; createClient injected for tests.
type Env = (key:string)=>string|undefined;
export interface CompanyMemoryDeps {createClient:(...args:any[])=>any;env:Env}
const HEADERS={
  'access-control-allow-origin':'*',
  'access-control-allow-headers':'authorization,apikey,content-type,x-client-info',
  'access-control-allow-methods':'POST,OPTIONS',
  'cache-control':'private,no-store',
  'x-content-type-options':'nosniff',
};
const reply=(status:number,data:unknown)=>new Response(JSON.stringify(data),{
  status,headers:{...HEADERS,'content-type':'application/json'},
});
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const TYPES=new Set(['company','project','instruction','decision','fact']);
async function parseBoundedBody(req:Request,max=8192):Promise<Record<string,unknown>|null>{
  if(!req.body)return null;
  const reader=req.body.getReader();
  const chunks:Uint8Array[]=[];let total=0;
  try{
    while(true){
      const part=await reader.read();
      if(part.done)break;
      total+=part.value.byteLength;
      if(total>max)return null;
      chunks.push(part.value);
    }
    const buf=new Uint8Array(total),decoder=new TextDecoder();
    let at=0;for(const chunk of chunks){buf.set(chunk,at);at+=chunk.byteLength;}
    const body=JSON.parse(decoder.decode(buf));
    return body&&typeof body==='object'&&!Array.isArray(body)?body:null;
  }catch{return null}finally{void reader.cancel().catch(()=>{});}
}
const str=(v:unknown,max=1000)=>typeof v==='string'?v.replace(/\s+/g,' ').trim().slice(0,max+1):'';
export function createCompanyMemoryHandler({createClient,env}:CompanyMemoryDeps){
 return async (req:Request):Promise<Response>=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:HEADERS});
  if(req.method!=='POST')return reply(405,{error:'method_not_allowed'});
  const bearer=req.headers.get('Authorization');
  if(!bearer||!/^Bearer \S{10,}$/.test(bearer))return reply(401,{error:'unauthorized'});
  const url=env('SUPABASE_URL'),anon=env('SUPABASE_ANON_KEY'),secret=env('SUPABASE_SERVICE_ROLE_KEY');
  if(!url||!anon||!secret)return reply(503,{error:'not_configured'});
  const body=await parseBoundedBody(req);
  if(!body)return reply(400,{error:'invalid_json_or_size'});
  const action=str(body.action,40),org=str(body.organization_id,80);
  if(!UUID.test(org)||!['list_proposals','list_published','publish','publish_manual','revoke'].includes(action))
   return reply(400,{error:'bad_request'});
  try{
   const authClient=createClient(url,anon,{global:{headers:{Authorization:bearer}}});
   const who=await authClient.auth.getUser();
   const user=who?.data?.user;
   if(who?.error||!user?.id)return reply(401,{error:'unauthorized'});
   const admin=createClient(url,secret);
   const member=await admin.from('organization_members').select('role')
     .eq('organization_id',org).eq('user_id',user.id).maybeSingle();
   if(member.error)return reply(503,{error:'authorization_unavailable'});
   if(!['owner','admin'].includes(member.data?.role))return reply(403,{error:'owner_review_required'});

   if(action==='list_proposals'){
    const data=await admin.from('memories').select('id,content,memory_type,created_at')
      .eq('organization_id',org).is('user_id',null)
      .eq('metadata->>source','learned').order('created_at',{ascending:false}).limit(80);
    if(data.error)return reply(503,{error:'review_unavailable'});
    return reply(200,{proposals:(data.data??[]).map((m:any)=>({
      id:m.id,content:String(m.content??'').slice(0,1000),
      memory_type:m.memory_type,created_at:m.created_at,
    }))});
   }
   if(action==='list_published'){
    const result=await admin.from('company_memory_publications')
      .select('id,content,memory_type,importance,approved_at,source_memory_id')
      .eq('organization_id',org).is('revoked_at',null)
      .order('approved_at',{ascending:false}).limit(100);
    if(result.error)return reply(503,{error:'published_memory_unavailable'});
    return reply(200,{publications:result.data??[]});
   }
   if(action==='publish'||action==='publish_manual'){
    if(body.confirm_reviewed!==true)return reply(400,{error:'owner_review_confirmation_required'});
    const content=str(body.content),type=str(body.memory_type,25);
    const importance=Number(body.importance??0.7);
    if(content.length<12||content.length>1000||!TYPES.has(type)||
      !Number.isFinite(importance)||importance<0.1||importance>1)
      return reply(400,{error:'invalid_publication'});
    let sourceId:string|null=null;
    if(action==='publish'){
      sourceId=str(body.source_memory_id,80);
      if(!UUID.test(sourceId))return reply(400,{error:'source_id_required'});
      const source=await admin.from('memories').select('id,organization_id,user_id,metadata')
        .eq('id',sourceId).eq('organization_id',org).is('user_id',null)
        .eq('metadata->>source','learned').maybeSingle();
      if(source.error)return reply(503,{error:'source_check_unavailable'});
      if(!source.data)return reply(404,{error:'proposal_not_found'});
    }else if(body.source_memory_id!==undefined&&body.source_memory_id!==null){
      return reply(400,{error:'manual_publication_has_no_source'});
    }
    const inserted=await admin.from('company_memory_publications').insert({
      organization_id:org,source_memory_id:sourceId,content,memory_type:type,
      importance,approved_by:user.id,
    }).select('id').single();
    if(inserted.error){
      if(inserted.error.code==='23505')return reply(409,{error:'already_published'});
      return reply(503,{error:'publication_unavailable'});
    }
    return reply(201,{published_id:inserted.data.id});
   }
   const id=str(body.publication_id,80);
   if(!UUID.test(id))return reply(400,{error:'publication_id_required'});
   const revoked=await admin.from('company_memory_publications')
     .update({revoked_at:new Date().toISOString(),revoked_by:user.id})
     .eq('id',id).eq('organization_id',org).is('revoked_at',null).select('id');
   if(revoked.error)return reply(503,{error:'revocation_unavailable'});
   if(!Array.isArray(revoked.data)||revoked.data.length!==1)
     return reply(404,{error:'publication_not_found'});
   return reply(200,{revoked_id:id});
  }catch{return reply(503,{error:'review_unavailable'});}
 };
}
