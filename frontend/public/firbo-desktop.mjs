import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';

const stop = signal => { if (signal?.aborted) throw new Error('operation_stopped'); };
export async function desktopAction(action, { signal, spawnImpl = spawn } = {}) {
  stop(signal);
  return new Promise((resolve, reject) => {
    const child = spawnImpl('/usr/bin/python3', [fileURLToPath(new URL('./firbo-desktop.py', import.meta.url))], {stdio:['pipe','pipe','pipe'], detached:true});
    let bytes=0, output='', interrupted=false, reason='desktop_adapter_failed', escalation;
    const kill = sig => { try { process.kill(-child.pid,sig); } catch { /* Wait for close, never infer it. */ } };
    const interrupt = code => { if(interrupted)return;interrupted=true;reason=code;kill('SIGTERM');escalation=setTimeout(()=>kill('SIGKILL'),500); };
    const aborted = () => interrupt('operation_stopped');
    const timer=setTimeout(()=>interrupt('desktop_adapter_timeout'),15000);
    signal?.addEventListener('abort',aborted,{once:true});
    const clean=()=>{clearTimeout(timer);clearTimeout(escalation);signal?.removeEventListener('abort',aborted);};
    child.on('error',()=>{clean();reject(new Error('desktop_adapter_failed'));});
    child.stdout.on('data',part=>{bytes+=part.length;if(bytes>140000)interrupt('desktop_capture_too_large');else output+=part.toString();});
    child.stderr.resume();
    child.stdin.on('error',()=>{});
    child.on('close',code=>{clean();if(interrupted)return reject(new Error(reason));try{const out=JSON.parse(output);if(code!==0||out.error)throw new Error(/^desktop_[a-z_]+$/.test(out.error)?out.error:'desktop_adapter_failed');resolve(out);}catch(error){reject(error);}});
    child.stdin.end(JSON.stringify(action));
    if(signal?.aborted)aborted();
  });
}

/** One durable job owns the observe -> plan -> act loop. Neither models nor
 * network retries may rerun a physical action. Applications persist afterwards. */
export async function executeDesktopTask(job,cfg,{signal,call,act=desktopAction,shell,now=Date.now,maxSteps=128}={}) {
  if(cfg.allowDesktop!==true||cfg.fullControl!==true)throw new Error('desktop_disabled');
  if(typeof job.params?.goal!=='string'||!job.params.goal.trim()||job.params.goal.length>4000)throw new Error('bad_job_params');
  const history=[],inferenceReceipts=[],started=now();
  let observations=0, actions=0, lastHash=null;
  for(let step=0;step<maxSteps&&now()-started<15*60_000;step++){
    stop(signal);
    const frame=await act({action:'observe'},{signal});
    if(!frame.image||!Number.isInteger(frame.width)||!Number.isInteger(frame.height))throw new Error('desktop_bad_capture');
    lastHash=createHash('sha256').update(frame.image).digest('hex');observations++;
    const next=await call('desktop_plan',{token:cfg.token,job_id:job.id,request_id:randomUUID(),frame,history:history.slice(-12),allow_exec:cfg.allowExec===true},{signal});
    stop(signal);
    if(!next||typeof next.action!=='object'||!next.action)throw new Error('desktop_bad_plan');
    if(typeof next.request_id==='string')inferenceReceipts.push(next.request_id);
    const action=next.action;
    if(action.action==='done'){
      if(typeof action.summary!=='string'||!action.summary.trim())throw new Error('desktop_bad_plan');
      return {completed:true,summary:action.summary.slice(0,3000),observations,actions,inference_receipts:inferenceReceipts,last_frame_sha256:lastHash,verification:'model_screen_observation',applications_remain_open:true};
    }
    if(action.action==='blocked')return {completed:false,summary:String(action.summary??'Needs owner input').slice(0,3000),observations,actions,inference_receipts:inferenceReceipts,last_frame_sha256:lastHash};
    // Recheck server authorization after inference and immediately before input.
    const control=await call('control',{token:cfg.token,job_id:job.id},{signal});
    if(control?.ok!==true||control.job_id!==job.id||control.stop||control.terminal)throw new Error('operation_stopped');
    stop(signal);
    let result;
    if(action.action==='shell'){
      if(cfg.allowExec!==true||typeof shell!=='function')throw new Error('commands_disabled');
      result=await shell(action.command,signal);
      if(result?.interrupted)throw new Error('operation_stopped');
    }else result=await act({...action,width:frame.width,height:frame.height,screen_width:frame.screen_width,screen_height:frame.screen_height},{signal});
    actions++;
    history.push({action,result:JSON.stringify(result).slice(0,2000)});
  }
  return {completed:false,summary:'Session checkpoint reached; inspect the current desktop before continuing.',observations,actions,inference_receipts:inferenceReceipts,last_frame_sha256:lastHash};
}
