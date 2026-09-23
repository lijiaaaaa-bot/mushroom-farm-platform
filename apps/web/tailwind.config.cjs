const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, 'src/farm-ops-tokens.ts'), 'utf8');

function token(name) {
  const match = source.match(new RegExp(`${name}:\\s*'([^']+)'`));
  if (!match) throw new Error(`missing farm-ops token ${name}`);
  return match[1];
}

const tokens = {
  canvas: token('canvas'),
  canvasAlt: token('canvasAlt'),
  card: token('card'),
  ink: token('ink'),
  mist: token('mist'),
  line: token('line'),
  sidebar: token('sidebar'),
  sidebarActive: token('sidebarActive'),
  accent: token('accent'),
  warn: token('warn'),
  critical: token('critical'),
  radius: token('radius'),
  radiusSm: token('radiusSm'),
};

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{vue,ts}'],
  theme: {
    extend: {
      colors: {
        canvas: tokens.canvas,
        ink: tokens.ink,
        panel: tokens.card,
        line: tokens.line,
        mist: tokens.mist,
        accent: tokens.accent,
        grow: tokens.sidebar,
        sidebar: tokens.sidebar,
        'sidebar-active': tokens.sidebarActive,
        amber: tokens.warn,
        warn: tokens.warn,
        danger: tokens.critical,
      },
      borderRadius: {
        md: tokens.radiusSm,
        lg: tokens.radius,
      },
      fontFamily: {
        sans: ['"Noto Sans SC"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
};
