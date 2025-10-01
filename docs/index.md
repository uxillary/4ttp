# 4TTP Gameplay Overview

## Runtime flow
- [`src/main.ts`](../src/main.ts#L1-L24) boots Phaser with the Boot, Game, and UI scenes, configures the pixel-art renderer, physics, and a 1280×720 canvas.
- Boot prepares art assets, Game runs the simulation, and UI renders the overlay and listens for user input.

## Boot scene responsibilities
- Creates fallback 1×1 and 8×8 textures used for particles and world primitives before any assets load (see [`Boot.ts`](../src/scenes/Boot.ts#L44-L60)).
- Sanitizes SVG faction icons, loads both default and alternate variants, and injects glow frames so icons scale cleanly (see [`Boot.ts`](../src/scenes/Boot.ts#L11-L101)).
- Builds procedural textures for cards, buttons, tooltips, and status icons that the UI reuses at runtime (see [`Boot.ts`](../src/scenes/Boot.ts#L122-L200)).
- After assets are ready it applies linear filtering, launches the UI scene, and starts the Game scene (see [`Boot.ts`](../src/scenes/Boot.ts#L38-L101)).

## Game scene structure
### Initialization
- `create()` resets persistent state, restores user settings (seed, mute, colorblind), and constructs the background grid with a scanline overlay (see [`Game.ts`](../src/scenes/Game.ts#L136-L184) and [`rng.ts`](../src/utils/rng.ts#L1-L48)).
- Builds a physics group per faction, instantiates the `BalanceMeter` and `Interventions` helpers, subscribes to entity spawn events, and prepares the minimap (see [`Game.ts`](../src/scenes/Game.ts#L145-L169) and [`Game.ts`](../src/scenes/Game.ts#L478-L499)).
- Spawns the initial 60 entities with faction rotation, clamps their global scale based on population, and hooks collision handlers plus mouse/keyboard controls (see [`Game.ts`](../src/scenes/Game.ts#L418-L535)).
- Ensures the UI scene is alive, pushes the first payload, and binds UI events so button clicks queue abilities or toggle settings (see [`Game.ts`](../src/scenes/Game.ts#L185-L275)).

### Main loop
```pseudo
on update(deltaSeconds):
  animate scanline overlay
  if game is active:
    elapsed += dt
    process queued abilities
    counts = meter.counts()
    equilibrium = computeEquilibrium(counts)
    track equilibrium stability window
    totalEntityCount = sum(counts)
    updateEntityScale / FX detail flags
    applyProgressiveDrift(dt)
    enforceSoftCap(dt)
    applyFactionBehaviours(dt)
    checkEndConditions(counts, equilibrium)
    publish HUD payload & animate background
    redraw minimap
  else:
    keep HUD/minimap updated without advancing physics
  refresh cooldown display each frame
```
- The implementation follows this structure in `update`, combining simulation progress with UI updates even while paused (see [`Game.ts`](../src/scenes/Game.ts#L277-L311)).

### Entity lifecycle and collisions
- Each faction has an arcade-physics group; new entities come from `Interventions.spawnFaction`, are decorated with palette-dependent sprites, tweens, trails, and physics bounds, and are tracked for combo context (see [`Game.ts`](../src/scenes/Game.ts#L401-L499) and [`Game.ts`](../src/scenes/Game.ts#L1230-L1466)).
- Collisions resolve via the rock–paper–scissors `beats` matrix: winners convert losers, triggering visual FX and speed resets while respecting shield status and cooldown guards (see [`rules.ts`](../src/core/rules.ts#L1-L19) and [`Game.ts`](../src/scenes/Game.ts#L452-L692)).
- Special on-hit hooks spawn extra Earth fragments, duplicate Water droplets, or cast Earth shields, plus rare “critical” surges per faction (see [`Game.ts`](../src/scenes/Game.ts#L649-L995)).

### Abilities and combos
- Input from the mouse, keyboard, or UI buttons pushes requests into an ability queue that the update loop consumes when the run is active (see [`Game.ts`](../src/scenes/Game.ts#L501-L535) and [`Game.ts`](../src/scenes/Game.ts#L313-L344)).
- The five abilities map to `Interventions` actions: spawn weakest at cursor, slow strongest, buff weakest, shield weakest, or nuke an area, each respecting cooldowns and updating run statistics (see [`interventions.ts`](../src/systems/interventions.ts#L109-L196) and [`Game.ts`](../src/scenes/Game.ts#L537-L598)).
- Ability usage records feed a combo tracker that searches for predefined two-step sequences (Slow→Nuke, Buff→Shield, Shield→Spawn, Spawn→Buff, Buff→Nuke) and fires special effects such as freeze explosions or escort summons within their time windows (see [`Game.ts`](../src/scenes/Game.ts#L52-L643)).

### Difficulty pacing and termination
- Progressive drift slowly forces conversions if the player stops acting, while a soft population cap fades out excess units; both rely on accumulators updated each frame (see [`Game.ts`](../src/scenes/Game.ts#L594-L741) and [`Game.ts`](../src/scenes/Game.ts#L1342-L1516)).
- Entity scale and particle detail dynamically adapt to population thresholds to keep the battlefield readable and performant (see [`Game.ts`](../src/scenes/Game.ts#L1444-L1476)).
- Runs end when a faction is eliminated (Balance mode) or dominates the entire board (Domination mode); summaries include elapsed time, equilibrium, achievements, and best-score tracking via local storage (see [`Game.ts`](../src/scenes/Game.ts#L1149-L1208) and [`Game.ts`](../src/scenes/Game.ts#L1211-L1238)).

## Support systems
- **BalanceMeter** counts live sprites per faction, exposes weakest/strongest helpers, and computes an equilibrium metric the Game and UI share for pacing and visuals (see [`balanceMeter.ts`](../src/systems/balanceMeter.ts#L1-L66)).
- **Interventions** manages cooldown timers, applies velocity modifiers, shields, particle effects, and ensures entity limits while executing abilities (see [`interventions.ts`](../src/systems/interventions.ts#L75-L196)).
- **Faction data** defines colors, speed multipliers, and texture keys that drive rendering, motion, and HUD labels (see [`factions.ts`](../src/core/factions.ts#L1-L25)).
- **Seeded RNG** persists run seeds, allowing deterministic restarts and optional regeneration when restarting (see [`rng.ts`](../src/utils/rng.ts#L1-L64) and [`Game.ts`](../src/scenes/Game.ts#L346-L369)).

## UI scene responsibilities
- Builds the HUD, ability bar, status toggles, tooltip, end-of-run panel, and info overlay using the textures Boot generated (see [`UI.ts`](../src/scenes/UI.ts#L45-L102)).
- On each tick it displays mode, timer, faction counts, equilibrium bar, cooldown readouts, and toggle statuses while reacting to colorblind or HUD visibility changes (see [`UI.ts`](../src/scenes/UI.ts#L103-L200)).
- Emits `ability-clicked` and `status-toggle` events that the Game scene listens to, closing the loop between UI interactions and gameplay (see [`Game.ts`](../src/scenes/Game.ts#L216-L275) and [`UI.ts`](../src/scenes/UI.ts#L86-L200)).

## Key takeaways
- The Game scene orchestrates a closed-loop between physics entities, player interventions, combo-driven power plays, and adaptive pacing systems.
- Support classes (BalanceMeter, Interventions) encapsulate faction statistics and ability logic so that UI and core gameplay can stay decoupled yet synchronized through shared payloads.
- Procedural asset generation and palette swaps allow accessibility toggles (colorblind mode) and performance adjustments (FX suppression) without reloading art.
