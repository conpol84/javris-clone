import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDuckDuckGo, parseRss, parseWikipedia, freeWebSearch, isPublicHost, readPageDirect } from '../../supabase/functions/_shared/free-search.ts';

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
  assert.ok(seen.some(u => u.includes('bing.com/news') && u.includes('setlang=el&cc=GR')));
  assert.ok(seen.some(u => u.startsWith('https://el.wikipedia.org/')));
  await assert.rejects(freeWebSearch('x', 'en', async () => new Response('', { status: 500 })), /free_search_ddg:search_http_500\|gnews:search_http_500\|bnews/);
});
const BING = `<rss><channel><item><title>Η τεχνητή νοημοσύνη &#171;αλλάζει&#187; τις τράπεζες</title><link>http://www.bing.com/news/apiclick.aspx?ref=FexRss&amp;aid=&amp;tid=1&amp;url=https%3a%2f%2fwww.naftemporiki.gr%2fai%2f123&amp;c=9</link><pubDate>Sun, 04 Oct 2026 08:00:00 GMT</pubDate><description>Νέα μελέτη.</description></item></channel></rss>`;
const WIKI = JSON.stringify({ query: { search: [{ title: 'Τεχνητή νοημοσύνη', snippet: '<span class="searchmatch">Τεχνητή</span> νοημοσύνη είναι' }] } });
test('when DuckDuckGo and Google News refuse the server, Bing News and Wikipedia still answer', async () => {
  const out = await freeWebSearch('τεχνητή νοημοσύνη', 'el', async (url) => {
    const u = String(url);
    if (u.includes('duckduckgo')) return new Response('<html>challenge</html>', { status: 202 });
    if (u.includes('news.google')) return new Response('Sorry', { status: 503 });
    if (u.includes('bing.com/news')) return new Response(BING);
    return new Response(WIKI);
  });
  assert.match(out, /Recent news:\nN1\. Η τεχνητή νοημοσύνη «αλλάζει» τις τράπεζες \(Sun, 04 Oct 2026 08:00:00 GMT\) - https:\/\/www\.naftemporiki\.gr\/ai\/123/);
  assert.match(out, /Encyclopedia:\nW1\. Τεχνητή νοημοσύνη - https:\/\/el\.wikipedia\.org\/wiki\/Τεχνητή_νοημοσύνη\n/);
  assert.equal(parseWikipedia('not json', 'el').length, 0);
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
test('percent-encoded letters in links are shown as letters, other escapes stay', async () => {
  const { readableUrl } = await import('../../supabase/functions/_shared/free-search.ts');
  assert.equal(readableUrl('https://www.sbctv.gr/2026/10/%cf%84%ce%b5%cf%87%ce%bd%ce%b7%cf%84%ce%ae-ai/?q=a%20b&x=%2F'), 'https://www.sbctv.gr/2026/10/τεχνητή-ai/?q=a%20b&x=%2F');
});
test('a long query that finds nothing is retried with its key words', async () => {
  const { freeWebSearch, shortQuery } = await import('../../supabase/functions/_shared/free-search.ts');
  assert.equal(shortQuery('free CRM Greek small business 2026 price features'), 'free CRM Greek small');
  assert.equal(shortQuery('CRM Greece'), '');
  const BING = `<rss><channel><item><title>CRM news</title><link>https://a.gr/crm</link></item></channel></rss>`;
  const seen = [];
  const out = await freeWebSearch('free CRM Greek small business 2026 price features', 'el', async (url) => {
    const u = String(url); seen.push(u);
    return u.includes('bing.com/news') && u.includes('q=free%20CRM%20Greek%20small&') ? new Response(BING) : new Response('', { status: 500 });
  });
  assert.match(out, /CRM news - https:\/\/a\.gr\/crm/);
});
