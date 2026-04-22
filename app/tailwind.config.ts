import type { Config } from 'tailwindcss';

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
        // Full ObsidianDesk palette wired in P5 per docs/UI_DESIGN.md §2.
        // Minimal set here so the scaffold renders coherently.
        'obsidian-950': '#05050A',
        'obsidian-900': '#0B0B14',
        foreground: '#E4E4E7',
        muted: '#71717A',
      },
    },
  },
  plugins: [],
};

export default config;
