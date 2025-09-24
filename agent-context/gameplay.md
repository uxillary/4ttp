# 4ttp – Gameplay & Systems

## Core Loop

1. **Initialization**
   - Player selects mode (Balance or Domination).
   - Simulation grid loads with 3 starting factions (Fire/Thermal, Water/Liquid, Earth/Core).
   - Entities move autonomously within the bounded grid.

2. **Play Phase**
   - Entities interact based on dominance rules (see `factions.md`).
   - Player can intervene with abilities (see below).
   - Additional factions unlock as the game progresses (Growth, Decay, Void, Light).

3. **Resolution**
   - Game ends when:
     - Balance Mode: a faction is completely wiped out.
     - Domination Mode: one faction has fully converted all others.
   - Score + Achievements displayed.
   - End screen shows generated prophecy/logs.

---

## Player Interventions

Players are not passive observers; they influence the ecosystem with active abilities. Each ability has a cooldown or cost to prevent spam.

- **Spawn Entity**: Add one new agent of the chosen faction at cursor location.  
- **Buff**: Temporarily boost a faction’s speed/strength.  
- **Slow**: Temporarily weaken or slow down the dominant faction.  
- **Nuke**: Destroy a small cluster of entities.  
- **Shield**: Temporarily protect the weakest faction from conversion.  

Design Note: Abilities can be unlocked gradually across sessions for progression.

---

## Scoring System

- **Balance Mode**
  - Score = time all factions survive simultaneously.
  - Bonus points for stabilizing after major collapses.
  - Achievements for reaching survival thresholds (e.g. 3 min, 5 min, 10 min).

- **Domination Mode**
  - Score = speed and efficiency of wiping out all other factions.
  - Bonus for dominating without using nukes or with minimal interventions.
  - Achievements for specific victory conditions (e.g. “Water Dominates in <2 min”).

---

## Achievements

Achievements act as both progression and flavor, presented as “system logs.”

Examples:

- `[LOG_01]: First Null Packet detected`  
- `[ARCHIVE]: Stability maintained for 300 seconds`  
- `[ERROR]: Entropy Agent caused total collapse`  
- `[DEBUG]: Domination achieved with only 1 intervention`  

---

## AI Integration

- **Voice Narration**: ElevenLabs generates short system-readout lines triggered by key events.  
  - Example: “Signal Pulse neutralizes Null Packet. Balance restored.”  
- **Prophecy Logs**: AI-generated text outcomes that frame the session as lore.  
  - Example: “Your interventions birthed a fragile harmony, destined to fracture again.”  
- **Optional Visuals**: AI art backgrounds or evolving textures for factions.  
- **Sound Design**: Distinct SFX layers per faction, plus ambient tracks that shift with balance/chaos states.

---

## Presentation & Style

- **Grid Environment**: Neon simulation field with particle effects.  
- **Entities**: Glowing orbs with color-coded tints and faction symbols.  
- **UI**: Minimal, futuristic terminal overlay with balance meter and cooldown timers.  
- **Feedback**: Subtle screen shakes, particle bursts, and audio cues on conversions.  
- **Modes**:
  - **Balance Mode**: Calm ambient music, smooth visuals.  
  - **Domination Mode**: Intense synth escalation, more aggressive effects.  

---

## MVP Scope

- **3 factions**: Fire/Thermal, Water/Liquid, Earth/Core.  
- **Abilities**: Spawn + Slow.  
- **Score system**: Time survived (Balance), time to domination (Domination).  
- **End screen**: Displays points and 1–2 prophecy/log lines.  
- **Deployment**: HTML5 build hosted on Itch.io.  

---

## Expansion Scope

- Unlock Growth 🌱 and Decay ☠️ after early balance testing.  
- Add Void 🌑 and Light ✨ for mythic depth.  
- Expand interventions (Nuke, Shield, Buff).  
- Implement dynamic prophecy system with AI variation.  
- Achievements saved locally (cookies/localStorage).  
