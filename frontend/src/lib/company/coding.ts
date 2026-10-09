/** How each coding assistant is pointed at the Firbo AI gateway. Commands follow OmniRoute's own `setup-*` and `run` tooling. */
export type CodingSupport = 'auto' | 'manual' | 'limited';

export interface CodingTool {
  id: string;
  name: string;
  support: CodingSupport;
  /** Commands to show, built from the user's gateway URL, key and model. */
  steps: (v: { url: string; key: string; model: string }) => { label: string; code: string }[];
}

const root = (url: string) => url.replace(/\/+$/, '');
const v1 = (url: string) => `${root(url)}/v1`;
const k = (key: string) => key || '<YOUR_GATEWAY_KEY>';
const flags = (v: { url: string; key: string }) => `--remote ${root(v.url)} --api-key ${k(v.key)}`;
const generic = (v: { url: string; key: string; model: string }) => [
  { label: 'env', code: `export OPENAI_BASE_URL=${v1(v.url)}\nexport OPENAI_API_KEY=${k(v.key)}\n# model: ${v.model}` },
];

export const CODING_TOOLS: CodingTool[] = [
  {
    id: 'claude', name: 'Claude Code', support: 'auto',
    steps: (v) => [
      { label: 'setup', code: `omniroute setup-claude ${flags(v)}` },
      { label: 'run', code: `omniroute run claude ${flags(v)} --model ${v.model}` },
      { label: 'env', code: `export ANTHROPIC_BASE_URL=${root(v.url)}\nexport ANTHROPIC_AUTH_TOKEN=${k(v.key)}` },
    ],
  },
  {
    id: 'codex', name: 'Codex CLI', support: 'auto',
    steps: (v) => [
      { label: 'setup', code: `omniroute setup-codex ${flags(v)}\ncodex --profile <profile-name>` },
      { label: 'run', code: `omniroute launch-codex ${flags(v)}` },
    ],
  },
  {
    id: 'gemini', name: 'Gemini CLI', support: 'auto',
    steps: (v) => [
      { label: 'run', code: `omniroute run gemini ${flags(v)} --model ${v.model}` },
      { label: 'env', code: `export GOOGLE_GEMINI_BASE_URL=${root(v.url)}\nexport GEMINI_API_KEY=${k(v.key)}` },
    ],
  },
  {
    id: 'opencode', name: 'OpenCode', support: 'auto',
    steps: (v) => [
      { label: 'setup', code: `omniroute setup-opencode ${flags(v)}\nopencode -m omniroute/${v.model}` },
      { label: 'run', code: `omniroute run opencode ${flags(v)} --model ${v.model}` },
    ],
  },
  {
    id: 'cline', name: 'Cline', support: 'auto',
    steps: (v) => [{ label: 'setup', code: `omniroute setup-cline ${flags(v)} --model ${v.model} --yes` }],
  },
  {
    id: 'aider', name: 'Aider', support: 'auto',
    steps: (v) => [
      { label: 'setup', code: `omniroute setup-aider ${flags(v)} --model ${v.model} --yes` },
      { label: 'run', code: `omniroute run aider ${flags(v)} --model ${v.model}` },
    ],
  },
  {
    id: 'goose', name: 'Goose', support: 'auto',
    steps: (v) => [
      { label: 'setup', code: `omniroute setup-goose ${flags(v)} --model ${v.model} --yes` },
      { label: 'run', code: `omniroute run goose ${flags(v)} --model ${v.model}` },
    ],
  },
  {
    id: 'continue', name: 'Continue', support: 'auto',
    steps: (v) => [{ label: 'setup', code: `omniroute setup-continue ${flags(v)}` }],
  },
  {
    id: 'kilo', name: 'Kilo Code', support: 'auto',
    steps: (v) => [{ label: 'setup', code: `omniroute setup-kilo ${flags(v)} --model ${v.model} --yes` }],
  },
  {
    id: 'qwen', name: 'Qwen CLI', support: 'auto',
    steps: (v) => [
      { label: 'setup', code: `omniroute setup-qwen ${flags(v)} --model ${v.model} --yes` },
      { label: 'run', code: `omniroute run qwen ${flags(v)} --model ${v.model}` },
    ],
  },
  {
    id: 'cursor', name: 'Cursor CLI', support: 'manual',
    steps: (v) => [
      { label: 'setup', code: `omniroute setup-cursor ${flags(v)}` },
      { label: 'app', code: `Settings → Models → OpenAI API Key: ${k(v.key)}\nOverride OpenAI Base URL: ${v1(v.url)}` },
    ],
  },
  { id: 'copilot', name: 'GitHub Copilot CLI', support: 'manual', steps: generic },
  { id: 'interpreter', name: 'Open Interpreter', support: 'manual', steps: (v) => [{ label: 'run', code: `interpreter --api_base ${v1(v.url)} --api_key ${k(v.key)} --model openai/${v.model}` }] },
  { id: 'grok', name: 'Grok Build', support: 'manual', steps: generic },
  { id: 'droid', name: 'Factory Droid', support: 'limited', steps: generic },
  { id: 'warp', name: 'Warp AI', support: 'limited', steps: generic },
  { id: 'windsurf', name: 'Windsurf', support: 'limited', steps: generic },
  { id: 'kiro', name: 'Kiro', support: 'limited', steps: () => [] },
];
