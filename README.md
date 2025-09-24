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
