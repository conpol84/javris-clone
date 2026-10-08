import { useLayoutEffect, useRef } from 'react';
import { NavLink } from 'react-router';
import { LayoutDashboard, Menu, Mic, Store, Users } from 'lucide-react';
import { useI18n } from '../../i18n/I18nProvider';
import { useAppStore } from '../../lib/store';
import '../../styles/firbo.css';

/** Thumb-reach tab bar for phones: the five places you use most, plus the full menu. */
export function BottomNav() {
  const { t } = useI18n();
  const nav = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const element = nav.current;
    if (!element) return;
    const update = () => document.documentElement.style.setProperty('--fb-bottomnav-height', `${Math.ceil(element.getBoundingClientRect().height)}px`);
    update();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    observer?.observe(element);
    window.addEventListener('resize', update);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', update);
      document.documentElement.style.removeProperty('--fb-bottomnav-height');
    };
  }, []);
  const setSidebarOpen = useAppStore((s) => s.setSidebarOpen);
  const items = [
    { to: '/', icon: LayoutDashboard, label: t('nav.commandCenter'), end: true },
    { to: '/ceo', icon: Mic, label: t('nav.ceo') },
    { to: '/team', icon: Users, label: t('nav.team') },
    { to: '/store', icon: Store, label: t('nav.store') },
  ];
  return (
    <nav ref={nav} className="fb-root fb-bottomnav md:hidden" aria-label={t('nav.more')}>
      {items.map(({ to, icon: Icon, label, end }) => (
        <NavLink key={to} to={to} end={end} className={({ isActive }) => `fb-tab ${isActive ? 'is-active' : ''}`}>
          <Icon size={20} />
          <span>{label}</span>
        </NavLink>
      ))}
      <button type="button" className="fb-tab" onClick={() => setSidebarOpen(true)}>
        <Menu size={20} />
        <span>{t('nav.more')}</span>
      </button>
    </nav>
  );
}
