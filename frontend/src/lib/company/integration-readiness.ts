import type { ConnectionManifest } from './connected-apps';

const en = {
  disabled: 'These app connections are disabled on the server.',
  schema: 'The server needs the connection database update.',
  credentials: 'The platform must configure this provider before you can sign in.',
  origin: 'The platform must approve your server address before you can connect.',
  checkFailed: 'Could not check server readiness. Retry or try connecting for details.',
  manual: 'Requires your token, webhook or server details',
  settings: 'Server setup details',
  sandbox: 'Test environment: authorize a sandbox account.',
  save: 'The connection could not be saved. Retry; it is not connected yet.',
  rejected: 'The provider rejected access. Check the token and account permissions.',
  expired: 'Authorization expired or was revoked. Connect the account again.',
  limited: 'The provider is limiting requests. Wait and retry.',
  provider: 'The provider could not verify the connection. Retry and check its settings.',
  state: 'This sign-in attempt expired or is already being completed. Start again.',
  scope: 'The required permission was not granted. Authorize the account again.',
  response: 'The server returned an unsupported response. Retry or contact support.',
  channel: 'No channel was found for this account. Check the account you authorized.',
};
type Messages = { [K in keyof typeof en]: string };
const el: Messages = {
  disabled: 'Αυτές οι συνδέσεις εφαρμογών είναι απενεργοποιημένες στον server.',
  schema: 'Χρειάζεται ενημέρωση της βάσης συνδέσεων στον server.',
  credentials: 'Πρέπει πρώτα να ρυθμιστεί η εφαρμογή αυτού του παρόχου από την πλατφόρμα.',
  origin: 'Πρέπει πρώτα να εγκριθεί η διεύθυνση του server σου από την πλατφόρμα.',
  checkFailed: 'Δεν ελέγχθηκε η ετοιμότητα του server. Δοκίμασε ξανά ή ξεκίνησε σύνδεση για λεπτομέρειες.',
  manual: 'Χρειάζεται δικό σου token, webhook ή στοιχεία server',
  settings: 'Λεπτομέρειες ρύθμισης server',
  sandbox: 'Δοκιμαστικό περιβάλλον: εξουσιοδότησε λογαριασμό sandbox.',
  save: 'Η σύνδεση δεν αποθηκεύτηκε. Δοκίμασε ξανά· δεν έχει συνδεθεί ακόμη.',
  rejected: 'Ο πάροχος απέρριψε την πρόσβαση. Έλεγξε το token και τις άδειες του λογαριασμού.',
  expired: 'Η εξουσιοδότηση έληξε ή ανακλήθηκε. Σύνδεσε ξανά τον λογαριασμό.',
  limited: 'Ο πάροχος περιορίζει τα αιτήματα. Περίμενε και δοκίμασε ξανά.',
  provider: 'Ο πάροχος δεν επαλήθευσε τη σύνδεση. Δοκίμασε ξανά και έλεγξε τις ρυθμίσεις του.',
  state: 'Αυτή η προσπάθεια σύνδεσης έληξε ή ήδη ολοκληρώνεται. Ξεκίνησε ξανά.',
  scope: 'Δεν δόθηκε η απαραίτητη άδεια. Εξουσιοδότησε ξανά τον λογαριασμό.',
  response: 'Ο server επέστρεψε μη υποστηριζόμενη απόκριση. Δοκίμασε ξανά ή επικοινώνησε με υποστήριξη.',
  channel: 'Δεν βρέθηκε κανάλι σε αυτόν τον λογαριασμό. Έλεγξε ποιον λογαριασμό εξουσιοδότησες.',
};
// As with deviceMessages, setup diagnostics explicitly fall back to English.
export const integrationMessages = (lang: string): Messages => lang === 'el' ? el : en;

export function connectionSetupReason(manifest: ConnectionManifest | null, kind: string): keyof Messages | null {
  if (!manifest) return null;
  if (manifest.server_error === 'schema_required') return 'schema';
  if (!manifest.enabled) return 'disabled';
  const provider = manifest.providers.find(p => p.kind === kind);
  if (provider) return provider.configured && provider.enabled ? null : 'credentials';
  const bridge = manifest.bridges.find(p => p.kind === kind);
  if (bridge) return bridge.configured && bridge.enabled ? null : 'origin';
  return 'response';
}

export function integrationDiagnostic(code: string): keyof Messages | null {
  if (code === 'save_failed') return 'save';
  if (code === 'credentials_rejected') return 'rejected';
  if (['reauth', 'reauth_required', 'reconnect_required', 'unauthorized'].includes(code)) return 'expired';
  if (code === 'rate_limited') return 'limited';
  if (code === 'provider_failed') return 'provider';
  if (['bad_state', 'state_conflict', 'refresh_busy'].includes(code)) return 'state';
  if (code === 'missing_scope') return 'scope';
  if (code === 'no_channel') return 'channel';
  if (code === 'invalid_response' || code === 'response_too_large') return 'response';
  if (code === 'not_configured') return 'credentials';
  if (code === 'backend_setup_required') return 'disabled';
  if (code === 'origin_not_allowed' || code === 'invalid_origin') return 'origin';
  return null;
}
