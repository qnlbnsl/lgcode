// Kept as browser-compatible TypeScript so it can run before the styles paint.
(() => {
  let choice = null;
  try { choice = localStorage.getItem('lgtm-marketing-theme'); } catch { /* Storage may be unavailable. */ }
  document.documentElement.dataset.theme = choice === 'light' || choice === 'dark'
    ? choice : matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
})();
