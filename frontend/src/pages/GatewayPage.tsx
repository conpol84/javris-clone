import { GatewayPage as PlatformGatewayPage } from './GatewayLegacyPanel';
import { GatewayUnavailable, useFirboSession, WorkspaceGatewayPanel } from '../components/gateway/NativeGatewayConsole';

/** Global infrastructure is platform-admin-only; company users see only their memberships. */
export function GatewayPage() {
  const session = useFirboSession();
  if (session.loading || !session.data) return <GatewayUnavailable loading={session.loading} retry={session.reload} />;
  return session.data.platform_admin ? <PlatformGatewayPage /> : <WorkspaceGatewayPanel data={session.data} />;
}
