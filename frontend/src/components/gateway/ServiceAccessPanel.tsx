import { Link } from 'react-router';
import { useI18n } from '../../i18n/I18nProvider';
import { dashboardUrl, JARVIS_DASHBOARD } from '../../lib/company/service-dashboards';

const gateway = dashboardUrl(import.meta.env.VITE_OMNIROUTE_URL) || 'https://gateway.firboai.app/';
const free = dashboardUrl(import.meta.env.VITE_FREELLMAPI_DASHBOARD_URL);

/** Mount only inside platform-admin surfaces. Availability is not inferred from a link. */
export function ServiceAccessPanel() {
  const { lang } = useI18n();
  const el = lang === 'el';
  const external = (href: string, label: string) => <a className="fb-btn fb-btn--ghost" href={href} target="_blank" rel="noopener noreferrer">{label} ↗</a>;
  return <section className="fb-glass p-4" aria-label={el ? 'Πρόσβαση στις υπηρεσίες' : 'Service access'}>
    <h2 className="text-base font-semibold">{el ? 'Οι υπηρεσίες σου' : 'Your services'}</h2>
    <p className="fb-muted mt-1 text-sm">{el ? 'Άνοιγμα από υπολογιστή ή κινητό. Τα εξωτερικά dashboards μπορεί να ζητήσουν δική τους σύνδεση.' : 'Open from desktop or mobile. External dashboards may require a separate sign-in.'}</p>
    <div className="mt-4 grid gap-3 lg:grid-cols-3">
      <div className="rounded-xl border border-white/10 p-3">
        <h3 className="font-semibold">Gateway</h3>
        <p className="fb-muted mt-1 text-sm">{el ? 'Πάροχοι, μοντέλα και διαδρομές.' : 'Providers, models and routing.'}</p>
        <div className="mt-3 flex flex-wrap gap-2"><Link className="fb-btn fb-btn--primary" to="/admin?tab=console">{el ? 'Διαχείριση' : 'Manage'}</Link>{external(gateway, 'OmniRoute')}</div>
      </div>
      <div className="rounded-xl border border-white/10 p-3">
        <h3 className="font-semibold">Jarvis</h3>
        <p className="fb-muted mt-1 text-sm">{el ? 'Συνομιλία, εργαλεία και έλεγχος εκτέλεσης.' : 'Chat, tools and execution checks.'}</p>
        <div className="mt-3 flex flex-wrap gap-2"><Link className="fb-btn fb-btn--primary" to="/admin?tab=jarvis">{el ? 'Άνοιγμα Jarvis' : 'Open Jarvis'}</Link>{external(JARVIS_DASHBOARD, 'Dashboard')}</div>
      </div>
      <div className="rounded-xl border border-white/10 p-3">
        <h3 className="font-semibold">FreeLLMAPI</h3>
        <p className="fb-muted mt-1 text-sm">{free ? (el ? 'Εξωτερικό dashboard FreeLLMAPI.' : 'External FreeLLMAPI dashboard.') : (el ? 'Ιδιωτική υπηρεσία στον server. Η πρόσβαση από κινητό δεν έχει συνδεθεί ακόμη.' : 'Private server service. Remote dashboard access is not connected yet.')}</p>
        <div className="mt-3 flex flex-wrap gap-2">{free ? external(free, el ? 'Άνοιγμα FreeLLMAPI' : 'Open FreeLLMAPI') : <span className="fb-chip">{el ? 'Αναμονή σύνδεσης' : 'Connection pending'}</span>}
          <Link className="fb-btn fb-btn--ghost" to="/gateway?tab=free">{el ? 'Δωρεάν μοντέλα Gateway' : 'Gateway free models'}</Link>
        </div>
      </div>
    </div>
  </section>;
}
