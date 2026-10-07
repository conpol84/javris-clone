export type ComputerPlatform = 'mac' | 'windows' | 'linux';
export type ComputerAccess = 'browser' | 'files' | 'advanced';

/** The website may be on a phone; this is a suggestion, never a device claim. */
export function suggestedComputerPlatform(platform: string): ComputerPlatform {
  if (/win/i.test(platform)) return 'windows';
  if (/linux/i.test(platform) && !/android/i.test(platform)) return 'linux';
  return 'mac';
}

/** Use the downloaded file's full path, regardless of Terminal's current folder. */
export function connectorCommands(platform: ComputerPlatform, access: ComputerAccess, code?: string) {
  if (code !== undefined && !/^[A-Z0-9]{8,20}$/.test(code)) throw new Error('invalid_pairing_code');
  const file = platform === 'windows' ? '"$env:USERPROFILE\\Downloads\\firbo-connector.mjs"' : '"$HOME/Downloads/firbo-connector.mjs"';
  const documents = platform === 'windows' ? '"$env:USERPROFILE\\Documents"' : '"$HOME/Documents"';
  const prefix = `node ${file}`;
  const permissions = access === 'browser' ? '--allow-browser' : `--allow ${documents} --allow-browser${access === 'advanced' ? ' --allow-write --allow-exec' : ''}`;
  return {
    pair: code ? `${prefix} pair ${code} ${permissions}` : null,
    run: `${prefix} run`,
    status: `${prefix} status`,
    allowBrowser: `${prefix} allow-browser`,
    allowApps: `${prefix} allow-apps`,
    allowWrite: `${prefix} allow-write`,
    allowExec: `${prefix} allow-exec`,
    auto: `${prefix} auto`,
  };
}
