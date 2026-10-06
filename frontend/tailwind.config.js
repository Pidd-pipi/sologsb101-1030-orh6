/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{svelte,ts,js}'],
  theme: {
    extend: {
      colors: {
        ivory: '#faf7f2',
        ebony: '#22201d',
        walnut: '#6b4a2f',
        brass: '#c8a25a'
      }
    }
  },
  plugins: []
};
