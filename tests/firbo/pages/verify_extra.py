"""Extend M2 with remaining languages, status layouts, member views and asset failure.

All data/auth are synthetic. Role views here are not live authorization tests.
The shortened viewport is not proof of physical on-screen keyboard behavior.
"""
import json
from urllib.parse import urlparse, urlencode
from playwright.sync_api import sync_playwright, expect
import verify as v

ROOT=v.OUT
v.OUT=ROOT/'additional-profiles';v.OUT.mkdir(exist_ok=True)
v.PROFILES=[(320,800,lang,'dark') for lang in ('es','fr','de','pt-BR','zh-CN')]
v.PROFILES += [(width,800,'en','dark') for width in (360,412)]
v.results=[]
profile_failed=False
try:v.run()
except SystemExit:profile_failed=True

CASES=[{'route':route,'state':state} for state in ('empty','error','loading') for route in ('/companies','/gateway','/admin','/chat?c=c0','/')]
CASES += [{'route':route,'role':'member'} for route in ('/gateway','/admin')]
CASES += [{'route':'/','asset_error':True},{'route':'/chat?c=c0','height':400,'width':390}]
reports=[]

def empty(value):
 if isinstance(value,list):return []
 if isinstance(value,dict):return {key:empty(item) for key,item in value.items()}
 if type(value) in (int,float):return 0
 return value

with sync_playwright() as pw:
 browser=pw.chromium.launch(**({'executable_path':v.os.environ['FIRBO_CHROMIUM']} if v.os.environ.get('FIRBO_CHROMIUM') else {}))
 for spec in CASES:
  route=spec['route']; state=spec.get('state','loaded'); role=spec.get('role','owner');width=spec.get('width',320);height=spec.get('height',800)
  name=f'{route.split("?")[0].strip("/") or "home"}-{state}-{role}-{width}x{height}'+('-asset-failure' if spec.get('asset_error') else '')
  ctx=browser.new_context(viewport={'width':width,'height':height},reduced_motion='reduce',color_scheme='dark',has_touch=True,service_workers='block')
  paths=[];blocked=[];writes=[];pending=[];errors=[]
  def intercept(request):
   u=urlparse(request.request.url);path=u.path
   if u.netloc!='127.0.0.1:5211':blocked.append(u.hostname);return request.abort()
   if spec.get('asset_error') and path=='/models/firbo-head.glb':
    paths.append(path);return request.fulfill(status=404,body='Deliberately unavailable visual asset',content_type='text/plain')
   if path.startswith('/v1/'):
    paths.append(path)
    if request.request.method!='GET':writes.append(path);return request.fulfill(status=403,json={'detail':'no_test_mutations'})
    if path=='/v1/firbo/session':return request.fulfill(json={'contract':'firbo-control/v1','platform_admin':role=='owner','companies':[{'id':'org-1','name':v.NAME,'role':role}],'has_more':False})
    if state=='loading':pending.append(request);return
    if state=='error':return request.fulfill(status=503,json={'detail':'synthetic_unavailable'})
    if path in v.PAYLOADS:
     data=empty(v.PAYLOADS[path]) if state=='empty' else v.PAYLOADS[path]
     return request.fulfill(json={'available':True,'error':None,**data})
    return request.fulfill(status=404,json={'detail':'unhandled_fixture_path'})
   request.continue_()
  ctx.route('**/*',intercept)
  page=ctx.new_page();page.set_default_timeout(7000);page.on('pageerror',lambda error:errors.append(str(error)))
  try:
   query=('&' if '?' in route else '?')+urlencode({'lang':'en','state':state,'role':role})
   page.goto(v.BASE+route+query,wait_until='domcontentloaded' if state=='loading' else 'networkidle')
   expect(page.locator('main')).to_be_visible();expect(page.locator('main h1,main h2').first).to_be_visible()
   if state=='loading':page.wait_for_timeout(600)
   if role=='member':
    expect(page.get_by_text('This area is only for Firbo AI administrators.' if route=='/admin' else 'Company AI engine',exact=True)).to_be_visible()
    assert page.locator('main textarea').count()==0
    assert '/v1/firbo/control' not in paths,'member mounted global engine controls'
   if state=='error':
    message={'/companies':'Could not load this company', '/gateway':'Backend not reachable','/admin':'Could not load the admin data.','/chat?c=c0':'Could not load your conversations.','/':'Synthetic read failure'}[route]
    expect(page.get_by_text(message,exact=False).first).to_be_visible()
   if state=='empty' and route=='/chat?c=c0':expect(page.get_by_text('No conversations yet.',exact=True)).to_be_visible()
   if state=='loading' and route in ('/companies','/admin'):expect(page.get_by_text('Loading…',exact=True).first).to_be_visible()
   measure=page.evaluate(v.GEOMETRY)
   assert measure['documentWidth']<=width+1 and not measure['bad'],measure
   nav=page.locator('.fb-bottomnav');expect(nav).to_be_visible()
   assert page.locator('.fb-main-pad').evaluate('(n)=>parseFloat(getComputedStyle(n).paddingBottom)')>=nav.bounding_box()['height']-1
   if spec.get('height'):
    field=page.locator('main form textarea');expect(field).to_be_visible();field.fill('Draft in reduced viewport; never sent')
    r=field.bounding_box();assert r and r['width']>=120 and r['y']>=0 and r['y']+r['height']<=nav.bounding_box()['y']+1,r
   if spec.get('asset_error'):
    assert '/models/firbo-head.glb' in paths,'fault was not injected'
    expect(page.locator('.fb-ring-fallback')).to_be_visible()
    page.locator('main .fb-a-overview button').first.click()
    expect(page.locator('main[data-firbo-route="/settings"]')).to_be_visible()
   assert not errors,errors
   assert not writes,writes
   assert all(w=='profiles.update' for w in page.evaluate('window.__firboM2.writes'))
   page.screenshot(path=str(ROOT/(name+'.png')))
   reports.append({'case':name,'status':'passed','state':state,'role':role,'api_paths':sorted(set(paths)),'external_requests_blocked':len(blocked)})
  except Exception as error:
   page.screenshot(path=str(ROOT/(name+'-FAILED.png')))
   reports.append({'case':name,'status':'failed','error':str(error)[:5000],'page_errors':errors})
  finally:
   ctx.close();print('FIRBO_M2_STATUS_CASE',json.dumps(reports[-1]),flush=True)
   (ROOT/'status-cases.json').write_text(json.dumps({'scope':'M2 synthetic state reflow, UI-only role views and visual-asset fault','cases':reports},indent=2))
 browser.close()
failed=sum(row['status']!='passed' for row in reports)
print('FIRBO_M2_STATUS_SUMMARY',len(reports),failed)
if failed or profile_failed:raise SystemExit(1)
