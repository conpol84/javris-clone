import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ states: [] as unknown[], refs: [] as { current: any }[], index: 0, refIndex: 0, effects: [] as (() => void | (() => void))[], role: 'owner', org: 'org', user: 'owner', setters: [] as ReturnType<typeof vi.fn>[] }));
const dispatch = vi.hoisted(() => vi.fn());
const prepare = vi.hoisted(() => vi.fn());
const sendChat = vi.hoisted(() => vi.fn());
const listen = vi.hoisted(() => vi.fn());
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: () => { const i = fixture.index++; const setter = vi.fn(); fixture.setters[i] = setter; return [fixture.states[i], setter]; },
  useRef: (initial: unknown) => fixture.refs[fixture.refIndex++] ?? { current: initial },
  useEffect: (callback: () => void | (() => void)) => { fixture.effects.push(callback); },
  useCallback: (callback: unknown) => callback, useMemo: (callback: () => unknown) => callback(),
}));
vi.mock('react-router', () => ({ useSearchParams: () => [new URLSearchParams('c=chat'), vi.fn()] }));
vi.mock('../lib/company/AuthProvider', () => ({ useCompanyAuth: () => ({ current: { role: fixture.role, organization: { id: fixture.org } }, user: { id: fixture.user } }) }));
vi.mock('../i18n/I18nProvider', () => ({ useI18n: () => ({ lang: 'en', t: (key: string) => key, fmt: { relative: () => 'now', date: () => 'today' } }) }));
vi.mock('../lib/company/labels', () => ({ agentLabel: () => ({ name: 'CEO' }) }));
vi.mock('../lib/company/voice', () => ({ unlockAudio: vi.fn(), speak: vi.fn(), listenSmart: listen }));
vi.mock('../lib/company/runner', async original => ({ ...await original<typeof import('../lib/company/runner')>(), sendChat }));
vi.mock('../lib/company/laptop-bridge', async original => ({ ...await original<typeof import('../lib/company/laptop-bridge')>(), dispatchDirectComputerCommand: dispatch, prepareDirectComputerCommand: prepare }));
import { AgentChatPage } from './AgentChatPage';

type Element = ReactElement<{ children?: ReactNode; 'aria-label'?: string; onClick?: () => void; onSubmit?: (e: { preventDefault: () => void }) => Promise<void> }>;
function elements(node: ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement(node)) return [];
  const element = node as Element;
  return [element, ...elements(element.props.children)];
}
function page(text = 'yes', running = false) {
  fixture.index = 0; fixture.refIndex = 0; fixture.effects = [];
  fixture.states = [[{ id: 'ceo', slug: 'ceo', type: 'ceo', name: 'CEO' }], [{ id: 'chat', agent_id: 'ceo' }], [], text, false, false, false, '', false, running, true];
  return AgentChatPage();
}
beforeEach(() => {
  vi.clearAllMocks(); fixture.role = 'owner'; fixture.org = 'org'; fixture.user = 'owner';
  prepare.mockResolvedValue({ready:false,status:'upgrade_required',reply:'No job was queued. Catalina is unsupported.'});
  fixture.refs = [{ current: vi.fn() }, { current: null }, { current: null }, { current: null }, { current: false }, { current: null }, { current: '' }];
});
afterEach(()=>vi.unstubAllGlobals());
it('exposes an accessible Stop control that aborts the running command', () => {
  const controller = new AbortController(); fixture.refs[2].current = controller;
  elements(page('yes', true)).find(e => e.props['aria-label'] === 'ceo.stop')!.props.onClick?.();
  expect(controller.signal.aborted).toBe(true);
});
it('clears pending approval and aborts the old command on company, user or role changes', () => {
  for (const change of ['org', 'user', 'role'] as const) {
    const controller = new AbortController(); fixture.refs[1].current = { kind: 'open_app' }; fixture.refs[2].current = controller;
    fixture[change] = 'changed'; page(); fixture.effects[0]();
    expect(controller.signal.aborted).toBe(true); expect(fixture.refs[1].current).toBeNull(); expect(fixture.refs[2].current).toBeNull();
  }
});
it('requests Stop when the page unmounts', () => {
  page(); const cleanup = fixture.effects[0]()!;
  const controller = new AbortController(); fixture.refs[2].current = controller;
  cleanup(); expect(controller.signal.aborted).toBe(true);
});
it('runs the same pending action for no, do it yourself without delegating', async () => {
  const proposal = { kind: 'open_app', params: { app: 'Microsoft Word' }, description: 'Open Word' };
  fixture.refs[1].current = proposal; dispatch.mockResolvedValue({ reply: 'confirmed' });
  await elements(page('no, do it yourself')).find(e => e.type === 'form')!.props.onSubmit?.({ preventDefault: vi.fn() });
  expect(dispatch).toHaveBeenCalledOnce(); expect(dispatch).toHaveBeenCalledWith('org', proposal, 'en', expect.any(AbortSignal));
  expect(fixture.refs[1].current).toBeNull();
});
it('never dispatches an explicit rejected app command', async () => {
  await elements(page('do not open Microsoft Word')).find(e => e.type === 'form')!.props.onSubmit?.({ preventDefault: vi.fn() });
  expect(dispatch).not.toHaveBeenCalled(); expect(fixture.refs[1].current).toBeNull();
});
it('routes the exact incomplete owner transcript to readiness rather than the model',async()=>{
  await elements(page('mporis na anixis to mac kai na valis tragoudia apo youtube ?')).find(e=>e.type==='form')!.props.onSubmit?.({preventDefault:vi.fn()});
  expect(prepare).toHaveBeenCalledWith('org',{kind:'desktop_task',description:'mporis na anixis to mac kai na valis tragoudia apo youtube ?',params:{goal:'mporis na anixis to mac kai na valis tragoudia apo youtube ?'}},'en',expect.any(AbortSignal));
  expect(dispatch).not.toHaveBeenCalled();expect(sendChat).not.toHaveBeenCalled();expect(fixture.refs[1].current).toBeNull();
  const update=fixture.setters[2].mock.calls.slice(-1)[0][0];
  expect(update([]).slice(-1)[0].content).toContain('No job was queued');
});
it('does not ask for approval for a parsed command when the connector is unready',async()=>{
  await elements(page('open Safari')).find(e=>e.type==='form')!.props.onSubmit?.({preventDefault:vi.fn()});
  expect(prepare).toHaveBeenCalledOnce();expect(dispatch).not.toHaveBeenCalled();expect(sendChat).not.toHaveBeenCalled();expect(fixture.refs[1].current).toBeNull();
});
it('binds one pending approval to the name and identity returned by readiness',async()=>{
  prepare.mockResolvedValue({ready:true,deviceName:'Chosen Mac',deviceId:'d7'});
  await elements(page('open Safari')).find(e=>e.type==='form')!.props.onSubmit?.({preventDefault:vi.fn()});
  expect(fixture.refs[1].current).toMatchObject({deviceId:'d7',params:{app:'Safari'}});
  const update=fixture.setters[2].mock.calls.slice(-1)[0][0];expect(update([]).slice(-1)[0].content).toContain('Chosen Mac');
  expect(dispatch).not.toHaveBeenCalled();expect(sendChat).not.toHaveBeenCalled();
});
it('applies the same role guard to incomplete control requests',async()=>{
  fixture.role='member';
  await elements(page('run the prepared AppleScript on Polis1984')).find(e=>e.type==='form')!.props.onSubmit?.({preventDefault:vi.fn()});
  expect(prepare).not.toHaveBeenCalled();expect(dispatch).not.toHaveBeenCalled();expect(sendChat).not.toHaveBeenCalled();
});
it('routes a voice transcript through the same readiness guard',async()=>{
  vi.stubGlobal('navigator',{mediaDevices:{getUserMedia:vi.fn()}});vi.stubGlobal('MediaRecorder',class{});
  listen.mockImplementation((_org,_lang,callbacks)=>{callbacks.final('Μπορείς να ανοίξεις το Mac και να βάλεις τραγούδια από YouTube;');return{cancel:vi.fn()}});
  const tree=elements(page());
  const button=tree.find(e=>e.props['aria-label']==='voice.mic');
  expect(button).toBeDefined();button!.props.onClick?.();
  await Promise.resolve();await Promise.resolve();
  expect(prepare).toHaveBeenCalledOnce();expect(sendChat).not.toHaveBeenCalled();expect(dispatch).not.toHaveBeenCalled();
});

it('native Full Control dispatches a simple app goal immediately on the ready device',async()=>{
 prepare.mockResolvedValue({ready:true,deviceName:'Debian',deviceId:'d7',nativeDesktop:true,ownerFullControl:true,requestId:'11111111-1111-4111-8111-111111111111'});dispatch.mockResolvedValue({reply:'Observed opened app'});
 await elements(page('open Microsoft Word')).find(e=>e.type==='form')!.props.onSubmit?.({preventDefault:vi.fn()});
 expect(dispatch).toHaveBeenCalledOnce();expect(dispatch.mock.calls[0][1]).toEqual({kind:'open_app',description:'Open Microsoft Word',params:{app:'Microsoft Word'},deviceId:'d7',requestId:'11111111-1111-4111-8111-111111111111',ownerFullControlRequired:true});expect(fixture.refs[1].current).toBeNull();expect(sendChat).not.toHaveBeenCalled();
});

it.each(['open browser','Open YouTube and play Μαζωνάκης Ώρες Μικρές'])('owner Full Control runs %s once without an approval prompt',async message=>{
 prepare.mockResolvedValue({ready:true,deviceName:'Debian',deviceId:'d7',ownerFullControl:true,requestId:'11111111-1111-4111-8111-111111111111'});dispatch.mockResolvedValue({reply:'Observed result'});
 await elements(page(message)).find(e=>e.type==='form')!.props.onSubmit?.({preventDefault:vi.fn()});
 expect(prepare).toHaveBeenCalledOnce();expect(dispatch).toHaveBeenCalledOnce();expect(dispatch.mock.calls[0][1]).toMatchObject({deviceId:'d7',requestId:'11111111-1111-4111-8111-111111111111',ownerFullControlRequired:true});expect(fixture.refs[1].current).toBeNull();expect(sendChat).not.toHaveBeenCalled();
 const update=fixture.setters[2].mock.calls.slice(-1)[0][0];expect(update([]).slice(-1)[0].content).toBe('Observed result');
});

it.each(['open browser','open Microsoft Word','Open YouTube and play Μαζωνάκης Ώρες Μικρές'])('guarded native readiness asks before %s and one approval executes the bound request',async message=>{
 prepare.mockResolvedValue({ready:true,deviceName:'Debian',deviceId:'d7',nativeDesktop:true,ownerFullControl:false,requestId:'11111111-1111-4111-8111-111111111111'});dispatch.mockResolvedValue({reply:'Observed result'});
 await elements(page(message)).find(e=>e.type==='form')!.props.onSubmit?.({preventDefault:vi.fn()});
 expect(dispatch).not.toHaveBeenCalled();expect(sendChat).not.toHaveBeenCalled();const pending=fixture.refs[1].current;
 const update=fixture.setters[2].mock.calls.slice(-1)[0][0];expect(update([]).slice(-1)[0].content).toContain('Do you approve?');
 await elements(page('approve')).find(e=>e.type==='form')!.props.onSubmit?.({preventDefault:vi.fn()});
 expect(prepare).toHaveBeenCalledOnce();expect(dispatch).toHaveBeenCalledExactlyOnceWith('org',pending,'en',expect.any(AbortSignal));expect(pending).not.toHaveProperty('ownerFullControlRequired');expect(fixture.refs[1].current).toBeNull();
});

it('keeps a missing central Full Control marker guarded even with native desktop capability',async()=>{
 prepare.mockResolvedValue({ready:true,deviceName:'Debian',deviceId:'d7',nativeDesktop:true});
 await elements(page('Open YouTube and play Μαζωνάκης Ώρες Μικρές')).find(e=>e.type==='form')!.props.onSubmit?.({preventDefault:vi.fn()});
 expect(dispatch).not.toHaveBeenCalled();const update=fixture.setters[2].mock.calls.slice(-1)[0][0];expect(update([]).slice(-1)[0].content).toContain('Do you approve?');
});

it.each([true,false])('fences a late central Full Control=%s preview after the page Stop control',async ownerFullControl=>{
 let release!:(value:unknown)=>void;prepare.mockImplementation(()=>new Promise(resolve=>{release=resolve}));
 const sending=elements(page('open browser')).find(e=>e.type==='form')!.props.onSubmit?.({preventDefault:vi.fn()});
 elements(page('open browser',true)).find(e=>e.props['aria-label']==='ceo.stop')!.props.onClick?.();
 release({ready:true,deviceName:'Debian',deviceId:'d7',nativeDesktop:true,ownerFullControl});await sending;
 expect(dispatch).not.toHaveBeenCalled();expect(fixture.refs[1].current).toBeNull();expect(sendChat).not.toHaveBeenCalled();
});

it('passes the explicit Mac target through chat readiness and pending approval',async()=>{
 prepare.mockResolvedValue({ready:true,deviceName:'Polis1984',deviceId:'mac'});
 await elements(page('from mac open chrome')).find(e=>e.type==='form')!.props.onSubmit?.({preventDefault:vi.fn()});
 expect(prepare).toHaveBeenCalledWith('org',{kind:'open_app',description:'Open Google Chrome',params:{app:'Google Chrome'},target:'mac'},'en',expect.any(AbortSignal));
 expect(fixture.refs[1].current).toMatchObject({target:'mac',deviceId:'mac',params:{app:'Google Chrome'}});expect(dispatch).not.toHaveBeenCalled();expect(sendChat).not.toHaveBeenCalled();
});


it('CEO chat keeps a named Debian target despite trailing Μην safety wording',async()=>{
 const goal='Εκτέλεσε αυτή την εργασία αποκλειστικά στον υπολογιστή My shell (Debian). Άνοιξε browser. Μην αλλάξεις σε Mac.';
 prepare.mockResolvedValue({ready:true,deviceName:'My shell',deviceId:'debian',ownerFullControl:true,requestId:'11111111-1111-4111-8111-111111111111'});
 dispatch.mockResolvedValue({reply:'Terminal receipt pending'});
 await elements(page(goal)).find(e=>e.type==='form')!.props.onSubmit?.({preventDefault:vi.fn()});
 expect(prepare).toHaveBeenCalledOnce();
 expect(dispatch).toHaveBeenCalledOnce();
 expect(dispatch.mock.calls[0][1]).toMatchObject({target:'my shell',deviceId:'debian'});
 expect(sendChat).not.toHaveBeenCalled();
});


it('owner Greeklish playback goes to dispatcher instead of CEO model handoff',async()=>{
 const phrase="re to shell einai unlock pexe to tragoudi tou mazonaki ores mikres sto youtube browser";
 prepare.mockResolvedValue({ready:true,deviceName:'My shell',deviceId:'debian',ownerFullControl:true,requestId:'11111111-1111-4111-8111-111111111111'});
 dispatch.mockResolvedValue({reply:'Worker terminal observation pending'});
 await elements(page(phrase)).find(e=>e.type==='form')!.props.onSubmit?.({preventDefault:vi.fn()});
 expect(prepare).toHaveBeenCalledExactlyOnceWith('org',expect.objectContaining({kind:'desktop_task',params:{goal:phrase}}),'en',expect.any(AbortSignal));
 expect(dispatch).toHaveBeenCalledExactlyOnceWith('org',expect.objectContaining({kind:'desktop_task',params:{goal:phrase},deviceId:'debian',ownerFullControlRequired:true}),'en',expect.any(AbortSignal));
 expect(sendChat).not.toHaveBeenCalled();
});
