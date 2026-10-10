import { describe, expect, it } from 'vitest';
import { clearCeoLocalBackup, observeCeoCloudFailure, preferCeoLocalBackup } from './ceo-ollama-backup';

describe('CEO-only Ollama standby for future turns',()=>{
  const time=1_780_000_000_000;
  it('is OFF until a cloud inference failure and never replays the old call',()=>{
    const scope=['co-zero','owner-zero','ceo-zero'] as const;
    expect(preferCeoLocalBackup(...scope,time)).toBe(false);
    expect(observeCeoCloudFailure(...scope,'model_error','model_error',time)).toBe(true);
    expect(preferCeoLocalBackup(...scope,time+1)).toBe(true);
    expect(preferCeoLocalBackup(...scope,time+4*60_000)).toBe(false);
  });
  it('accepts trusted provider rejection or gateway error codes only',()=>{
    const scope=['co-errors','owner-errors','ceo-errors'] as const;
    for(const [code,reason] of [
      ['model_error','gateway_http_429'],
      ['model_error','gateway_http_503'],
      ['model_error','gateway_timeout_or_cancelled'],
      ['model_error','model_provider_rate_limited'],
    ])expect(observeCeoCloudFailure(...scope,code,reason,time)).toBe(true);
    clearCeoLocalBackup(...scope);
    expect(observeCeoCloudFailure(...scope,'forbidden','model_error',time)).toBe(false);
    expect(observeCeoCloudFailure(...scope,'budget_exceeded','model_error',time)).toBe(false);
    expect(observeCeoCloudFailure(...scope,'rate_limited','model_error',time)).toBe(false);
    expect(observeCeoCloudFailure(...scope,'model_error','own_key_openai_http_402',time)).toBe(false);
    expect(preferCeoLocalBackup(...scope,time+1)).toBe(false);
  });
  it('never shares fallback mode with another organization, owner or agent',()=>{
    const scope=['org-a','owner-a','ceo-a'] as const;
    observeCeoCloudFailure(...scope,'model_error',undefined,time);
    expect(preferCeoLocalBackup('org-b','owner-a','ceo-a',time+1)).toBe(false);
    expect(preferCeoLocalBackup('org-a','owner-b','ceo-a',time+1)).toBe(false);
    expect(preferCeoLocalBackup('org-a','owner-a','ceo-b',time+1)).toBe(false);
    clearCeoLocalBackup(...scope);
    expect(preferCeoLocalBackup(...scope,time+1)).toBe(false);
  });
  it('clears standby after a successful main-provider call and never persists secrets',()=>{
    const scope=['org-clean','owner-clean','ceo-clean'] as const;
    observeCeoCloudFailure(...scope,'model_error','gateway_error',time);
    expect(preferCeoLocalBackup(...scope,time+500)).toBe(true);
    clearCeoLocalBackup(...scope);
    expect(preferCeoLocalBackup(...scope,time+500)).toBe(false);
    expect(observeCeoCloudFailure('','','','model_error','model_error',time)).toBe(false);
  });
});