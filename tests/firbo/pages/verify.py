"""M2 actual App/route/Layout checks. Synthetic identity/data; no remote calls.

Only explicit, bounded horizontal table/code wrappers may scroll sideways.
Service workers and remote requests are blocked. No execution forms are submitted.
"""
import json, os
from pathlib import Path
from urllib.parse import urlparse, urlencode
from playwright.sync_api import sync_playwright, expect

BASE='http://127.0.0.1:5211'
OUT=Path(os.environ.get('FIRBO_M2_OUTPUT','/tmp/firbo-m2-evidence'));OUT.mkdir(parents=True,exist_ok=True)
NAME='DemonstrationOrganisationWithAVeryLongUnbrokenNameForReflowTesting'
MODEL='demo-provider/'+'model-with-long-context-'*5
DATE='2026-10-01T09:00:00Z'
OVERVIEW={'connected':True,'host':'http://gateway.invalid','has_key':True,'models':{'total':459,'providers':[{'provider':'demo','models':459}],'combo_ids':['firbo-economy','firbo-quality']},'connections':[{'provider':'demo','connections':1,'active':1,'healthy':1,'limited':0}], 'combos':[{'name':'firbo-economy','strategy':'priority','steps':7},{'name':'firbo-quality','strategy':'priority','steps':4}], 'stats':[{'provider':'demo','requests':1234567,'success_rate':1,'avg_latency_ms':1243,'tokens_in':9876543,'tokens_out':9876543}], 'errors':{}}
CONTROL={'contract':'firbo-control/v1','reachable':True,'available':True,'writes_enabled':False,'providers':[{'id':'p1','provider':'demo','name':NAME,'active':True,'status':'active'}],'models':[{'id':MODEL,'provider':'demo'}],'combos':[{'name':'firbo-economy','strategy':'priority','models':[MODEL],'revision':'a'*64,'managed':True,'editable':True}],'errors':{}}
PAYLOADS={
 '/v1/gateway/overview':OVERVIEW,
 '/v1/gateway/health':{'providers':[{'provider':NAME,'status':'healthy','requests':1234567,'success_rate':100,'avg_latency_ms':1456,'last_error_at':None}]},
 '/v1/gateway/routing':{'combos':[{'name':'firbo-economy','strategy':'priority','models':[MODEL],'enabled':True}]},
 '/v1/gateway/savings':{'compression':{'enabled':False,'mode':'balanced'},'modes':['balanced','quality'],'cache':{}},
 '/v1/gateway/usage':{'range':'7d','requests':123456789,'tokens_in':123456789,'tokens_out':123456789,'success_rate':1,'avg_latency_ms':1243,'cost':1234567890.12,'fallbacks':2,'models':[],'providers':[],'daily':[]},
 '/v1/gateway/quota':{'providers':[{'provider':'demo','name':NAME,'plan':'PublicDemonstrationPlan','fetched_at':DATE,'windows':[{'name':'Daily','remaining_pct':90,'used':10,'total':100,'reset_at':DATE,'unlimited':False}]}]},
 '/v1/gateway/keys':{'keys':[{'id':'key-label-only','name':NAME,'active':True,'created_at':DATE,'max_per_day':1000,'max_per_minute':10,'expires_at':None}]},
 '/v1/gateway/calls':{'calls':[{'id':'r1','at':DATE,'provider':'demo','model':MODEL,'status':200,'duration_ms':1456,'tokens_in':100,'tokens_out':10,'combo':'firbo-economy','failed':False,'active':False}]},
 '/v1/gateway/free-models':{'models':[{'provider':'demo','model':MODEL,'name':'Synthetic free catalogue entry','monthly_tokens':100000,'free_type':'test-only'}]},
 '/v1/firbo/control':CONTROL,
}
GEOMETRY=r'''() => {
 const main=document.querySelector('main'),bad=[];
 for(const n of main.querySelectorAll('*')) {
   if(n instanceof SVGElement || ['PATH','SCRIPT','STYLE','OPTION'].includes(n.tagName))continue;
   const s=getComputedStyle(n),r=n.getBoundingClientRect();
   if(!r.width||!r.height||s.display==='none'||s.visibility==='hidden'||n.classList.contains('sr-only'))continue;
   if(n.closest('[aria-hidden="true"]'))continue;
   let boundedScroll=false;
   for(let p=n.parentElement;p&&p!==main;p=p.parentElement){
     const ps=getComputedStyle(p),pr=p.getBoundingClientRect();
     if(p.matches('.overflow-x-auto, [data-horizontal-scroll]') && ['auto','scroll'].includes(ps.overflowX)&&p.scrollWidth>p.clientWidth+1 && pr.left>=-1 && pr.right<=innerWidth+1){boundedScroll=true;break;}
   }
   if(boundedScroll)continue;
   const field=['INPUT','TEXTAREA','SELECT'].includes(n.tagName);
   if(r.left < -1 || r.right > innerWidth+1 || (!field && n.childElementCount===0 && n.scrollWidth>n.clientWidth+2 && !['auto','scroll'].includes(s.overflowX)))bad.push({tag:n.tagName,class:n.className,text:(n.textContent||'').slice(0,75),x:r.x,w:r.width,client:n.clientWidth,scroll:n.scrollWidth});
 }
 return {width:innerWidth,documentWidth:document.documentElement.scrollWidth,bad:bad.slice(0,18)};
}'''
PROFILES=[(320,800,'en','dark'),(390,844,'en','dark'),(768,900,'en','dark'),(1440,900,'en','light'),(320,800,'el','dark'),(390,844,'ar','dark')]
ROUTES=['/settings','/companies','/gateway','/admin','/chat?c=c0','/']
results=[]

def run():
 with sync_playwright() as pw:
  browser=pw.chromium.launch(**({'executable_path':os.environ['FIRBO_CHROMIUM']} if os.environ.get('FIRBO_CHROMIUM') else {}))
  for width,height,lang,theme in PROFILES:
   for route in ROUTES:
    label=f'{width}x{height}-{lang}-{route.split("?")[0].strip("/") or "home"}'
    context=browser.new_context(viewport={'width':width,'height':height},reduced_motion='reduce',color_scheme=theme,has_touch=width<768,service_workers='block')
    external=[]; writes=[]; paths=[];states=[]
    def network(req):
     u=urlparse(req.request.url);path=u.path
     if u.netloc!='127.0.0.1:5211':external.append(u.hostname);return req.abort()
     if path.startswith('/v1/'):
      paths.append(path)
      if req.request.method!='GET':writes.append(path);return req.fulfill(status=403,json={'detail':'mutations_disabled_in_test'})
      if path=='/v1/firbo/session':return req.fulfill(json={'contract':'firbo-control/v1','platform_admin':True,'companies':[{'id':'org-1','name':NAME,'role':'owner'}],'has_more':False})
      if path in PAYLOADS:return req.fulfill(json={'available':True,'error':None,**PAYLOADS[path]})
      return req.fulfill(status=404,json={'detail':'unhandled_test_api'})
     req.continue_()
    context.route('**/*',network)
    context.add_init_script("localStorage.setItem('openjarvis-settings', JSON.stringify({theme:"+json.dumps(theme)+"}));")
    page=context.new_page();page.set_default_timeout(6000);errors=[]
    page.on('pageerror',lambda error:errors.append(str(error)))
    try:
     query=('&' if '?' in route else '?')+urlencode({'lang':lang})
     page.goto(BASE+route+query,wait_until='networkidle')
     expect(page.locator('main')).to_be_visible()
     expect(page.locator('main h1').first).to_be_visible()
     expect(page.locator('html')).to_have_attribute('lang',lang)
     assert page.evaluate('window.__firboM2?.synthetic') is True,'mock boundary not active'
     def check(state='page'):
      m=page.evaluate(GEOMETRY)
      assert m['documentWidth']<=width+1 and not m['bad'],{'state':state,**m}
      states.append(state)
     check()
     if width<768:
      nav=page.locator('.fb-bottomnav');expect(nav).to_be_visible()
      assert nav.locator('a,button').count()==5,'navigation items lost'
      for span in nav.locator('span').all():assert span.evaluate('(n)=>n.scrollWidth<=n.clientWidth+1'),'bottom-navigation label clipped'
      assert page.locator('.fb-main-pad').evaluate('(n)=>parseFloat(getComputedStyle(n).paddingBottom)')>=nav.bounding_box()['height']-1,'navigation overlaps content'
     if route=='/gateway':
      tabs=page.locator('main [role="tablist"]').first.get_by_role('tab')
      expect(tabs).to_have_count(10)
      for i in range(1,10):
       tabs.nth(i).click();page.wait_for_load_state('networkidle');check(f'gateway-tab-{i}')
      tabs.first.click()
     if route=='/admin':
      tabs=page.locator('main [role="tablist"]').first.get_by_role('tab')
      for i in (1,2):
       tabs.nth(i).click();page.wait_for_load_state('networkidle');check(f'admin-tab-{i}')
      tabs.nth(3).click();expect(page.locator('main textarea')).to_be_visible();check('native-console')
      expect(page.locator('main textarea')).to_have_attribute('readonly','')
     if route.startswith('/chat'):
      composer=page.locator('main form textarea');expect(composer).to_be_visible();composer.fill('Synthetic draft only — not sent')
      rect=composer.bounding_box();assert rect and rect['width']>=120,{'composer_width':rect}
      nav=page.locator('.fb-bottomnav');bottom=nav.bounding_box() if nav.is_visible() else None
      assert rect['y']>=0 and rect['y']+rect['height']<=(bottom['y'] if bottom else height)+1,{'composer_not_accessible':rect,'nav':bottom}
     assert not errors,errors
     assert not writes,writes
     synthetic=page.evaluate('window.__firboM2.writes');assert all(x=='profiles.update' for x in synthetic),synthetic
     if width in (320,1440) and lang=='en':page.screenshot(path=str(OUT/(label+'.png')))
     results.append({'case':label,'status':'passed','states':states,'api_paths':sorted(set(paths)),'external_requests_blocked':len(external)})
    except Exception as exc:
     page.screenshot(path=str(OUT/(label+'-FAILED.png')))
     results.append({'case':label,'status':'failed','states':states,'error':str(exc)[:6000],'page_errors':errors[:8],'api_paths':sorted(set(paths))})
    finally:
     context.close();print('FIRBO_M2_CASE',json.dumps(results[-1]),flush=True)
     (OUT/'results.json').write_text(json.dumps({'scope':'M2 actual App and six priority pages, synthetic services','cases':results,'not_tested':['physical mobile keyboard','real-account authorization','other routes','real model calls','production deployment']},indent=2))
  browser.close()
 failed=sum(r['status']!='passed' for r in results)
 print('FIRBO_M2_SUMMARY',len(results),failed,flush=True)
 if failed:raise SystemExit(1)
if __name__=='__main__':run()
