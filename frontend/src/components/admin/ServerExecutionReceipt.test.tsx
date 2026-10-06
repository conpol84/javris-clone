import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
vi.mock('../../i18n/I18nProvider', () => ({ useI18n: () => ({ t: (k: string) => k }) }));
import { ServerExecutionReceipt } from './ServerExecutionReceipt';
const value={contract:'openjarvis-execution/v1',mode:'agent',tool_count:1,failed_count:1,tools:[{name:'file_write',success:false,output:'<script>alert(1)</script> Permission denied',truncated:false}],truncated:false};
describe('server execution display',()=>{
 it('shows tool failures and escapes output as text',()=>{
  const html=renderToStaticMarkup(<ServerExecutionReceipt value={value}/>);
  expect(html).toContain('file_write');expect(html).toContain('jv.executionFailed');
  expect(html).toContain('Permission denied');expect(html).not.toContain('<script>');
  expect(html).toContain('<details');expect(html).toContain('jv.executionCaveat');
 });
 it('does not call absent or malformed evidence a success',()=>{
  for(const input of [null,{},'Done',{...value,failed_count:0}]) expect(renderToStaticMarkup(<ServerExecutionReceipt value={input}/>)).toContain('jv.executionUnknown');
 });
 it('zero tools is explicit and truncation is visible',()=>{
  expect(renderToStaticMarkup(<ServerExecutionReceipt value={{...value,tool_count:0,failed_count:0,tools:[]}}/>)).toContain('jv.executionEmpty');
  expect(renderToStaticMarkup(<ServerExecutionReceipt value={{...value,truncated:true}}/>)).toContain('jv.executionTruncated');
 });
});
