/** Explicit-organization text-only pilot. No provider keys, user-chosen URLs/models,
 * paid fallback, tool dispatch or claim that audio/other app endpoints are free.
 */
import { GatewayError, boundedGatewayJson, type EnvReader } from './gateway-routing.ts';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ENDPOINT = 'https://api.firboai.app/v1/firbo/free/chat/completions';
export type FreeTrace = {request_id:string;mode:'free';route:'firbo-free';reported_model:string;status:'succeeded';
  cost_basis:'self_hosted_no_metered_fee'|'verified_free_api';infrastructure_cost_excluded:true;provider_fee_usd:0};
export type FreeCompletion = {completion:{choices:[{message:{content:string}}];usage:{prompt_tokens:number;completion_tokens:number}};cost:0;trace:FreeTrace};
export function freeForOrganization(org: string, env: EnvReader): boolean {
  const raw=env('FIRBO_FREE_ORGANIZATIONS')??'';
  if(!raw.trim())return false;
  const ids=raw.split(',').map(x=>x.trim()).filter(Boolean);
  if(raw.length>10_000||ids.some(id=>!UUID.test(id))||!UUID.test(org))throw new GatewayError('free_company_configuration_invalid');
  return ids.some(id=>id.toLowerCase()===org.toLowerCase());
}
export async function completeViaFree(org:string, authorization:string, requestId:string,
  messages:{role:string;content:string}[], options:{signal?:AbortSignal;fetcher?:typeof fetch;timeoutMs?:number}={}):Promise<FreeCompletion>{
  if(!UUID.test(org)||!UUID.test(requestId)||!/^Bearer [^\s]{1,8192}$/i.test(authorization))throw new GatewayError('free_identity_required');
  const body=JSON.stringify({organization_id:org,request_id:requestId,messages});
  if(!messages.length||messages.length>24||new TextEncoder().encode(JSON.stringify(messages)).length>2800)throw new GatewayError('free_context_too_large');
  const timeout=options.timeoutMs??90_000;
  if(!Number.isInteger(timeout)||timeout<1||timeout>90_000)throw new GatewayError('free_timeout_invalid');
  const controller=new AbortController();const cancel=()=>controller.abort();
  options.signal?.addEventListener('abort',cancel,{once:true});if(options.signal?.aborted)cancel();
  const timer=setTimeout(cancel,timeout);let response:Response|undefined;
  let stop=()=>{};
  const cancelled=new Promise<never>((_,reject)=>{stop=()=>reject(new GatewayError('free_request_cancelled'));controller.signal.addEventListener('abort',stop,{once:true});if(controller.signal.aborted)stop();});
  try{
    if(controller.signal.aborted){void cancelled.catch(()=>{});throw new GatewayError('free_request_cancelled');}
    response=await Promise.race([(options.fetcher??fetch)(ENDPOINT,{method:'POST',redirect:'error',signal:controller.signal,
      headers:{'content-type':'application/json',authorization},body}),cancelled]);
    if(!response.ok)throw new GatewayError('free_http_'+response.status);
    if(!(response.headers.get('content-type')??'').toLowerCase().includes('application/json'))throw new GatewayError('free_invalid_response');
    const data=await boundedGatewayJson(response,controller.signal,128_000) as any;
    const meta=data?.firbo,usage=data?.usage,choice=data?.choices?.[0];
    const basis=meta?.cost_basis;
    if(meta?.contract!=='firbo-free-text/v1'||meta.request_id!==requestId||meta.policy!=='no-paid-fallback'||meta.provider_fee_usd!==0||meta.infrastructure_cost_excluded!==true
       ||!['self_hosted_no_metered_fee','verified_free_api'].includes(basis))throw new GatewayError('free_policy_not_verified');
    if(typeof data?.model!=='string'||!(/^(ollama:qwen3:(1\.7b|4b|8b)|openrouter:[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+:free)$/.test(data.model)))throw new GatewayError('free_model_not_verified');
    if((data.model.startsWith('ollama:')&&basis!=='self_hosted_no_metered_fee')||(data.model.startsWith('openrouter:')&&basis!=='verified_free_api'))throw new GatewayError('free_policy_not_verified');
    if(!usage||![usage.prompt_tokens,usage.completion_tokens].every(n=>Number.isSafeInteger(n)&&n>=0&&n<=1_000_000))throw new GatewayError('free_usage_missing');
    if(typeof choice?.message?.content!=='string'||!choice.message.content.trim()||choice.message.tool_calls||choice.message.refusal||!['stop','length'].includes(choice.finish_reason))throw new GatewayError('free_invalid_response');
    return{completion:{choices:[{message:{content:choice.message.content}}],usage},cost:0,
      trace:{request_id:requestId,mode:'free',route:'firbo-free',reported_model:data.model,status:'succeeded',cost_basis:basis,infrastructure_cost_excluded:true,provider_fee_usd:0}};
  }catch(error){throw error instanceof GatewayError?error:new GatewayError('free_transport_error');}
  finally{clearTimeout(timer);options.signal?.removeEventListener('abort',cancel);controller.signal.removeEventListener('abort',stop);controller.abort();if(response?.body&&!response.body.locked)void response.body.cancel().catch(()=>{});}
}


/** Classify legacy direct-provider failures without revealing messages, keys or prompts.
 * These diagnostic codes do not by themselves authorize an automatic retry. */
export function legacyProviderFailureCode(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  const match = /^[a-z0-9_-]{1,32}_http_(\d{3})$/.exec(message);
  if (match) {
    const status = Number(match[1]);
    if (status === 429) return 'model_provider_rate_limited';
    if (status === 401 || status === 403) return 'model_provider_auth_error';
    if (status === 402) return 'model_provider_payment_required';
    if (status === 400 || status === 404) return 'model_request_rejected';
    if (status >= 500 && status <= 599) return 'model_provider_unavailable';
    return 'model_provider_http_error';
  }
  if (/^[a-z0-9_-]{1,32}_empty$/.test(message)) return 'model_empty_response';
  if (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name))
    return 'model_timeout_or_cancelled';
  return 'model_error';
}

/** Local CEO text recovery is explicitly opt-in, tenant allowlisted and limited to
 * a definite provider HTTP 429 (rejected before completion). Never replay on
 * transport errors, timeouts, 5xx or an opaque gateway outcome. Own keys, other
 * companies and non-CEO agents are unchanged. Disabled by default. */
export function approvedFreeCeoFallback(input: {
  organizationId: string; isCeo: boolean; hasOwnKey: boolean;
  alreadyFree: boolean; errorCode: string; env: EnvReader;
}): boolean {
  if (!input.isCeo || input.hasOwnKey || input.alreadyFree
    || input.errorCode !== 'model_provider_rate_limited'
    || input.env('FIRBO_ALLOW_LOCAL_FALLBACK') !== 'on') return false;
  try { return freeForOrganization(input.organizationId, input.env); }
  catch { return false; }
}
