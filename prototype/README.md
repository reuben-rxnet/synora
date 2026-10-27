# Synora prototype

Clickable product prototype for Synora — *Enterprise intelligence, connected.*
All records, connectors, people and metrics are demonstration data. Nothing calls a live system.

## Build

```bash
npm install
npm run build
```

`dist/synora.html` is the page published as the Claude artifact. `dist/preview.html` is the same page as a full document; serve it with `node serve.mjs` (http://localhost:4310).

## Layout

- `src/data.js` – all mock data (records, connectors, analytics tickets, users)
- `src/engine.js` – deterministic search and answer composition
- `src/ui.jsx`, `src/charts.jsx` – shared components and SVG charts
- `src/search.jsx`, `similar.jsx`, `analytics.jsx`, `sources.jsx`, `saved.jsx`, `admin.jsx` – pages
- `src/App.jsx` – shell, navigation and app-level state
