import { Navigate } from 'react-router';
import { GatewayPage as PlatformGatewayPage } from './GatewayLegacyPanel';
import { GatewayUnavailable, useFirboSession } from '../components/gateway/NativeGatewayConsole';
import { usePlatformAdminAccess } from '../lib/company/admin';
import { useI18n } from '../i18n/I18nProvider';

/** Do not even instantiate the Gateway data/client until auth has confirmed
 * platform-admin status. An org Owner/Admin alone is NOT a FIRBO platform admin.
 */
function VerifiedPlatformGateway() {
  const session=useFirboSession();
  if(session.loading||!session.data)return <GatewayUnavailable loading={session.loading}
    retry={session.reload} adminServices />;
  if(session.data.platform_admin!==true)return <Navigate to="/" replace />;
  return <PlatformGatewayPage />;
}
export function GatewayPage() {
  const {authorized,loading}=usePlatformAdminAccess();
  const {t}=useI18n();
  if(loading)return <div className="fb-root grid h-full place-items-center"
    role="status"><span className="fb-dim">{t('common.loading')}</span></div>;
  if(!authorized)return <Navigate to="/" replace />;
  return <VerifiedPlatformGateway />;
}
