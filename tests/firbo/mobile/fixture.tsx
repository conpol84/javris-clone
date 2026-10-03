import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogTitle, DialogTrigger } from '../../../frontend/src/components/ui/dialog';
import { PageHeader, Segmented, Stat } from '../../../frontend/src/components/ui/kit';
import './fixture.css';
import '../../../frontend/src/styles/firbo.css';
import '../../../frontend/src/styles/mobile-foundation.css';

// REAL shared components, synthetic content only. No application auth/data client.
const params = new URLSearchParams(location.search);
const labels: Record<string, string> = {
  en: 'Review company connections and permission settings',
  el: 'Αναλυτική διαχείριση συνδέσεων και δικαιωμάτων εταιρείας',
  ar: 'إدارة اتصالات الشركة والصلاحيات ومراجعة نتائج المهام',
  es: 'Revisión de las conexiones de la empresa y configuración de permisos',
  fr: 'Vérification des connexions de l’entreprise et des autorisations',
  de: 'Unternehmensverbindungen und Berechtigungseinstellungen überprüfen',
  'pt-BR': 'Revisão das conexões da empresa e configurações de permissões',
  'zh-CN': '检查公司连接与权限设置并查看智能体任务执行结果',
};
const requested = params.get('lang') ?? 'en';
const lang = Object.hasOwn(labels, requested) ? requested : 'en';
const longLabel = labels[lang];
document.documentElement.lang = lang;
document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
document.documentElement.classList.add(params.get('theme') === 'light' ? 'light' : 'dark');

function Fixture() {
  const [tab, setTab] = useState('overview');
  const [result, setResult] = useState('');
  return <main className="fb-root" style={{padding:16, minHeight:'100dvh', overflowX:'visible'}}>
    <PageHeader title={longLabel} sub={'https://example.test/' + 'long-unbroken-name-'.repeat(12)} right={<button className="fb-btn" data-testid="long-action">{longLabel}</button>} />
    <Segmented label="Fixture tabs" value={tab} onChange={setTab} options={['overview','routing','quota'].map(id => ({id,label:longLabel + ' ' + id}))} />
    <p data-testid="selected-tab">{tab}</p>
    <div style={{display:'grid',gridTemplateColumns:'minmax(0, 1fr)',gap:12,marginBlock:16}}><Stat label={longLabel} value="12345678901234567890.00" hint={longLabel} delta={{text:'+12%',good:true}} /></div>
    <dl className="fb-kv"><dt>{longLabel}</dt><dd>{'account-'.repeat(25)}</dd></dl>
    <Dialog>
      <DialogTrigger data-testid="open-dialog" className="fb-btn">Open test dialog</DialogTrigger>
      <DialogContent data-testid="dialog">
        <DialogTitle>{longLabel}</DialogTitle>
        <DialogDescription>{longLabel}</DialogDescription>
        {Array.from({length:12}, (_,i) => <label key={i} style={{display:'grid',gap:6}}>{longLabel} {i + 1}<input data-testid={'field-'+i} className="fb-input" defaultValue={i ? '' : 'synthetic text'} /></label>)}
        <DialogFooter><DialogClose data-testid="finish-dialog" onClick={() => setResult('closed')}>{longLabel}</DialogClose></DialogFooter>
      </DialogContent>
    </Dialog>
    <p data-testid="dialog-result">{result}</p>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
