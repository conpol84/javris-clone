import { canonicalDispatch } from './worker-dispatch.ts';

/** Publish a completed employee report only after its correlated computer jobs
 * have terminal durable receipts. Never runs a model, queues or replays input. */
export async function finalizePendingComputerExecution(db:any,taskId:string,organizationId:string,runClaim?:string):Promise<{status:string;result?:any}|null>{
  const{data:task,error:te}=await db.from('tasks').select('id,organization_id,status,run_claim,assigned_agent_id,result').eq('id',taskId).eq('organization_id',organizationId).maybeSingle();
  if(te||!task||task.status!=='running'||!task.run_claim||runClaim&&task.run_claim!==runClaim)return null;
  const marker=task.result?.computer_execution;
  if(marker?.contract!=='firbo-worker-execution/v1'||marker.ready_to_finalize!==true||marker.status==='unknown'||task.result?.reconcile_required===true||!Array.isArray(marker.jobs)||!marker.jobs.length||marker.jobs.length>10)return null;
  const{data:jobs,error:je}=await db.from('connector_jobs').select('id,organization_id,device_id,kind,params,status,result,error,cancel_requested_at,origin,agent_task_id,agent_id,agent_run_claim,receipt,report_sha256').eq('organization_id',organizationId).eq('agent_task_id',taskId);
  if(je||!jobs)return null;
  const terminal:any[]=[];
  for(const expected of marker.jobs){
    const job=jobs.find((j:any)=>j.id===expected.job_id);
    if(!job||job.origin!=='agent'||job.agent_id!==task.assigned_agent_id||job.agent_run_claim!==task.run_claim||expected.run_claim!==task.run_claim
      ||job.device_id!==expected.device_id||job.kind!==expected.kind||canonicalDispatch(job.params)!==canonicalDispatch(expected.params))return null;
    if(['queued','running'].includes(job.status))return{status:'running',result:task.result};
    if(!['done','error','cancelled'].includes(job.status))return null;
    if(job.status!=='cancelled'&&(job.receipt?.contract!=='firbo-execution-receipt/v1'||job.receipt.job_id!==job.id||job.receipt.device_id!==job.device_id
      ||job.receipt.kind!==job.kind||job.receipt.report_sha256!==job.report_sha256||!/^[0-9a-f]{64}$/.test(job.report_sha256??'')||job.receipt.ok!==(job.status==='done')))return null;
    terminal.push(job);
  }
  if(jobs.some((j:any)=>['queued','running'].includes(j.status)))return{status:'running',result:task.result};
  const{data:approvals,error:ae}=await db.from('approvals').select('id').eq('organization_id',organizationId).eq('task_id',taskId).eq('status','pending').limit(1);
  if(ae||approvals?.length)return{status:'running',result:task.result};
  const observed=(j:any)=>j.status==='done'&&!j.cancel_requested_at&&(j.kind==='desktop_task'||j.kind==='browser_task'?j.result?.completed===true&&j.result?.blocked!==true:
    j.kind==='open_app'?j.result?.opened===true&&j.result?.app===j.params.app:j.kind==='browser_open'?j.result?.launched===true:
    j.kind==='exec'?j.result?.code===0&&!j.result?.signal&&!j.result?.interrupted:
    j.kind==='shortcut'?j.result?.ran===true&&j.result?.name===j.params.name:
    j.kind==='list'?typeof j.result?.path==='string'&&Array.isArray(j.result?.entries):
    j.kind==='read'?typeof j.result?.content==='string'&&/^[0-9a-f]{64}$/.test(j.result?.sha256??''):
    j.kind==='write'?j.result?.verification?.method==='sha256-readback'&&/^[0-9a-f]{64}$/.test(j.result?.verification?.sha256??''):false);
  const verified=terminal.every(observed),failed=terminal.some(j=>j.status==='error'||j.status==='cancelled');
  const status=verified?'completed':failed?'failed':'blocked';
  const execution={...marker,status,verified_success:verified,jobs:marker.jobs.map((e:any)=>{
    const j=terminal.find(j=>j.id===e.job_id);return{...e,status:j.status,result:j.result,error:j.error??null,receipt:j.receipt??null};
  })};
  const observations=terminal.map(j=>({worker:marker.jobs.find((e:any)=>e.job_id===j.id)?.device_name??j.device_id,
    summary:typeof j.result?.summary==='string'?j.result.summary:j.error??`${j.kind}: ${j.status}`,job_id:j.id}));
  const result={...task.result,computer_execution:execution,verified_success:verified,
    summary:observations.map(o=>`${o.worker}: ${o.summary}`).join('\n').slice(0,400),
    report:observations.map(o=>`${o.worker}: ${o.summary}\nJob: ${o.job_id}`).join('\n\n'),
    ...(task.result?.report?{unverified_draft:task.result.unverified_draft??task.result.report}:{})};
  // These fields belong to existing SQL provenance and cannot be supplied as a
  // new model report. publish_task_run retains them from current task state.
  for(const key of ['execution_receipts','last_execution','execution_job_id','execution_status','execution_decision'])delete result[key];
  const{data:saved,error:se}=await db.rpc('publish_task_run',{p_org:organizationId,p_task:taskId,p_claim:task.run_claim,p_result:result,p_approvals:[],p_status:status});
  if(se||saved?.id!==taskId||saved?.organization_id!==organizationId||saved?.run_claim!==task.run_claim||saved?.status!==status)return null;
  return{status,result};
}
