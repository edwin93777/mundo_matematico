/** @type {import('tailwindcss').Config} */
export default {
  // Every file that contains class names (all classes are literal strings).
  content: ['./index.html', './js/**/*.js'],
  theme: {
    extend: {
      fontFamily: {
        display: ['Sora', 'system-ui', 'sans-serif'],
        body: ['Nunito', 'system-ui', 'sans-serif'],
      },
      colors: {
        ink: { DEFAULT: '#1e293b', soft: '#475569', mute: '#94a3b8' },
        brand: { DEFAULT: '#6d5dfc', soft: '#ede9fe' },
        unit: '#ffc21a', ten: '#1f6fff', hundred: '#12b04a', thousand: '#ff7a1a',
      },
      boxShadow: {
        glass: '0 20px 50px -12px rgba(76, 64, 190, 0.35)',
        pop: '0 4px 0 rgba(30, 41, 59, 0.18)',
      },
    },
  },
  plugins: [],
};
