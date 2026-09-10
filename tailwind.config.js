/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./public/index.html', './public/app.js'],
  theme: {
    extend: {
      colors: { slate: { 850: '#172033' } },
      animation: { 'fade-in': 'fadeIn .2s ease-out' },
      keyframes: { fadeIn: { from: { opacity: '0', transform: 'translateY(4px)' }, to: { opacity: '1', transform: 'translateY(0)' } } }
    }
  },
  plugins: []
};
