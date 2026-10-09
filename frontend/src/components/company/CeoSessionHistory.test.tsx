import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { CeoSessionHistory } from './CeoSessionHistory';

const rows=[
 {id:'one',title:'Playback follow-up',preview:'My shell: screen locked; playback not verified',updated_at:'2026-10-09T16:33:00Z'},
 {id:'two',title:'Research planning',preview:'Research report complete with next actions',updated_at:'2026-10-08T09:30:00Z'}
];
function html(lang='en',canCreate=true){
 return renderToStaticMarkup(createElement(CeoSessionHistory,{
  lang,sessions:rows,activeId:'one',loading:false,error:false,disabled:false,canCreate,
  onSelect:vi.fn(),onNew:vi.fn(),onRetry:vi.fn()
 }));
}
describe('personal CEO preview UI',()=>{
 it('renders actual per-session title, latest transcript preview and current session distinction',()=>{
  const markup=html();
  for(const value of ['Previous CEO conversations','Playback follow-up','screen locked','Research planning','Research report complete','Current']){
   expect(markup).toContain(value);
  }
  expect(markup).toContain('data-ceo-session-history="true"');
  expect(markup).toContain('aria-current="true"');
 });
 it('has localized owner and multilingual labels without changing saved content',()=>{
  expect(html('el')).toContain('Προηγούμενες συνομιλίες CEO');
  expect(html('es')).toContain('Conversaciones anteriores');
  expect(html('pt')).toContain('Conversas anteriores');
  expect(html('fr')).toContain('Conversations précédentes');
  expect(html('de')).toContain('Frühere CEO-Gespräche');
  expect(html('ar')).toContain('محادثات الرئيس التنفيذي');
  expect(html('zh-CN')).toContain('以往 CEO 对话');
 });
 it('read-only user still sees and can choose own history while new conversation is unavailable',()=>{
  const markup=html('en',false);
  expect(markup).toContain('Playback follow-up');
  expect(markup).toMatch(/disabled=""[^>]*aria-label="New conversation"/);
  expect(markup).toContain('role="listitem"');
 });
});
