/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', '"Noto Sans Devanagari"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      colors: {
        // Teal accent + marigold logo touch; neutrals lean cool.
        brand: { 50: '#ecfdfa', 100: '#d1faf2', 500: '#14a39a', 600: '#0e8a83', 700: '#0f6e6a' },
        marigold: '#f2a900',
        ink: { 900: '#0d1217', 850: '#121920', 800: '#18212a', 700: '#222d38', 600: '#2f3b48' },
      },
    },
  },
  plugins: [],
};
