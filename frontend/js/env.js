// Build-time environment.
// In development this file stays as-is (empty values → config.js defaults).
// `npm run build` writes dist/js/env.js with the values from Render's env vars
// (API_BASE_URL), so no URL is ever hard-coded in the source.
export const ENV = Object.freeze({
  API_BASE_URL: '',
  BUILD: 'dev',
});
