# 4ttp – Tech Stack

## Stack Overview
- Engine: Phaser 3 (Arcade Physics by default; optional Matter.js)
- Language: TypeScript
- Build: Vite
- Runtime: Node.js 20
- UI: Phaser UI + minimal HTML/CSS overlay (no heavy UI framework)
- Audio: Web Audio API (optional Howler.js)
- Assets: pre-generated SFX/voice (ElevenLabs), lightweight sprites/particles
- Hosting: Itch.io (HTML5, no login/download)
- Repo: GitHub

## Why this stack
- Lightweight and instant-loading for browser judges
- Fast iteration and tiny bundles (Vite)
- Strong 2D feature set (Phaser groups, collisions, particles, tweens)
- Clean rulesets with TypeScript types for factions/dominance matrix
- Exportable as a single static build (`dist/`) for Itch.io

## Version targets
- Node 20.x
- Vite ^5
- TypeScript ^5
- Phaser ^3.8x
- Optional: howler ^2, zod ^3 (config validation)

## Project layout
```
/src
  /assets
    /sprites
    /sfx
    /voice
  /core
    config.ts
    factions.ts
    rules.ts
    types.ts
  /scenes
    Boot.ts
    Game.ts
    UI.ts
  /systems
    collisions.ts
    interventions.ts
    balanceMeter.ts
  /utils
    rng.ts
    fx.ts
index.html
main.ts
vite.config.ts
```

## Key modules
- `core/factions.ts`: faction registry (id, name, color, sfx keys)
- `core/rules.ts`: dominance matrix and helpers (`beats(a,b)`)
- `systems/interventions.ts`: spawn, buff, slow, nuke, shield; cooldowns
- `systems/balanceMeter.ts`: counts, weakest/strongest, equilibrium %
- `scenes/Game.ts`: simulation loop, spawners, collisions, scoring
- `scenes/UI.ts`: HUD, cooldowns, score, mode switch, achievements
- `utils/rng.ts`: seeded randomness for repeatable runs
- `utils/fx.ts`: particles, tween flashes, screen feedback

## Dependencies
```
npm i phaser
npm i -D typescript vite @types/node
# optional
npm i howler
npm i -D zod
```

## NPM scripts
```json
{
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview --host",
    "typecheck": "tsc --noEmit"
  }
}
```

## Vite config basics (`vite.config.ts`)
- Set `base: './'` so relative paths work on Itch.io
- Ensure assets inline/small and chunk count minimal
- Optionally define `process.env.NODE_ENV` for Phaser

## Coding standards
- TS-first (no `any` in core/systems)
- Deterministic game state where possible (seeded RNG)
- No blocking dialogs; all UI in-canvas or overlay
- Separate sim logic from rendering for clarity

## Performance notes
- Use Arcade Physics for simple interactions (fast)
- Cap entities (e.g., 400–800) and use pooling
- Prefer sprite tinting over many textures
- Batch SFX, avoid overlapping long tails
- Avoid large AI assets; keep voice lines short (≤3s)

## Asset pipeline
- Voice: pre-generate short MP3 lines with ElevenLabs (menu, spawn, collapse, victory, balance-restored)
- SFX: tiny one-shots per faction + conversion combo
- Visuals: small sprites/particles; consider procedural glows
- Compression: MP3/OGG for audio, PNG/WebP for images

## Data and saves
- LocalStorage for:
  - best scores per mode
  - unlocked factions
  - earned achievements
  - muted audio prefs
- Simple JSON schema; validate with zod (optional)

## Accessibility
- Colorblind-friendly palette toggles (alt tints/patterns)
- Volume sliders + mute, screen shake toggle
- Minimal text; tooltips for abilities
- Keyboard and mouse support (1–5 ability keys, R restart, Space pause)

## Testing
- Manual playtest checklist (entity caps, mode end states, cooldowns)
- Deterministic seeds to repro outcomes
- Basic CI: `typecheck` + `vite build` on push

## Deployment (Itch.io)
1) `npm run build` ⇒ produces `dist/`
2) Zip contents of `dist/` (not the folder)
3) Itch project → “This file will be played in the browser”
4) Set viewport to 100% or fixed (e.g., 1280×720), enable fullscreen
5) Add “Tools Used: ElevenLabs (voice), Itch.io (hosting)”

## Sponsor/Chroma alignment
- Include Chroma logo in splash or credits
- Description includes www.ChromaAwards.com
- “Tools Used” list (ElevenLabs, Itch.io, optional FAL/Dreamina)
- No login, no download, single-player mode included

## AI integration plan
- Phase 1: pre-generated ElevenLabs voice lines (no runtime calls)
- Phase 2 (optional): dynamic text “prophecies” via lightweight on-device templating (no API)
- Phase 3 (optional, if permitted): remote text gen with strict rate limits and no auth required to play

## Security & permissions
- Only original or licensed assets
- Credit any third-party fonts/textures if used
- No external trackers; optional privacy-friendly analytics disabled by default

## Roadmap toggles
- MVP: 3 factions, Spawn + Slow, Balance/Domination modes, scoring, end logs
- +Tier 2: Growth, Decay; add Buff, Shield
- +Tier 3: Void, Light; add Nuke; achievements; prophecy variants
