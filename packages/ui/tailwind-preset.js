/**
 * Tavolina Tailwind preset. Colours reference CSS variables (RGB channels) defined in
 * src/styles/tokens.css, so light/dark themes switch by toggling the `dark` class on <html>.
 * @type {import('tailwindcss').Config}
 */
const channel = (name) => `rgb(var(--${name}) / <alpha-value>)`;

const scale = (prefix) =>
  Object.fromEntries(
    [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950].map((step) => [
      step,
      channel(`${prefix}-${step}`),
    ]),
  );

const semantic = (name) => ({
  DEFAULT: channel(name),
  fg: channel(`${name}-fg`),
  soft: channel(`${name}-soft`),
  'soft-fg': channel(`${name}-soft-fg`),
});

export default {
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Raw scales (warm-olive neutral, olive/espresso brand, saffron highlight)
        sand: scale('sand'),
        olive: scale('olive'),
        saffron: scale('saffron'),

        // Semantic surface tokens — use these in components
        background: channel('background'),
        surface: {
          DEFAULT: channel('surface'),
          raised: channel('surface-raised'),
          sunken: channel('surface-sunken'),
        },
        border: {
          DEFAULT: channel('border'),
          strong: channel('border-strong'),
        },
        foreground: {
          DEFAULT: channel('foreground'),
          muted: channel('foreground-muted'),
          subtle: channel('foreground-subtle'),
        },
        primary: {
          DEFAULT: channel('primary'),
          hover: channel('primary-hover'),
          fg: channel('primary-fg'),
          soft: channel('primary-soft'),
          'soft-fg': channel('primary-soft-fg'),
        },
        highlight: semantic('highlight'),
        success: semantic('success'),
        warning: semantic('warning'),
        danger: semantic('danger'),
        info: semantic('info'),
        reserved: semantic('reserved'),
        ring: channel('ring'),
      },
      fontFamily: {
        sans: [
          '"Manrope Variable"',
          'Manrope',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'sans-serif',
        ],
        mono: [
          '"JetBrains Mono"',
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'Consolas',
          'monospace',
        ],
      },
      borderRadius: {
        control: '10px',
        card: '14px',
      },
      boxShadow: {
        overlay:
          '0 12px 32px -8px rgb(var(--shadow) / 0.28), 0 2px 6px -2px rgb(var(--shadow) / 0.16)',
        raised: '0 1px 2px rgb(var(--shadow) / 0.08)',
      },
      minHeight: { touch: '48px' },
      minWidth: { touch: '48px' },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'fade-out': { from: { opacity: '1' }, to: { opacity: '0' } },
        'zoom-in': {
          from: { opacity: '0', transform: 'translate(-50%, -48%) scale(0.97)' },
          to: { opacity: '1', transform: 'translate(-50%, -50%) scale(1)' },
        },
        'slide-in-right': {
          from: { transform: 'translateX(100%)' },
          to: { transform: 'translateX(0)' },
        },
        'slide-in-left': {
          from: { transform: 'translateX(-100%)' },
          to: { transform: 'translateX(0)' },
        },
        'slide-in-bottom': {
          from: { transform: 'translateY(100%)' },
          to: { transform: 'translateY(0)' },
        },
        'toast-in': {
          from: { opacity: '0', transform: 'translateY(8px) scale(0.98)' },
          to: { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
        shake: {
          '0%, 100%': { transform: 'translateX(0)' },
          '20%, 60%': { transform: 'translateX(-8px)' },
          '40%, 80%': { transform: 'translateX(8px)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 150ms ease-out',
        'fade-out': 'fade-out 120ms ease-in',
        'zoom-in': 'zoom-in 180ms cubic-bezier(0.16, 1, 0.3, 1)',
        'slide-in-right': 'slide-in-right 240ms cubic-bezier(0.16, 1, 0.3, 1)',
        'slide-in-left': 'slide-in-left 240ms cubic-bezier(0.16, 1, 0.3, 1)',
        'slide-in-bottom': 'slide-in-bottom 260ms cubic-bezier(0.16, 1, 0.3, 1)',
        'toast-in': 'toast-in 200ms cubic-bezier(0.16, 1, 0.3, 1)',
        shimmer: 'shimmer 1.6s infinite',
        shake: 'shake 0.4s ease-in-out',
      },
    },
  },
  plugins: [],
};
