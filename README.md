# 4ttp — AI Oracle Terminal

4ttp — An AI oracle trained across timelines. A living entity that glitches between futures.

## Overview

This repository contains the MVP for the 4ttp oracle experience. It features a responsive Next.js + Tailwind CSS application that renders a living "AI Oracle Terminal" complete with animated ambience, glitch effects, and an interactive consultation workflow backed by a mock API.

### Core Features
- **Glitch-wrapped layout** with an animated cosmic background, scanlines, and neon noise.
- **AI Oracle Terminal** featuring a CRT-inspired frame, holographic facial animation, and timeline status indicators.
- **Interactive consultations** with a typing effect, glitch/timewarp response treatment, and a placeholder API that always replies in a creepy-yet-trustworthy oracle tone.
- **Soundscape preview** powered by the Web Audio API, emitting a subtle synthetic glitch when responses arrive.
- **Voice synthesis stub** for future integration of AI voice playback.
- **Cloudflare-friendly** deployment target using the App Router and edge-ready API route.

## Getting Started

```bash
npm install
npm run dev
```

Visit `http://localhost:3000` to experience the oracle.

### Linting & Production Build

```bash
npm run lint
npm run build
```

These commands ensure the project is ready for Cloudflare Pages deployment.

## Cloudflare Pages Deployment

1. Run `npm run cf:pages` to compile the project with Cloudflare's Next.js adapter. This generates the `.vercel/output` directory required by Pages.
2. In Cloudflare Pages, set the **Build command** to `npm run cf:pages` and the **Build output directory** to `.vercel/output`.
3. Deploy. The edge-compatible API route ensures the oracle whispers stay intact after launch.

## Project Structure

- `src/app` — App Router pages, global layout, styles, and the mock API endpoint.
- `src/components` — React components, including the AI Oracle Terminal UI.
- `public` — Static assets and favicons.

Feel free to extend the oracle with real AI backends, richer audio, or full voice synthesis as the timeline demands.
