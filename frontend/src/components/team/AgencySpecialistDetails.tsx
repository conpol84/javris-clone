import { useI18n } from '../../i18n/I18nProvider';
import { AGENCY_COPY, AGENCY_DELIVERABLE } from '../../lib/company/agencyCopy';
import { agencySourceUrl, agencySpecialist, type AgencySpecialistSlug } from '../../lib/company/agencySpecialists';

/** No remote catalog request or permission mutation: this previews the hiring prompt. */
export function AgencySpecialistDetails({ slug, expanded = false }: { slug: string; expanded?: boolean }) {
  const { lang } = useI18n();
  const specialist = agencySpecialist(slug);
  if (!specialist) return null;
  const copy = AGENCY_COPY[lang];
  return (
    <details className="rounded-lg border p-3 text-xs" style={{ borderColor: 'var(--fb-border)' }} open={expanded || undefined}>
      <summary className="cursor-pointer font-medium">{copy.method}</summary>
      <div className="fb-col mt-2 gap-2 leading-relaxed">
        <p>{copy[AGENCY_DELIVERABLE[slug as AgencySpecialistSlug]]}</p>
        <p className="fb-dim">{copy.scope}</p>
        <a className="underline underline-offset-2" href={agencySourceUrl(specialist)} target="_blank" rel="noopener noreferrer">{copy.source}</a>
      </div>
    </details>
  );
}
