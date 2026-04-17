const enabled = process.stdout.isTTY ?? false;

function wrap(code: string, text: string): string {
  return enabled ? `\x1b[${code}m${text}\x1b[0m` : text;
}

export const c = {
  bold: (t: string) => wrap('1', t),
  dim: (t: string) => wrap('2', t),
  red: (t: string) => wrap('31', t),
  green: (t: string) => wrap('32', t),
  yellow: (t: string) => wrap('33', t),
  cyan: (t: string) => wrap('36', t),
  gray: (t: string) => wrap('90', t),
};
