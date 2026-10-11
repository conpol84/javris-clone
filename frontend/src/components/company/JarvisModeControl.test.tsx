import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,expect,it,vi} from 'vitest';
import {JarvisModeControl} from './JarvisModeControl';

describe('FIRBO AI is the single user-facing assistant brand',()=>{
 const langs=['en','el','es','pt-BR','de','fr','zh-CN','ar'];
 it.each(langs)('uses FIRBO AI for %s, not a second Jarvis product',lang=>{
  const html=renderToStaticMarkup(createElement(JarvisModeControl,{
   enabled:true,lang,onToggle:vi.fn(),
  }));
  expect(html).toContain('FIRBO AI');
  expect(html).toContain('aria-checked="true"');
  expect(html).toContain('role="switch"');
  expect(html).not.toContain('Jarvis Autopilot');
 });
 it('never conceals an unverified server-side revocation',()=>{
  const html=renderToStaticMarkup(createElement(JarvisModeControl,{
   enabled:true,lang:'el',onToggle:vi.fn(),disabled:true,unavailable:true,onRetry:vi.fn(),
  }));
  expect(html).toContain('role="alert"');
  expect(html).toContain('aria-checked="true"');
  expect(html).toContain('FIRBO AI');
 });
});
