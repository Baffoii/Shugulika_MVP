/** @type {import('postcss-load-config').Config} */
export default {
  plugins: {
    // Tailwind v4 ships its own PostCSS plugin and handles vendor prefixing
    // internally, so autoprefixer is no longer needed here.
    "@tailwindcss/postcss": {},
  },
};
