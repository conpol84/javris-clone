import { useEffect, useState } from 'react';
import { ExternalLink, Maximize2, Minimize2 } from 'lucide-react';
import { useI18n } from '../../i18n/I18nProvider';
import '../../styles/firbo.css';

/** Pop the current page out into its own window (drag it to another screen) and toggle full screen. */
export function WindowControls() {
  const { t } = useI18n();
  const [full, setFull] = useState(() => !!document.fullscreenElement);
  useEffect(() => {
    const sync = () => setFull(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);
  const toggle = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void document.documentElement.requestFullscreen?.().catch(() => undefined);
  };
  const popOut = () => {
    const w = Math.min(1400, window.screen.availWidth - 80);
    const h = Math.min(900, window.screen.availHeight - 80);
    window.open(window.location.href, '_blank', `popup=yes,width=${w},height=${h}`);
  };
  return (
    <div className="fb-root fb-wincontrols" role="toolbar" aria-label={t('win.label')}>
      <button type="button" className="fb-iconbtn" onClick={popOut} title={t('win.newWindow')} aria-label={t('win.newWindow')}>
        <ExternalLink size={14} />
      </button>
      <button type="button" className="fb-iconbtn" onClick={toggle} title={t(full ? 'win.exitFull' : 'win.full')} aria-label={t(full ? 'win.exitFull' : 'win.full')} aria-pressed={full}>
        {full ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
      </button>
    </div>
  );
}
