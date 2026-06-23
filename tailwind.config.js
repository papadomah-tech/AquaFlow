/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: { DEFAULT: '#1F4E79', light: '#2E75B6', lighter: '#DEEAF1' },
        success: '#1B5E20',
        warning: '#BF4D00',
        danger:  '#C00000',
      },
    },
  },
  plugins: [],
}
