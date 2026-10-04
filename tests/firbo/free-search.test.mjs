import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDuckDuckGo, parseRss, freeWebSearch, isPublicHost, readPageDirect } from '../../supabase/functions/_shared/free-search.ts';

const DDG = `<div><h2><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.sgieurope.com%2Fhome%2Ftopics&amp;rut=abc">Latest News &amp; Analysis | Sports Retail</a></h2>
<a class="result__snippet" href="x">Sports <b>retail</b> news, every day.</a></div>
<div><a class="result__a" href="https://duckduckgo.com/y.js?ad=1">Ad</a></div>
<div><a class="result__a" href="https://example.org/b">Second</a></div>`;
const RSS = `<rss><channel><title>t</title><item><title>Zakcret Sports enters Cyprus - η ναυτεμπορικη</title><link>https://news.google.com/rss/articles/CBM?oc=5</link><pubDate>Sat, 03 Oct 2026 06:04:00 GMT</pubDate><description>&lt;a&gt;x&lt;/a&gt;</description></item></channel></rss>`;

test('DuckDuckGo results are unwrapped, decoded and ads skipped', () => {
  const hits = parseDuckDuckGo(DDG);
  assert.deepEqual(hits.map(h => h.url), ['https://www.sgieurope.com/home/topics', 'https://example.org/b']);
  assert.equal(hits[0].title, 'Latest News & Analysis | Sports Retail');
  assert.equal(hits[0].snippet, 'Sports retail news, every day.');
});
test('RSS items keep title, link and date', () => {
  const [n] = parseRss(RSS);
  assert.equal(n.title, 'Zakcret Sports enters Cyprus - η ναυτεμπορικη');
  assert.equal(n.url, 'https://news.google.com/rss/articles/CBM?oc=5');
  assert.equal(n.date, 'Sat, 03 Oct 2026 06:04:00 GMT');
});
test('web and Greek news are combined; a failing source does not break the other', async () => {
  const seen = [];
  const out = await freeWebSearch('αθλητικά νέα', 'el', async (url) => { seen.push(String(url)); return String(url).includes('duckduckgo') ? new Response(DDG) : new Response('down', { status: 500 }); });
  assert.match(out, /sgieurope/); assert.doesNotMatch(out, /Recent news/);
  assert.ok(seen.some(u => u.includes('hl=el&gl=GR')));
  await assert.rejects(freeWebSearch('x', 'en', async () => new Response('', { status: 500 })), /free_search_ddg:search_http_500\|news:search_http_500/);
});
test('only public hosts can be read', () => {
  for (const h of ['localhost', '127.0.0.1', '10.0.0.5', '192.168.1.1', '172.20.0.1', '169.254.169.254', '100.64.0.1', 'metadata', 'db.internal', '[::1]']) assert.equal(isPublicHost(h), false, h);
  for (const h of ['www.sgieurope.com', 'news.google.com', '8.8.8.8']) assert.equal(isPublicHost(h), true, h);
});
test('a redirect to a private address is refused; page text is cleaned', async () => {
  await assert.rejects(readPageDirect('https://a.example/x', async () => new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest' } })), /page_not_allowed/);
  await assert.rejects(readPageDirect('file:///etc/passwd'), /page_not_allowed/);
  const html = '<html><head><title>Sales up</title><script>evil()</script></head><body><nav>menu</nav><article><h1>Q3</h1><p>Sales rose 5%.</p></article></body></html>';
  const out = await readPageDirect('https://a.example/x', async () => new Response(html, { headers: { 'content-type': 'text/html' } }));
  assert.match(out, /^Sales up\n/); assert.match(out, /Sales rose 5%/); assert.doesNotMatch(out, /evil|menu/);
  await assert.rejects(readPageDirect('https://a.example/f.pdf', async () => new Response('x', { headers: { 'content-type': 'application/pdf' } })), /page_not_text/);
});
