import {describe,it,expect} from 'vitest';
import {validCeoScope,canUsePersonalResource,canReadCeoMemory,personalComputerPreferenceKey,buildCeoPersonalization} from './ceo-identity-scope';
const scope={organizationId:'company-A',userId:'alice',agentId:'ceo-1'};
describe('CEO per-user/tenant isolation contracts',()=>{
 it('fails closed without full identity',()=>{expect(validCeoScope({...scope,userId:''})).toBe(false);expect(personalComputerPreferenceKey('company-A','')).toBeNull();expect(buildCeoPersonalization({scope:{...scope,agentId:''},ownerInstructions:'x'})).toBeNull();});
 it('keeps computer choice separate even within the same company',()=>{
  expect(personalComputerPreferenceKey('company-A','alice')).not.toBe(personalComputerPreferenceKey('company-A','bob'));
  expect(personalComputerPreferenceKey('company-A','alice')).not.toBe(personalComputerPreferenceKey('company-B','alice'));
  expect(canUsePersonalResource(scope,{organizationId:'company-A',userId:'alice'})).toBe(true);
  expect(canUsePersonalResource(scope,{organizationId:'company-A',userId:'bob'})).toBe(false);
  expect(canUsePersonalResource(scope,{organizationId:'company-B',userId:'alice'})).toBe(false);
  expect(canUsePersonalResource(scope,{organizationId:'company-A'})).toBe(false);
 });
 it('does not share personal or agent memory with other users or agents',()=>{
  expect(canReadCeoMemory(scope,{organizationId:'company-A',userId:'alice',visibility:'personal'})).toBe(true);
  expect(canReadCeoMemory(scope,{organizationId:'company-A',userId:'bob',visibility:'personal'})).toBe(false);
  expect(canReadCeoMemory(scope,{organizationId:'company-A',userId:'alice',agentId:'ceo-1',visibility:'agent'})).toBe(true);
  expect(canReadCeoMemory(scope,{organizationId:'company-A',userId:'alice',agentId:'other-agent',visibility:'agent'})).toBe(false);
 });
 it('shares only explicitly approved, company-scoped knowledge',()=>{
  const memory={organizationId:'company-A',visibility:'company' as const};
  expect(canReadCeoMemory(scope,{...memory,approved:true})).toBe(true);
  expect(canReadCeoMemory(scope,{...memory,approved:false})).toBe(false);
  expect(canReadCeoMemory(scope,{...memory,userId:'bob',approved:true})).toBe(false);
  expect(canReadCeoMemory(scope,{...memory,organizationId:'company-B',approved:true})).toBe(false);
 });
 it('applies distinct user-defined CEO behavior without altering authorization',()=>{
  const a=buildCeoPersonalization({scope,ownerInstructions:'Answer in Greek',workingStyle:'Concise'});
  const b=buildCeoPersonalization({scope,ownerInstructions:'Answer in English',workingStyle:'Detailed'});
  expect(a).toContain('Answer in Greek');expect(b).toContain('Answer in English');expect(a).not.toEqual(b);
  expect(canUsePersonalResource(scope,{organizationId:'company-A',userId:'bob'})).toBe(false);
 });
});
