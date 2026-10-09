import { useEffect, useRef } from 'react';
import { isLang } from '../../i18n/core';
import { useI18n } from '../../i18n/I18nProvider';
import { companyClient } from '../../lib/company/client';
import { useCompanyAuth } from '../../lib/company/AuthProvider';

/**
 * Keeps the interface language in step with the signed-in profile, so it follows the person across devices.
 * First load after sign-in: the saved profile language wins (or, if none is saved yet, today's choice is saved).
 * Afterwards: any change made in the language switcher is written back. Failures never affect the UI.
 */
export function LocaleSync() {
  const { user } = useCompanyAuth();
  const { lang, setLang } = useI18n();
  const syncedFor = useRef<string | null>(null);
  const langRef = useRef(lang);
  langRef.current = lang;
  const userId = user?.id ?? null;

  useEffect(() => {
    if (!companyClient || !userId || syncedFor.current === userId) return;
    let live = true;
    void (async () => {
      try {
        const { data } = await companyClient.from('profiles').select('locale').eq('id', userId).maybeSingle();
        if (!live) return;
        const saved = data?.locale;
        syncedFor.current = userId;
        if (isLang(saved)) {
          if (saved !== langRef.current) setLang(saved, { remote: false });
        } else {
          await companyClient.from('profiles').update({ locale: langRef.current }).eq('id', userId);
        }
      } catch {
        /* best effort */
      }
    })();
    return () => {
      live = false;
    };
  }, [userId, setLang]);

  useEffect(() => {
    if (!companyClient || !userId || syncedFor.current !== userId) return;
    void companyClient.from('profiles').update({ locale: lang }).eq('id', userId).then(() => undefined, () => undefined);
  }, [lang, userId]);

  return null;
}
