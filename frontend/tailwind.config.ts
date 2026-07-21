import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        paper: '#FCFDFB',
        ink: '#0F1F17',
        muted: '#5A6B60',
        rule: '#DDE5DE',
        accent: {
          DEFAULT: '#14532D',
          hover: '#0F3D22',
          soft: '#E1EEE7',
        },
      },
      fontFamily: {
        serif: ['"Computer Modern Serif"', '"Latin Modern Roman"', 'Georgia', 'serif'],
        sans: ['"Computer Modern Sans"', '"CMU Sans Serif"', 'system-ui', 'sans-serif'],
        mono: [
          '"Computer Modern Typewriter"',
          '"Latin Modern Mono"',
          'ui-monospace',
          'monospace',
        ],
      },
      borderRadius: {
        DEFAULT: '4px',
        sm: '2px',
      },
      letterSpacing: {
        smallcaps: '0.08em',
      },
    },
  },
  plugins: [],
};

export default config;
