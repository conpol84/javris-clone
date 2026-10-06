import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LANGUAGES } from '../../i18n/core';
import { MacBrowserUpdate } from './MacBrowserUpdate';

const device = { paired: true, revoked_at: null, platform: 'darwin x64', capabilities: { job_kinds: ['browser_open'] } };
describe('existing Mac browser update', () => {
  it('offers a download and local instructions in every product language', () => {
    for (const { code } of LANGUAGES) {
      const html = renderToStaticMarkup(<MacBrowserUpdate device={device} lang={code} />);
      expect(html).toContain('download="FIRBO-Mac-Browser-Update.command"');
      expect(html).toContain('Ctrl+C');
      expect(html).toContain('firboai.app');
      expect(html).not.toContain('<button');
    }
  });
  it('does not carry the notice across selection of an unpaired, revoked, ready or non-Mac device', () => {
    for (const change of [{ paired: false }, { revoked_at: '2026-10-06' }, { platform: 'Windows 11 x64' }, { platform: null }, { capabilities: { job_kinds: ['browser_task'] } }]) {
      expect(renderToStaticMarkup(<MacBrowserUpdate device={{ ...device, ...change }} lang="en" />)).toBe('');
    }
  });
});
