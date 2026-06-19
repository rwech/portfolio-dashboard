(function () {
  window.PFD = window.PFD || {};
  window.PFD.config = {
    // When index.html is hosted separately from the Vercel deployment (e.g. GitHub Pages),
    // set this to the Vercel deployment's origin, e.g. 'https://portfolio-dashboard.vercel.app'.
    // Leave empty when the page and /api/stock-price share the same origin (e.g. `vercel dev`
    // or a Vercel-hosted static deploy).
    apiBaseUrl: '',
  };
})();
