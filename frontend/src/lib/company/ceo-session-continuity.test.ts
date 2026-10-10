import {describe,it,expect,vi} from 'vitest';
import {ceoSessionStorageKey,chooseCeoSession,rememberCeoSession,type CeoSessionStore} from './ceo-session-continuity';
const memory=():CeoSessionStore=>{
 const map=new Map<string,string>();return {
  getItem:(k)=>map.get(k)??null,
  setItem:(k,v)=>{map.set(k,v)},
  removeItem:(k)=>{map.delete(k)}
 };
};
const previews=[{id:'ceo-a'},{id:'ceo-b'}];
describe('one shared personal CEO session, no cross-user read authority',()=>{
 it('remembers one selected CEO session across both interfaces for one user',()=>{
  const store=memory();rememberCeoSession('org-A','alice','ceo-agent','ceo-b',store);
  expect(chooseCeoSession(previews,'org-A','alice','ceo-agent',store)?.id).toBe('ceo-b');
  expect(chooseCeoSession(previews,'org-A','bob','ceo-agent',store)?.id).toBe('ceo-a');
  expect(chooseCeoSession(previews,'org-B','alice','ceo-agent',store)?.id).toBe('ceo-a');
  expect(chooseCeoSession(previews,'org-A','alice','another-ceo',store)?.id).toBe('ceo-a');
 });
 it('rejects stale, forged, foreign or deleted pointers by matching only the scoped query rows',()=>{
  const store=memory();rememberCeoSession('org','owner','ceo','another-users-session',store);
  expect(chooseCeoSession(previews,'org','owner','ceo',store)?.id).toBe('ceo-a');
  expect(chooseCeoSession([],'org','owner','ceo',store)).toBeNull();
  rememberCeoSession('org','owner','ceo','ceo-b',store);
  expect(chooseCeoSession([{id:'ceo-a'}],'org','owner','ceo',store)?.id).toBe('ceo-a');
 });
 it('clears only this users session preference on New Session',()=>{
  const store=memory();rememberCeoSession('org','alice','ceo','ceo-b',store);
  rememberCeoSession('org','bob','ceo','bob-session',store);
  rememberCeoSession('org','alice','ceo',null,store);
  expect(store.getItem(ceoSessionStorageKey('org','alice','ceo')!)).toBeNull();
  expect(store.getItem(ceoSessionStorageKey('org','bob','ceo')!)).toBe('bob-session');
 });
 it('fails open only to the first authorized preview when storage is blocked',()=>{
  const bad:CeoSessionStore={getItem:()=>{throw Error('denied')},setItem:()=>{throw Error('denied')},removeItem:()=>{throw Error('denied')}};
  expect(()=>rememberCeoSession('org','owner','ceo','ceo-b',bad)).not.toThrow();
  expect(chooseCeoSession(previews,'org','owner','ceo',bad)?.id).toBe('ceo-a');
 });
 it('rejects invalid scope and never places transcripts or plaintext facts in the storage key',()=>{
  const store=memory();expect(ceoSessionStorageKey('','u','ceo')).toBeNull();
  rememberCeoSession('','u','ceo','ceo-b',store);
  expect(chooseCeoSession(previews,'','u','ceo',store)?.id).toBe('ceo-a');
  expect(ceoSessionStorageKey('org','owner','ceo')).not.toMatch(/password|content|prompt/);
 });
});
