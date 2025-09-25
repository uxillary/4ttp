# 4ttp

Seeded Phaser 3 prototype for the Four-Tier Temporal Protocol.

## Controls

- Mouse / `1`: Spawn weakest faction at the cursor
- `2`: Slow the strongest faction (5s, 0.75x speed)
- `3`: Buff the weakest faction (5s, 1.25x speed)
- `4`: Shield the weakest faction (3s invulnerable)
- `5`: Nuke the nearest six units within 80px
- `Tab`: Toggle Balance / Domination mode
- `Space`: Pause / resume simulation
- `R`: Restart (hold `Shift+R` to roll a new seed)
- `M`: Toggle mute
- `C`: Toggle colorblind palette
- `H`: Toggle HUD visibility

## Modes

- **Balance** - keep all factions alive as long as possible.
- **Domination** - push any faction to 100% of the population swiftly.

## Abilities

All abilities share seeded cooldowns: Spawn (0.5s), Slow (8s), Buff (8s), Shield (10s), Nuke (12s). Visual FX pulse, haze, shield, and bursts give immediate feedback, and the HUD lists live cooldowns.

## Settings & Persistence

LocalStorage keeps `best.balance`, `best.domination`, `muted`, `colorblind`, and `seed`. Seeds can be regenerated with `Shift+R` and are reused for deterministic runs.

## Build & Deploy

```bash
npm install
npm run typecheck
npm run build
```

The production bundle lands in `dist/`. Zip the **contents** of that folder (not the folder itself) for itch.io, then follow the checklist in `DEPLOYING.md`.

## Elemental Icon Assets

Single-color SVGs that match the techno-element vibe live in `src/assets/icons`:

- `fire-thermal-protocol.svg` – flame profile with protocol nodes for fiery abilities.
- `water-liquid-node.svg` – droplet silhouette with lattice nodes for support/flow skills.
- `earth-core-process.svg` – strata badge with a central core for defensive effects.
- `shape-triangle-surge.svg` – angular surge glyph echoing the Fire faction entity profile.
- `shape-circle-orbit.svg` – orbital ring motif mirroring the Water faction entity silhouette.
- `shape-hex-lattice.svg` – layered lattice hex emblem representing the Earth faction entity.

Each icon is built with rounded strokes, scales crisply from 24–128px, and respects `currentColor`. Adjust stroke weight with the `--sw` CSS variable (defaults to `6`).

```css
.protocol-icon {
  width: 48px;
  height: 48px;
  color: #55e6a5; /* example brand */
}

.protocol-icon svg {
  width: 100%;
  height: 100%;
  --sw: 5;
}

/* Optional motion hooks */
#icon-fire-thermal { filter: drop-shadow(0 0 2px currentColor); animation: flicker 0.28s infinite steps(2, end); }
#icon-water-liquid circle { animation: pulse 1.6s ease-in-out infinite; }
.hit #icon-earth-core { animation: wiggle 0.18s linear 1; }
```
