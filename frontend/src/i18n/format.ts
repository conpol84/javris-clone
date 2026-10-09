import type { Lang } from './core';

export interface Formatters {
  number: (n: number, opts?: Intl.NumberFormatOptions) => string;
  currency: (n: number, currency?: string) => string;
  date: (d: Date | number | string, opts?: Intl.DateTimeFormatOptions) => string;
  dateTime: (d: Date | number | string) => string;
  time: (d: Date | number) => string;
  longDate: (d: Date | number) => string;
  relative: (at: number, now?: number) => string;
}

/** Locale-aware formatting. Arabic/Chinese tags keep Western digits where Intl would not by default. */
export function makeFormatters(lang: Lang): Formatters {
  const locale = lang === 'ar' ? 'ar-u-nu-latn' : lang;
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' });
  const asDate = (d: Date | number | string) => (d instanceof Date ? d : new Date(d));
  return {
    number: (n, opts) => new Intl.NumberFormat(locale, opts).format(n),
    currency: (n, currency = 'USD') => new Intl.NumberFormat(locale, { style: 'currency', currency }).format(n),
    date: (d, opts) => new Intl.DateTimeFormat(locale, opts ?? { dateStyle: 'medium' }).format(asDate(d)),
    dateTime: (d) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(asDate(d)),
    time: (d) => new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(asDate(d)),
    longDate: (d) => new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long' }).format(asDate(d)),
    relative: (at, now = Date.now()) => {
      const s = Math.max(0, Math.round((now - at) / 1000));
      if (s < 60) return rtf.format(0, 'second');
      if (s < 3600) return rtf.format(-Math.floor(s / 60), 'minute');
      if (s < 86_400) return rtf.format(-Math.floor(s / 3600), 'hour');
      return rtf.format(-Math.floor(s / 86_400), 'day');
    },
  };
}
