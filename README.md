# Dundee News

A fun and vibrant single-page news app for the Dundee area, built with TypeScript and Vite. Displays 5 random articles from the past 24 hours pulled from multiple local and national sources.

![Dundee News screenshot](https://via.placeholder.com/1200x600/080d1a/FFB703?text=Dundee+News+%C2%B7+City+of+Discovery)

## Features

- Live news from multiple sources: The Guardian, BBC Scotland, The Courier, and Dundee Live
- 5 random articles shuffled from the past 24 hours (falls back to 7 days if fewer are available)
- Animated gradient header, floating particles, shimmer skeleton loaders
- Per-source colour-coded cards with hover effects
- Shuffle button to fetch a fresh random selection
- Fully responsive — works on mobile and desktop

## Tech stack

- [Vite](https://vitejs.dev/) — dev server and bundler
- TypeScript (strict mode)
- Vanilla CSS — no UI framework
- [The Guardian Open Platform API](https://open-platform.theguardian.com/)
- [rss2json](https://rss2json.com/) — RSS-to-JSON proxy for BBC Scotland, The Courier, and Dundee Live

## Getting started

### Prerequisites

- Node.js 18+
- npm 9+

### Install dependencies

```bash
npm install
```

### Run the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser. The app will hot-reload on file changes.

### Build for production

```bash
npm run build
```

Output goes to `dist/`. Preview the production build locally with:

```bash
npm run preview
```

## News sources

| Source | Type | Coverage |
|--------|------|----------|
| The Guardian | REST API (`test` key) | National coverage mentioning Dundee |
| BBC Scotland | RSS via rss2json | Scottish news filtered for Dundee/Tayside |
| The Courier | RSS via rss2json | Primary Dundee local newspaper |
| Dundee Live | RSS via rss2json | Dundee-specific news site |

> **Note:** The Guardian API uses the public `test` key which is rate-limited. For higher volume usage, [register for a free API key](https://bonobo.capi.gutools.co.uk/register/developer) and replace `'test'` in `src/newsService.ts`.

## Project structure

```
dundee-news/
├── index.html          # HTML shell
├── src/
│   ├── main.ts         # Entry point — wires UI and data together
│   ├── newsService.ts  # Multi-source fetching, dedup, shuffle logic
│   ├── ui.ts           # Card, skeleton, error rendering
│   ├── types.ts        # TypeScript interfaces
│   └── style.css       # All styles and animations
├── package.json
├── tsconfig.json
└── vite.config.ts
```

## License

MIT
