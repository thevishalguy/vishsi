/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#191919',
        'bg-raised': '#1F1F1F',
        'bg-high': '#242424',
        border: '#2E2E2E',
        'border-soft': '#262626',
        accent: '#D97757',
        'accent-dim': '#8A4A33',
        text: '#E8E6E3',
        'text-dim': '#A1A1A1',
        'text-faint': '#6B6B6B',
        ok: '#7FB069',
        warn: '#E0B252',
        err: '#D96C6C',
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Consolas', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        '2xs': '0.6875rem',
      },
    },
  },
  plugins: [],
};
