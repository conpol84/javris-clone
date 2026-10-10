/** OpenJarvis VPS dashboard and native API are independent of the Vercel SPA.
 * This diagnoses only the server-jarvis Edge reply. Never treat public /health
 * or a visible login form as proof of authenticated model/tool execution.
 */
export const NATIVE_JARVIS_LOGIN = 'https://jarvis.firboai.app/_firbo/login';

export interface NativeJarvisStatus {
  configured?: boolean;
  online?: boolean;
  reason?: unknown;
}
export type NativeJarvisDiagnosis =
  | 'checking' | 'bridge_unavailable' | 'not_configured'
  | 'online' | 'native_api_unauthorized' | 'native_api_forbidden'
  | 'native_api_not_found' | 'native_api_unavailable';

export function diagnoseNativeJarvis(
  status: NativeJarvisStatus | null,
  bridgeFailed = false,
): NativeJarvisDiagnosis {
  if (bridgeFailed) return 'bridge_unavailable';
  if (!status) return 'checking';
  if (status.configured === false) return 'not_configured';
  if (status.configured !== true) return 'bridge_unavailable';
  if (status.online === true) return 'online';
  const code = typeof status.reason === 'string' && /^http_(401|403|404|429|500|502|503|504)$/.test(status.reason)
    ? status.reason : '';
  if (code === 'http_401') return 'native_api_unauthorized';
  if (code === 'http_403') return 'native_api_forbidden';
  if (code === 'http_404') return 'native_api_not_found';
  return 'native_api_unavailable';
}

type Labels = { label: string; login: string; separation: string; details: Record<NativeJarvisDiagnosis, string> };
const EN: Labels = {
  label: 'Native OpenJarvis VPS backend (server check)',
  login: 'Open VPS sign-in',
  separation: 'Jarvis dashboard login is separate from your FIRBO account. An accessible sign-in page does not prove the private native API is connected.',
  details: {
    checking: 'Checking the protected native API through the FIRBO server bridge.',
    bridge_unavailable: 'FIRBO cannot read server bridge status. Check platform-admin permission and the server-jarvis function.',
    not_configured: 'The server bridge is missing the native API URL or server-side key. Configure these only as server secrets, never in the browser.',
    online: 'The authenticated native OpenJarvis API replied to the server bridge. A useful tool execution still needs a real work receipt.',
    native_api_unauthorized: 'Native API returned 401 to the server bridge. Its server-held API credential may be invalid; the dashboard password is separate.',
    native_api_forbidden: 'Native API returned 403 to the server bridge. Review VPS route and service authorization.',
    native_api_not_found: 'Native API route returned 404. Check configured OpenJarvis URL and path.',
    native_api_unavailable: 'Native API did not respond successfully. Check the VPS service and server-side route. Public /health is not enough.',
  },
};
const EL: Labels = {
  label: 'Πραγματικό OpenJarvis στον VPS (έλεγχος server)',
  login: 'Σύνδεση στον VPS Jarvis',
  separation: 'Το login του Jarvis στον VPS είναι διαφορετικό από τον FIRBO λογαριασμό. Η φόρμα login δεν αποδεικνύει ότι έχει συνδεθεί το ιδιωτικό API.',
  details: {
    checking: 'Ελέγχεται το προστατευμένο OpenJarvis API από τον FIRBO server.',
    bridge_unavailable: 'Δεν ανακτήθηκε κατάσταση από τη γέφυρα server-jarvis. Έλεγξε δικαιώματα platform-admin και Edge Function.',
    not_configured: 'Λείπει το server-side URL ή API key του OpenJarvis. Ρύθμισέ τα μόνο ως μυστικά του server, ποτέ στον browser.',
    online: 'Το προστατευμένο OpenJarvis API απάντησε στη γέφυρα. Η πραγματική εκτέλεση εργαλείου απαιτεί ακόμη ξεχωριστό receipt.',
    native_api_unauthorized: 'Το OpenJarvis API επέστρεψε 401 στη γέφυρα. Έλεγξε το server-side API key, όχι τον κωδικό της φόρμας dashboard.',
    native_api_forbidden: 'Το OpenJarvis API επέστρεψε 403. Χρειάζεται έλεγχος εξουσιοδότησης στη διαδρομή VPS.',
    native_api_not_found: 'Το OpenJarvis API επέστρεψε 404. Χρειάζεται έλεγχος του URL και της διαδρομής στον server.',
    native_api_unavailable: 'Το OpenJarvis API δεν απάντησε επιτυχώς. Έλεγξε την υπηρεσία VPS και το route. Το δημόσιο /health δεν αρκεί.',
  },
};
export function nativeJarvisLabels(lang: string): Labels {
  return lang === 'el' ? EL : EN;
}
