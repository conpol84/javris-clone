/**
 * Pure, owner-scoped inventory of FIRBO app connections for the PERSONAL CEO.
 * A connected app row is metadata, never a provider API read, token grant,
 * permission to impersonate another member or proof of fresh provider data.
 * The existing Integrations service verifies OAuth and owns credentials.
 */
export interface ConnectedAppRow {
  kind?:unknown;status?:unknown;created_by?:unknown;
  name?:unknown;config?:unknown;last_used_at?:unknown;
}
export interface ConnectedWorkSource {kind:string;name:string}
export interface ConnectionContext {
  workSources:string;
  context:string;
  configuredKinds:string[];
  activeKinds:string[];
  unavailable:boolean;
}
const KIND=/^[a-z][a-z0-9_]{1,47}$/;
const safeKind=(raw:unknown)=>typeof raw==='string'&&KIND.test(raw)?raw:null;
const text=(value:unknown)=>String(value??'').replace(/[^a-z0-9 _.·-]/gi,' ').trim().slice(0,48);
export function connectedAppContext(
  raw:unknown,
  ownerId:string,
  isCompanyManager:boolean,
  readFailed:boolean,
  sources:readonly ConnectedWorkSource[],
):ConnectionContext {
  if(readFailed||!Array.isArray(raw)||!ownerId)
    return{workSources:'unavailable',context:'Connection metadata unavailable. Do not claim access or fetch provider contents.',configuredKinds:[],activeKinds:[],unavailable:true};
  const names=new Map(sources.map(s=>[s.kind,s.name]));
  const owned=new Set<string>(),company=new Set<string>(),attention=new Set<string>();
  const configured=new Set<string>(),active=new Set<string>();
  for(const candidate of raw.slice(0,100) as ConnectedAppRow[]) {
    if(!candidate||typeof candidate!=='object')continue;
    const kind=safeKind(candidate.kind);
    // Unknown DB-defined kinds are not approved provider capabilities. Never
    // surface their untrusted labels in prompts or mark them as connected.
    if(!kind||!names.has(kind)||!['active','error'].includes(String(candidate.status)))continue;
    const mine=candidate.created_by===ownerId;
    if(!mine&&!isCompanyManager)continue;
    configured.add(kind);
    if(candidate.status==='error') {attention.add(kind);continue;}
    active.add(kind);
    (mine?owned:company).add(kind);
  }
  const display=(kind:string)=>text(names.get(kind)??kind.replace(/_/g,' '));
  const formatted=(set:Set<string>)=>[...set].slice(0,15).map(display).join(', ')||'none';
  const workSources=[...active].filter(kind=>names.has(kind)).slice(0,12).map(display).join(', ')||'none';
  const parts=[
    'CONNECTED APP CATALOG (verified only as FIRBO database metadata; NOT external provider contents or fresh permission):',
    'Connections made by this user: '+formatted(owned)+'.',
    isCompanyManager?'Company connections created by other members (catalog only; do not disclose their account details): '+formatted(company)+'.':'Other members connections: not accessible.',
    'Connections requiring attention: '+formatted(attention)+'.',
    'To use real provider information, check the allowed integration snapshot route and its existing server scopes; never pretend provider data was fetched.',
  ];
  return{workSources,context:parts.join(' '),configuredKinds:[...configured],activeKinds:[...active],unavailable:false};
}
