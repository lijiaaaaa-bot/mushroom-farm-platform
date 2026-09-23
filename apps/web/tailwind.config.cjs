/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{vue,ts}'],
  theme: {
    extend: {
      colors: {
        canvas: '#F5F7FA',
        ink: '#1e293b',
        panel: '#ffffff',
        line: '#e2e8f0',
        mist: '#64748b',
        accent: '#1B7A4E',
        grow: '#2F9E44',
        amber: '#c48a16',
        danger: '#c44536',
      },
      fontFamily: {
        sans: ['"Noto Sans SC"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
};
