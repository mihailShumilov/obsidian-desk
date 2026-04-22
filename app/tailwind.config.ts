import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

const config: Config = {
  darkMode: 'class',
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Obsidian palette — exact values from docs/UI_DESIGN.md §2.
        'obsidian-950': '#05050A',
        'obsidian-900': '#0B0B14',
        'obsidian-800': '#12121C',
        'obsidian-700': '#1E1E2C',
        'obsidian-600': '#2A2A3C',
        foreground: '#E4E4E7',
        muted: '#71717A',
        'cipher-cyan': '#00F5D4',
        'cipher-cyan-dim': '#00B39A',
        'bitcoin-ember': '#FF8A00',
        'solana-violet': '#A855F7',
        'danger-red': '#FF3E6A',
        'match-gold': '#FFD166',
      },
      fontFamily: {
        sans: ['var(--font-geist)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
      },
      letterSpacing: {
        // -0.02em per UI_DESIGN.md §3 — applied to display headings
        tightest: '-0.02em',
      },
      backgroundImage: {
        'gradient-cipher':
          'linear-gradient(120deg, #00F5D4 0%, #00B39A 100%)',
        'gradient-glass':
          'radial-gradient(circle at center, rgba(0,245,212,0.08) 0%, transparent 60%)',
        'gradient-duality':
          'linear-gradient(90deg, #A855F7 0%, #FF8A00 100%)',
      },
      boxShadow: {
        // shadow-cipher — primary CTA glow (UI_DESIGN.md §4.2)
        cipher: '0 0 24px rgba(0,245,212,0.35)',
        'cipher-strong': '0 0 36px rgba(0,245,212,0.55)',
      },
      keyframes: {
        // Cipher glyph cadence (~800ms per UI_DESIGN.md §5.1)
        'pulse-cipher': {
          '0%, 100%': { opacity: '0.85' },
          '50%': { opacity: '1' },
        },
        // Used by <Cipher /> as a subtle char shimmer between mutations
        scramble: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-1px)' },
        },
        // Settlement thread shimmer left→right
        'thread-shimmer': {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        // Match beacon — concentric ring expansion
        'beacon-expand': {
          '0%': { transform: 'scale(0.5)', opacity: '0.9' },
          '100%': { transform: 'scale(2.4)', opacity: '0' },
        },
      },
      animation: {
        'pulse-cipher': 'pulse-cipher 800ms ease-in-out infinite',
        scramble: 'scramble 1200ms ease-in-out infinite',
        'thread-shimmer': 'thread-shimmer 2.4s linear infinite',
        'beacon-expand': 'beacon-expand 800ms ease-out forwards',
      },
      transitionTimingFunction: {
        // Default snappy curve from UI_DESIGN.md §7
        snappy: 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
    },
  },
  plugins: [animate],
};

export default config;
