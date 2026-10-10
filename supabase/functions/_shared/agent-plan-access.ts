/** Runtime entitlement check mirroring existing FIRBO premium template/DB rules.
 * Billing is purchased at ORGANIZATION level in the current FIRBO schema.
 * This is a second server-side execution gate, not a replacement for the DB
 * hire_agent premium-slug and plan_limit('agents') enforcement.
 *
 * Keep slugs byte-for-byte aligned with frontend templates PREMIUM_SLUGS.
 */
export const PREMIUM_AGENT_SLUGS = [
 'devops-engineer','security-auditor','code-reviewer','qa-engineer','product-manager',
 'ads-manager','influencer-outreach','pr-comms','brand-strategist','procurement',
 'inventory-planner','legal-reviewer','compliance-helper','tax-assistant',
 'financial-planner','invoice-collector','market-researcher','trend-scout',
 'ux-researcher','competitor-analyst','deep-research','site-watchdog',
 'knowledge-librarian','ai-cost-optimizer','ai-gateway-operator',
 'autonomous-coder','seo-specialist','email-marketer','hr-onboarding',
 'recruiter','community-manager',
] as const;
const premium = new Set<string>(PREMIUM_AGENT_SLUGS);
export type AgentPlanReason = 'plan_unavailable'|'organization_inactive'|'agent_disabled'|'premium_agent';
export interface AgentPlan {
 plan?: string|null;
 plan_status?: string|null;
 status?: string|null;
}
export interface AgentForPlan { slug?: string|null; enabled?: boolean|null }
const paid=new Set(['pro','business','enterprise']);
export function premiumAgentSlug(slug:unknown):boolean{
 if(typeof slug!=='string'||!slug.trim())return false;
 return premium.has(slug.replace(/-\d+$/, ''));
}
export function agentPlanDecision(org:AgentPlan|null|undefined,agent:AgentForPlan):{
 allowed:boolean;reason:AgentPlanReason|null;
}{
 if(!org||!['free',...paid].includes(String(org.plan??'')))return{allowed:false,reason:'plan_unavailable'};
 if(org.status!=null&&org.status!=='active')return{allowed:false,reason:'organization_inactive'};
 if(agent.enabled===false)return{allowed:false,reason:'agent_disabled'};
 if(premiumAgentSlug(agent.slug)&&(
   !paid.has(String(org.plan)) ||
   (org.plan_status!=null&&!['active','trialing'].includes(org.plan_status))
 ))return{allowed:false,reason:'premium_agent'};
 return{allowed:true,reason:null};
}
