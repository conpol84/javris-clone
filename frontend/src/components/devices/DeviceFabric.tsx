import {lazy,Suspense,useEffect,useRef,useState} from 'react';
import {Link} from 'react-router';
import {ArrowUpRight,Car,Check,Home,Monitor,ShieldCheck,Smartphone} from 'lucide-react';
import {useI18n} from '../../i18n/I18nProvider';
import {listIntegrations,type IntegrationRow} from '../../lib/company/integrations';
import {isOnline,type DeviceRow} from '../../lib/company/computers';
import {readConnection,type ConnectionSnapshot} from '../../lib/company/connected-apps';
import {deviceMessages} from '../../lib/company/device-messages';
import '../../styles/connected-world.css';
const CoreOrb=lazy(()=>import('../scenes/CoreOrb'));
type InstallPrompt=Event&{prompt:()=>Promise<void>;userChoice:Promise<{outcome:string}>};
export function DeviceFabric({orgId,devices,canManage,deviceReady}:{orgId:string;devices:DeviceRow[];canManage:boolean;deviceReady:boolean}){
 const {lang,fmt}=useI18n(),l=deviceMessages(lang);
 const [selected,setSelected]=useState<'pc'|'phone'|'home'|'car'>('pc');
 const [sources,setSources]=useState<IntegrationRow[]>([]);const [phase,setPhase]=useState<'loading'|'ready'|'error'>('loading');
 const [tick,setTick]=useState(0);const [data,setData]=useState<ConnectionSnapshot|null>(null);const [busy,setBusy]=useState(false);const [error,setError]=useState('');
 const [install,setInstall]=useState<InstallPrompt|null>(null);const [installed,setInstalled]=useState(false);const [permission,setPermission]=useState<string|null>(null);const epoch=useRef(0);const alive=useRef(true);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;epoch.current++;};},[]);
 useEffect(()=>{let current=true;setSources([]);setPhase('loading');if(!canManage||!orgId){setPhase('ready');return;}
  listIntegrations(orgId).then(rows=>{if(current){setSources(rows.filter(r=>['homeassistant_devices','traccar'].includes(r.kind)));setPhase('ready');}}).catch(()=>{if(current)setPhase('error');});return()=>{current=false;};
 },[orgId,canManage,tick]);
 useEffect(()=>{const event=(e:Event)=>{e.preventDefault();setInstall(e as InstallPrompt);};const done=()=>{setInstalled(true);setInstall(null);};
  setInstalled(window.matchMedia('(display-mode: standalone)').matches||(navigator as Navigator&{standalone?:boolean}).standalone===true);
  window.addEventListener('beforeinstallprompt',event);window.addEventListener('appinstalled',done);return()=>{window.removeEventListener('beforeinstallprompt',event);window.removeEventListener('appinstalled',done);};
 },[]);
 const select=(v:typeof selected)=>{epoch.current++;setSelected(v);setData(null);setError('');setBusy(false);};
 const read=async(id:string)=>{const e=++epoch.current;setBusy(true);setData(null);setError('');try{const s=await readConnection(id);if(alive.current&&e===epoch.current)setData(s);}catch{if(alive.current&&e===epoch.current)setError(l.readError);}finally{if(alive.current&&e===epoch.current)setBusy(false);}};
 const checkPermission=async()=>{try{const p=await navigator.permissions.query({name:'microphone' as PermissionName});if(alive.current)setPermission(p.state);}catch{if(alive.current)setPermission('unknown');}};
 const doInstall=async()=>{if(!install)return;try{await install.prompt();await install.userChoice;}finally{if(alive.current)setInstall(null);}};
 const tiles=[{id:'pc' as const,Icon:Monitor,title:l.pc,sub:l.online,count:devices.filter(d=>d.paired&&isOnline(d)).length},{id:'phone' as const,Icon:Smartphone,title:l.phone,sub:l.thisBrowser,count:null},{id:'home' as const,Icon:Home,title:l.home,sub:l.sources,count:sources.filter(r=>r.kind==='homeassistant_devices').length},{id:'car' as const,Icon:Car,title:l.car,sub:l.sources,count:sources.filter(r=>r.kind==='traccar').length}];
 const currentSources=sources.filter(s=>s.kind===(selected==='home'?'homeassistant_devices':'traccar'));
 return <section className="cw-fabric" data-testid="device-fabric">
  <header className="cw-heading"><div><span className="cw-kicker">{l.eyebrow}</span><h2>{l.title}</h2><p>{l.intro}</p></div><Link className="fb-btn fb-btn--ghost" to="/integrations">{l.openApps}<ArrowUpRight size={16}/></Link></header>
  <div className="cw-network">
   <div className="cw-orbit" aria-hidden="true"><div className="cw-orbit-grid"/><Suspense fallback={<div className="cw-core-fallback">FIRBO</div>}><CoreOrb satellites={[]} className="cw-hologram"/></Suspense><div className="cw-core-caption"><span>FIRBO</span><small>{l.scope}</small></div></div>
   <div className="cw-devices" role="group" aria-label={l.title}>{tiles.map(({id,Icon,title,sub,count})=><button key={id} className={'cw-device '+(selected===id?'is-selected':'')} aria-pressed={selected===id} onClick={()=>select(id)} data-device-kind={id}><div className="cw-device-icon"><Icon size={24}/></div><strong>{title}</strong><span>{sub}{count!==null?` · ${(id==='pc'?!deviceReady:phase!=='ready')?'—':count}`:''}</span><ArrowUpRight size={16} className="cw-device-arrow"/></button>)}</div>
  </div>
  <div className="cw-detail" data-testid="device-detail"><div className="cw-detail-title"><span className="cw-kicker">{l.selected}</span><h3>{l[selected]}</h3><p>{l[`${selected}Body`]}</p></div>
   <div className="cw-detail-actions">
    {selected==='pc'&&<a href="#computer-enrollment" className="fb-btn fb-btn--primary">{l.openManager}<ArrowUpRight size={15}/></a>}
    {selected==='phone'&&<><p><Smartphone size={14}/>{installed?l.installed:l.notPaired}</p>{install&&<button className="fb-btn fb-btn--primary" onClick={()=>void doInstall()}>{l.install}</button>}{!installed&&!install&&<p className="fb-dim text-sm">{l.installHelp}</p>}<button className="fb-btn fb-btn--ghost" onClick={()=>void checkPermission()}>{l.permission}</button>{permission&&<p role="status">{permission==='granted'?l.allowed:permission==='denied'?l.denied:permission==='prompt'?l.prompt:l.unknown}</p>}<small>{l.permissionNote}</small></>}
    {(selected==='home'||selected==='car')&&<><span className="cw-state"><ShieldCheck size={14}/>{l.readOnly}</span>{phase==='error'?<div role="alert">{l.error}<button className="fb-btn" onClick={()=>setTick(x=>x+1)}>{l.retry}</button></div>:phase==='loading'?<p>{l.loading}</p>:currentSources.length===0?<p>{l.noSource}</p>:currentSources.map(s=><div key={s.id} className="cw-source"><strong>{s.name}</strong><small>{l.sourceState}</small><button className="fb-btn" disabled={busy} onClick={()=>void read(s.id)}>{busy?l.loading:l.read}</button></div>)}<Link className="fb-btn fb-btn--primary" to={'/integrations?connect='+(selected==='home'?'homeassistant_devices':'traccar')}>{selected==='home'?l.openHome:l.openCar}<ArrowUpRight size={15}/></Link></>}
   </div>
   {error&&<p role="alert" className="cw-response">{error}</p>}
   {data&&<div className="cw-response"><strong><Check size={15}/>{l.snapshot} · {data.account}</strong><ul>{data.rows.map(r=><li key={r.id}><span>{r.label}</span><b>{r.state??r.detail??l.none} {r.unit??''}</b><small>{l.time}: {r.observed_at&&Number.isFinite(Date.parse(r.observed_at))?fmt.dateTime(r.observed_at):l.none}</small></li>)}</ul></div>}
  </div>
  <footer className="cw-foot"><ShieldCheck size={16}/><span>{l.safe}</span></footer>
 </section>;
}
export function ConnectedWorldEntry(){const {lang}=useI18n();const l=deviceMessages(lang);return <Link className="cw-entry" to="/computers"><div className="cw-entry-icons"><Monitor/><Smartphone/><Home/><Car/></div><div><span className="cw-kicker">{l.eyebrow}</span><strong>{l.title}</strong></div><ArrowUpRight aria-hidden/></Link>;}
