import { COMPANY_ENABLED } from './client';

/** With the company workspace on, "/" is the Command Center and chat moves to /chat. */
export const CHAT_PATH = COMPANY_ENABLED ? '/chat' : '/';
