# Castle Defense

**Castle Defense** is a 2D strategy game made with **Cocos Creator 3.8.8** and **TypeScript**.
It mixes castle building and tower defense: between battles you grow a small castle, then
you defend its wall against endless waves of monsters. Every wave is harder than the one
before, and the game ends when the wall falls.

Video demo: https://drive.google.com/drive/folders/15IWJf0NY1LbKzWitaf19cV2dwojPjyHZ?usp=drive_link

---

## Contents
- [Gameplay](#gameplay)
- [Castle buildings](#castle-buildings)
- [Defense towers](#defense-towers)
- [Enemies and waves](#enemies-and-waves)
- [Combat rules](#combat-rules)
- [Heroes](#heroes)
- [Research](#research)
- [Active skills](#active-skills)
- [Hero skills and Energy Cores](#hero-skills-and-energy-cores)
- [Art style](#art-style)
- [Getting started](#getting-started)
- [Project architecture](#project-architecture)
- [Tools](#tools)
- [Credits](#credits)

---

## Gameplay

The game always runs in landscape. One run is a loop of two phases:

1. **Preparation.** Nothing attacks you.
   - **Inside the castle:** build, upgrade, move or destroy buildings on a large scrolling map.
   - **Outside the wall:** place, move, upgrade or destroy defense towers in the defense area behind the wall.
   - Recruit heroes, research technologies, repair the wall and save the game.
2. **Combat.** Press **Start Wave**. Monsters walk from the right towards the wall and the towers
   fire by themselves. You can pause, change the game speed (x1 / x2 / x3 / x5 / x10), change a tower's
   target mode and open its info. Building and saving are locked until the wave is over.

When every monster of the wave is dead:
- the gold from kills and the production of every building are added to your resources;
- the game saves automatically;
- the next wave is ready.

If the wall's HP reaches 0, the game is over.

**Starting resources:** 600 food, 700 material, 700 gold.

**Energy Core:** a fourth resource: the Base makes 1 per wave and bosses drop more (see [Hero skills and Energy Cores](#hero-skills-and-energy-cores)). It is shown in the top bar and cannot be traded in the Market.

**Saving:** one autosave slot (written after every wave and when the app goes to the background)
and three manual slots. Saving is only possible during preparation.

**Tutorials** (`config/guide.json`, `views/Tutorial.ts`): the first time the player opens a part of the game
(castle, battlefield, first battle, heroes, hero window, Market, skill books, research tree), notes pop up one after
the other. The part a note is about gets a red frame and the rest of the screen is dimmed; *Next* goes to the next
note, *Got it* gives the game back (the game is paused meanwhile). Which tutorials were seen is kept on the device,
not in the saves. The **Tutorials** button of the main menu and of the pause menu lists them all; *Show again* makes
them pop up again. Prefabs: `items/TutorialFrame` (dark boxes and red border, sized in code around the framed part)
and `popups/Tutorials` (Tutorials window; its topics are ButtonTemplate buttons with a "NEW" mark); each note is a
PopupTemplate (see below) without its veil.

**Guide** (`views/Guide.ts`, `config/guide.json` "stages"): the "i" button at the bottom right of the castle opens
the goals of a game by stage, in the order a good player reaches them (like the progression bot):

| Stage | Goals (priority) |
|---|---|
| Every wave | Enemy armor of the next wave: Armor / Spell Piercing (5), wall above 70% (4) |
| Before wave 30: Build the castle | Base at max level, Farms, Workshops, Research Lab (5); all towers, towers at Lv 3 (4); buildings at the Base level, Hero Scholarship, 35 technologies at max level (3); 2 heroes (2) |
| Before wave 50: Finish the research tree | Every technology above the Awakening line, Tower Awakening (5); 12 heroes, 4 Halo Spires, Smart Targeting (4); a skill for every hero (3) |
| Before wave 70: Masteries and 5-star heroes | Effect Masteries (5); 5-star heroes, rest of the tree (4); every skill slot (3); endless research Lv 20 (2) |
| Before wave 90: Endless research | Masterwork Ammunition Lv 50 (5), Living Stone Lv 50 (4) |
| After wave 90 | Masterwork Ammunition Lv 70 (5), Living Stone Lv 70 (4) |

The priority 1-5 is shown as stars (5 = do it first). The current stage is marked *now*; when all its goals are
reached early, the next stage becomes the current one. Unfinished goals of a past stage move to the current stage,
marked *late*. Reached goals are greyed out with a tick; a red dot marks the goals of the current and past stages
that can be done right now (not the future ones), and the castle button gets a red dot when there is at least one.
The window is a PopupTemplate (see below); prefabs `items/GuideStage` (stage title), `items/GuideRow` (one goal,
with its stars) and `items/GuideButton` (castle button). Stages, goals and priorities are tuned in guide.json.

**Popup and button templates**: `prefabs/popups/PopupTemplate` (`views/common/PopupTemplate.ts`) is the one prefab of
every simple popup (confirm, message, info windows, wave statistics, learn a skill, the build menus, the tutorial
notes, the Guide). It has the popup frame, the title scroll, a text (`Body`), a free area for content made in code
(`Content`) and a button bar; `openPopup(parent, { title, body, width, height, veil, buttons: [{ text, color, width,
onClick, keepOpen }] })` sets the texts and adds the buttons side by side, centered. `prefabs/items/ButtonTemplate`
(`views/common/ButtonTemplate.ts`) is the one text button of the items: popup buttons, save slot Load / X buttons,
build row Build buttons (the item prefabs keep an empty slot node: `slotButton(slot, text, options)`), the Build Tower
button and the skill book price buttons (`costButton`: text over a cost row), the Tutorials topics
(`templateButton(parent, text, { color, width, height, fontSize, onClick })`). The popups with their own layout
(Pause, Settings, Save / Load, Hero window, research tree, New Hero, Tutorials) keep their prefab.

---

## Castle buildings

Buildings are placed freely inside the castle's build area. They do not snap to a grid and
cannot overlap. Every building has 3 levels, and the Base level limits everything else.
Destroying a building refunds 50% of its build cost.

| Building | Produces after each wave (Lv 1 / 2 / 3) | Limit | Notes |
|---|---|---|---|
| **Base** | 120 / 250 / 900 gold | 1 (fixed in the centre) | Raises the tower limit (10 / 20 / 36), the hero limit (3 / 7 / 12), the number of other buildings and the max tower level. Upgrade: 900 gold + 500 material + 400 food, then 4000 gold + 6000 material + 6000 food. |
| **Farm** | 95 / 150 / 495 food | 5 per Base level | Build: 60 gold + 100 material |
| **Lumber & Quarry** | 115 / 180 / 480 material | 5 per Base level | Build: 80 gold + 80 food |
| **Research Lab** | nothing | 1 | Opens the research tree. Lab Lv 1 / 2 / 3 opens tier 1 / 2 / 3 of the tree (see [Research](#research)). |

---

## Defense towers

There are four towers, and each has 3 levels: three attack towers and the Halo Spire, a support tower.
- **Building:** outside, the *Build Tower* button (it also shows towers built / tower limit) opens the list of
  towers with their cost, like the Build button inside the castle; pick one, then tap a free spot.
- **Placement:** towers stand in the defense area and keep a minimum distance from each other.
- **Aiming:** each tower has a rotating weapon that turns to face its target before it fires.
- **Level cap:** a tower can never have a higher level than the Base.

| | **Crossbow** | **Crystal** | **Catapult** |
|---|---|---|---|
| Role | Fast single target | Magic area damage | Slow long-range siege |
| Damage type | Physical | Magic | Physical or magic, whichever hurts more |
| Build cost | 100 gold, 40 material | 140 gold, 60 material | 240 gold, 120 material |
| Damage (Lv 1 / 2 / 3) | 90 / 170 / 240 | 90 / 180 / 360 | 70 / 150 / 550 |
| Attacks per second | 0.75 / 1.5 / 3 | 0.375 / 0.75 / 1.5 | 0.25 / 0.5 / 1 |
| Range (px) | 384 / 461 / 553 | 384 / 461 / 553 | 600 / 750 / 900 |
| Explosion radius (px) | 20 (fixed) | 40 / 60 / 80 | 70 / 95 / 120 |
| Crit rate / crit damage | 5–25% / 175–250% | 5–25% / 175–225% | 10–40% / 200–300% |

From Lv 2 the Catapult throws its 2 loaded stones together: they fly side by side and land as one hit (same damage).
The Crossbow is strong early on. The Catapult starts weak but becomes the main damage dealer late in the game.

**Halo Spire** (support, tower.json `"halo"`, kind `"halo"`): it has no target and deals no damage. It must be
unlocked first (research *Halo Spire*, Fortification tier 3, needs Self-Mending Stone and Masonry Guild at max
level). While enemies are on the field it activates regularly; without a shield, an activation raises a magic
**shield** around the spire:

| | Lv 1 | Lv 2 | Lv 3 |
|---|---|---|---|
| Build / upgrade cost | 300 gold, 200 material, 100 food | 420 gold, 500 material, 320 food | 2600 gold, 2900 material, 2200 food |
| Activations per second | 0.8 | 1.0 | 1.25 |
| Shield radius (px, fixed: range research and buffs never change it) | 200 | 200 | 200 |
| Shield HP (% of the wall max HP; *Warding Halo* Lv 0 / 4) | 20% / 60% | 40% / 80% | 60% / 100% |
| Shield defense (% of the wall defense, 90 at most; *Warding Halo* Lv 0 / 4) | 20% / 60% | 40% / 80% | 60% / 100% |
| Towers buffed (*Empowering Halo*) | 2 | 4 | 8 |
| Wall mending (*Mending Halo*) | every 30 activations, 0.5% of the missing HP | every 20, 1% | every 10, 2% |

- **Shield** (always): an enemy projectile (Flying Demon fireball, Lich Soul Bolt: boss ones too) that reaches the
  bubble is stopped there. Its damage, minus the shield defense, comes off the shield HP (blue number). At 0 HP
  the shield breaks ("collapse" animation; that projectile is still stopped) and stays down until the next wave;
  the spire still buffs the nearby towers and mends the wall. Enemies on foot are not stopped. The shields go down when a wave ends; the Info
  window of the spire shows its shield HP now.
- **Warding Halo** (research under *Halo Spire*, 4 levels): +10% of the wall HP and +10% of the wall defense for
  every shield per level. *Empowering Halo* and *Mending Halo* are under it.
- **Empowering Halo** (research under *Warding Halo*, 5 levels): the closest other towers (not Halo Spires) get
  +6% base damage and +4% base attack speed per level. The base is the tower level value plus the flat research
  and hero bonuses; the % buffs come after. A tower near several spires keeps the strongest buff (no stacking). Their Info window shows it.
  Four Lv 3 spires are enough for a full field: each sits in the middle of 8 towers (4 + 4 × 8 = 36).
- **Mending Halo** (research under *Warding Halo*): every N activations the spire restores a share of the missing
  wall HP. Time between two mends = activations needed / activations per second (the spire's attack speed, flat
  and % research included): at the base speed Lv 1 30 / 0.65 = 46 s, Lv 2 20 / 0.8 = 25 s, Lv 3 10 / 1 = 10 s.
  The spire's Info window and the research node show the time with the current buffs. Several spires mend one
  after the other (each one from what the previous one left), so it does not add up to more than the missing HP.
  **Out of combat**, after each wave, every spire also restores 5% / 10% / 15% (Lv 1 / 2 / 3) of the wall **max**
  HP (tower.json `"mendAfterWavePct"`): four Lv 3 spires give back 60% of it.
- The crystal of the spire stays idle and flashes only when its shield is hit.
- The shield sheets (`art/halo/shield_loop.png`, `shield_collapse.png`, atlas `sprites/atlas/halo`)
  are scaled so the bubble fits the shield radius (tower.json `"shield"`: `ringRadius`). Only the right 2/5 of the
  bubble is kept (the side the projectiles come from; the rest covered the towers): it is drawn and it blocks. They play
  slowly (0.27 s / 0.21 s per frame) and in real time: the game speed (x2..x10) does not make the shields flicker
  faster. A broken shield's collapse is only a picture (the game does not wait for it).

**Target modes** (switch with the *Target* button of a selected tower):
- **First:** the enemy closest to the wall.
- **Lowest HP**, **Highest HP**, **Nearest** (to the tower).
- **Smart:** unlocked by research. The tower picks the target where its damage is most useful.
  - Area towers aim at groups. The Catapult also goes for the boss, more and more as it gets close to the wall
    (`"smartBossBonus"` in `tower.json`).
  - Shots never waste damage on an enemy that is already going to die.
  - Enemies near the wall get priority.
  - A Crossbow with Smart mode hits the Flying Demons first when no standing Halo Spire shield covers their lane
    (their fireballs would hit the wall), otherwise the enemy closest to the wall.

**No wasted shots:**
- Every shot reserves its expected damage (no crit) on its target; an area shot (Crystal, Catapult) also reserves it
  on the enemies close around the target, which its explosion will most likely hit.
- In every target mode, the Crossbow and the Crystal (`"avoidOverkill": true` in `tower.json`) skip an enemy once the
  shots already flying at it are enough to kill it, and fire at the next enemy right away.
- If the target still dies before a shot lands (a crit, another tower, bleeding), the shot flies on to the nearest
  living enemy that is not already doomed (or, when all are, to the nearest one).

### Special effects
Every tower has three special effects. An effect does nothing until its **Unlock** technology is researched
(Tower Effects branch, Research Lab Lv 2). Its chance then comes from two rate technologies: +5% per level,
5 levels in tier 2 and 5 more in tier 3, up to 50%.
*Arcane Mastery*, the three tower *Attunements* (Crossbow / Crystal / Catapult Attunement, tier 3, under Arcane Mastery, 5 levels:
+5% per level for that tower) and hero effect-chance buffs add their points on top of every unlocked effect,
above the 50% limit (100% at most): 50% + 25% (Arcane Mastery) + 25% (Attunement) = 100%.

**Effect level and Mastery.** The levels of the two rate technologies are also the effect's **level (1-10)**:
every level adds flat damage or makes the debuff stronger. The damage parts based on HP (max HP, current HP),
longer debuffs and more stacks come from the **Mastery** technology (tier 3, 3 levels, under *Tower Awakening*);
Mastery 3 gives the full effect. Flat damage is multiplied by the tower level (x1 / x1.5 / x2), goes
through defense and never crits; the effect-chance research applies, the tower damage % does not.
Numbers: `effects.json` "effectScaling" and the `"scaling"` of each effect.
The tower's *Info* window lists its three effects with their current chance and what they do at their level.

| Tower | Effect | Level 1 to 10 | Mastery 1 / 2 / 3 |
|---|---|---|---|
| Crossbow | Piercing Bolt | 2 more enemies, 20 to 200 damage | 3 enemies, 50% of the hit / 4 enemies, 75% / 100% |
| Crossbow | Bleeding Bolt | 8 to 80 damage per second per stack, 3 stacks, 3 s | 5 stacks, 4 s / +20% of the hit / bursts at 5 stacks (4% max HP) |
| Crossbow | Hunter's Mark | +1.5% to +15% Crossbow damage, 1 stack, 2 s | 2 stacks, 3 s, +20% per stack / 4 stacks, 4 s, +35% / 6 stacks, 5 s, +50% |
| Crystal | Frost Explosion | Slow 10% to 25%, 1.5 s | 2 s / 2.5 s / slow 35% |
| Crystal | Chain Lightning | 2 jumps, 15 to 150 damage | 3 jumps, 40% of the hit / 4 jumps, 60% / 5 jumps, 80% |
| Crystal | Arcane Vulnerability | +1% to +8% magic damage, 1 stack, 3 s (not on Chain Lightning targets) | 2 stacks, 3 s, +10% per stack / 3 stacks, 4 s, +20% / 4 stacks, 4 s, +30% |
| Catapult | Shockwave | 15 to 150 damage, 0.1 s stun | 0.3 s stun / 2% max HP when immune to stun / 4% |
| Catapult | Heavy Impact | +8 to +80 damage | +100 or 1% max HP / +200 or 2% / +300 or 3% (at most 3 hits, bosses 30%) |
| Catapult | Armor Break | -2 to -12 defense, 2 s | 3 s / 4 s / -20 defense |

Where a Mastery level gives a share of the hit, the effect uses that share or the flat damage, whichever is bigger.

Three effects have one more technology under their Mastery (5 levels, `effects.json` scaling `"plus"`, buff
`effectPlus:<effect>`):

| Technology | Effect | Level 1 / 2 / 3 / 4 / 5 |
|---|---|---|
| Hunter's Instinct | Hunter's Mark | at full stacks every Crossbow hit also deals 0.3 / 0.6 / 0.9 / 1.2 / 1.5% of the current HP |
| Arcane Conduit | Arcane Vulnerability | also applies to the first 1 / 2 / 3 / 4 / 5 Chain Lightning targets; jumps deal +10 / 15 / 25 / 30 / 40% |
| Crushing Weight | Heavy Impact | at most 4 / 5 / 6 / 7 / 8 hits; bosses take 40 / 55 / 70 / 85 / 100% |

---

## Enemies and waves

| Enemy | Role | HP | Wall damage | Speed | Phys / Magic def | Gold |
|---|---|---|---|---|---|---|
| **Scorpion** (Berserker) | Hits the wall hard | 97.5 | 55 physical | 40 | 5 / 8 | 10 |
| **Firebug** (Runner) | Very fast, fragile | 60 | 15 magic | 85 | 3 / 3 | 8 |
| **Clampbeetle** (Tank) | High HP and physical defense, resists stun | 240 | 25 physical | 25 | 20 / 5 | 12 |
| **Magma Crab** (Juggernaut) | Slow, tough, resists stun and slow | 210 | 50 magic | 20 (boss ×0.5) | 15 / 15 | 25 |
| **Flying Demon** (Caster) | Flies, fast, attacks from range (a fireball every 1.3 s) | 70 | 6 magic per fireball | 68 | 6 / 22 | 14 |
| **Lich King** (boss from wave 50) | Floats, very slow, Soul Bolt from anywhere, spells below 30% HP | 450 (x4 as boss) | 40 magic per Soul Bolt (x2) | 5 | 25 / 25 | 30 (x8) |

Values are for wave 1. All stats grow with the wave number.

**Flying enemies** (enemy.json `"flying"`): towers with `"hitsFlying": false` in tower.json (the Catapult) never aim
at them, and their explosions pass under them. Crossbows, Crystals and hero skills hit them normally.

**Lich King** (boss from wave 50; enemy.json `"lich"`): it floats a little above the ground but is not a flying
enemy (Catapult stones hit it). It is half size at wave 50 and grows at every boss wave after it (+0.1, up to 1.2;
waves.json `bossRule.byWave` "scale", "scaleGrowth", "maxScale"). It moves very slowly and walks to the wall like
the other bosses (it hits the wall when it gets there), but:
- **Soul Bolt** every 5 s (first after 3 s), from anywhere on the field: the bolt always reaches the wall
  (enemy.json `"ranged"."anyRange"`).
- **Teleport** every 30 s (first after 5 s): it vanishes and appears 150 px closer to the wall.
- Below **30% HP**, once each (enemy.json spell `"hpBelowPct"`), the boss stops and casts:
  - **Spell shield**: a frost burst at its feet, then a magic shield that absorbs damage equal to 20% of its max HP
    for 12 s (light blue damage numbers, light blue HP bar). When it breaks or ends it collapses with dust.
  - **Summoning circle** (right after the shield): a circle at its feet, 4 minions (Firebug, Scorpion,
    Clampbeetle or Flying Demon, with the stats of the wave and half gold) appear around it, and every enemy
    within 280 px (the minions too) moves 40% faster for 6 s.
A stun pauses its casting.

**Ranged enemies** (enemy.json `"ranged"`): the Flying Demon stops about 640 px in front of the wall (560 to 720 px, so
the front Crossbows / Crystals with range research reach it) and attacks every 1.3 s: attack animation, then a fireball flies to the wall and deals the
enemy's damage there (wall defense, Barrier Block, Last Stand and Bulwark apply as for a contact hit). Unlike the
other enemies it does not die on the wall: it keeps attacking until it is killed, so the wave only ends when it is
dead. A stun stops its attacks; a knockback (Air Burst) pushes it back and it flies in again. While it has no sound
files of its own, it uses the Firebug death sound and the Catapult shot sound (enemy.json `"sfx"`).

**How waves scale:**
- **Enemy count:** starts at 24 and grows by 2 every wave. A new enemy every 0.18 s (0.15 s at least): the field
  outside the wall is long (worldWidth 2350 px), so the waves arrive as a stream.
- **Stats:** HP follows a curve tuned by segments (`waves.json` "hpCurve", written by `tools/balance/set_curve.py`):
  about ×2 at wave 1, ×12 at 10, ×200 at 20, ×1,100 at 30, ×2,000 at 40, ×3,300 at 50, ×13,500 at 70 and
  ×55,000 at 70, ×74,000 at 100 and ×82,000 at 120, with the *final damage reduction* (below, 70% at most) on top. Damage (×1.1), speed and gold grow every 3 waves.
- **Damage boost** (`waves.json` "damageBoost"): from wave 30 the damage of the walking enemies (not the Flying
  Demons and the Lich, who keep shooting while they live) is multiplied once more, ×1.5 at
  wave 55, ×2.5 at wave 100 and ×3.5 from wave 130 (linear in between): late enemies that reach the wall hurt.
- **Wall hit cap** (`waves.json` "wallHitCap"): one hit, after the wall defense, takes at most 2% of the wall max HP
  (Flying Demon fireballs 1.5%, mutants 4%, Lich Soul Bolts 5%, a boss reaching the wall 25%), so a handful of enemies cannot bring the wall down on their own.
- **Mutants** (`waves.json` "mutants"): from wave 5, about 4% of the walking enemies (not bosses, not Flying
  Demons) are mutants: bigger (×1.35) and tinted red. For now there is one kind, the **Swift Mutant**: ×2.6 speed,
  ×6 HP, ×2 damage, ×4 gold. They are the main source of wall damage: tough and fast, some of them get through, but
  their hits are small (4% at most each).
- **Enemy types:**

  | Waves | Enemies |
  |---|---|
  | 1–3 | Scorpions and Firebugs |
  | from 4 | Clampbeetles join |
  | from 7 | Magma Crabs join |
  | from 50 | Flying Demons join (about 1/6 of the wave; they attack the wall from range) |

- **Wave 5, "Swarm":** a special wave with many weak Firebugs and Scorpions.
- **Bosses:** every 10th wave adds a giant Magma Crab boss with ×4 HP, ×3 damage and ×8 gold. From wave 50 the
  boss is the **Lich King** instead (×4 HP, ×2 damage, ×8 gold; waves.json `bossRule.byWave`).
- **Milestones:** waves 10, 30 and 70 are sieges with more enemies and extra bosses.
  - Wave 10: **Siege**
  - Wave 30: **Great Siege**
  - Wave 70: **Doom Siege**
- **Enemy armour:**
  - From wave 12, enemy defense rises by 5 every 3 waves, up to 70 (bosses up to 90): Armor / Spell Piercing I, II
    and III (Research Lab Lv 1 / 2 / 3) are needed to keep up.
  - The *Enemy armor* tab in the top left corner of the battlefield (and the castle Guide) shows how much Armor / Spell Piercing the next wave needs
    compared with what you have.
- **Status limits** (so enemies are never stunned or slowed without a break):
  - After a Stun, an enemy cannot be stunned again for the stun time + 0.5 s (`"immunityAfter"` in `effects.json`).
  - From wave 60, enemies resist stun, slow, bleed, marks and armor break: +2.3% per wave, 70% from wave 90; bosses
    get +20% more (`"statusResistance"` in `waves.json`). This adds to the enemy's own resistance.
- **Final damage reduction** (`"finalDamageReduction"` in `waves.json`): from wave 10 every enemy takes less damage
  from every tower hit, effect and damage over time: 1% at wave 10, 20% at wave 50, 30% at most before wave 55, then
  50% at wave 60, 62% at 65 and 70% (its maximum) from wave 70 (linear in between). It is applied last, after defense and every bonus. **Hero skills deal true damage**: they ignore it,
  like they ignore defense, so later waves need the skills and passives that work together. The *Enemy armor* tab
  shows it.
- **Enemy abilities:** they are implemented but switched off (`"enabled": false` in `enemy.json`).
  - Iron Skin
  - Rage
  - Evasion
  - Sprint
  - Fortified Body
  - …

---

## Combat rules

### Tower stats

Flat bonuses are added to the value of the tower level first, then the % bonuses multiply the result
(`TowerUnit.stats`). Research and hero buffs of the same kind are added together before they are used.

| Stat | Formula |
|---|---|
| Damage | (level damage + flat damage) × (1 + Halo %) × (1 + damage %) × active skill (Angel Feather ×2) |
| Attack speed | (level speed + flat speed) × (1 + Halo %) × (1 + attack speed %) × active skill (Buff Arrow ×2) |
| Attack range | (level range + flat range) × (1 + range %); the Halo Spire radius is fixed |
| Explosion radius | level radius × (1 + explosion %) (the Crossbow radius is fixed) |
| Crit rate / crit damage | level value + research + heroes (crit rate 100% at most) |

- Flat damage: *Hardened Tips* (+20 per level, +200 at max), *Masterwork Ammunition* (+5 per level, endless) and
  hero flat damage. Damage %: *Sharpened Ammunition* and hero buffs.
- Halo %: *Empowering Halo*, on the whole base (level value + flat bonuses).
- The Halo Spire itself uses the attack speed formula for its activations (flat and % attack speed research apply).
- Example: a Lv 3 Catapult (230) with +100 flat and +30% damage hits for (230 + 100) × 1.3 = 429 before defense.

### Damage of a hit

Every tower hit goes through one pipeline (`CombatManager.computeDamage`):

1. **Dodge:** enemies with the dodge ability may avoid the hit ("MISS").
2. **Base damage** = tower damage (above) × the hit share (100% for a normal hit; less for a chain jump).
3. **Effective defense** = enemy defense × 2 − reductions (*Armor / Spell Piercing*, Armor Break, heroes).
   It can go below 0: the enemy then takes more damage. Multiplier = 1 − effective defense / 100.
4. **Damage types:** a tower with two types (Catapult) computes both and keeps the higher one.
5. **Marks:** Hunter's Mark (Crossbow) and Arcane Vulnerability (magic) add their % per stack.
6. **Enemy abilities:** physical damage reduction, area damage reduction (area shots only).
7. **Passives:** Bitter Cold (Crystal vs slowed enemies), Aftershock (7 s after a Shockwave stun).
8. **Effect bonus** is added: Heavy Impact (its flat bonus after defense, or its share of the max HP), Hunter's
   Instinct (share of the current HP at full Hunter's Mark stacks).
9. **Critical hit:** a roll on the crit rate; a crit multiplies everything by the crit damage
   (Exposed passive: +50% crit damage for 7 s after an Armor Break).
10. Round down, at least 1.
11. **Final damage reduction** of the wave (from wave 10, see How waves scale): the result × (1 − reduction %),
    at least 1. Damage over time and effect damage get it too; hero skills do not (true damage). A spell shield
    (Lich) absorbs the damage first.

**Other damage:**
- **Effect damage** (Chain Lightning, Shockwave and other flat effect damage): goes through defense (best of the
  tower's damage types), never crits. The flat Heavy Impact bonus also goes through defense, then it is added to the
  hit (so it can crit with it). Flat effect damage is ×1.5 on Lv 2 towers and ×2 on Lv 3 towers.
- **Damage over time** (Bleed, Burn): goes through defense, never crits.
- **Damage based on HP** (Heavy Impact Mastery, Bleed burst, Hunter's Instinct, stun-immune hit, Arcane Rupture):
  bosses take 1/3 of it (`effects.json` "bossPercentHpMul"), and it is never more than 4× the damage of the hit
  that caused it (10× for the Crossbow; "percentHpCapHitMul" / "percentHpCapByTower"). That hit damage is the
  full tower damage before defense: base (level + flat research, Masterwork included) × Halo × damage %.
  Heavy Impact Mastery is limited by its own "capHitMul" × the base damage (level + flat research, × Halo) and
  uses its own boss share ("bossMul": 30%, up to 100% with Crushing Weight).
- **Hero skills:** true damage, a share of the max HP (bosses take half), +*Arcane Amplifier* %; no defense,
  no final damage reduction, no crit. Their description says so ("True damage: ignores every defense and damage
  reduction").

**Explosions:** a shot hits its target and every enemy whose center is inside the explosion radius; damage and
crits are rolled for each enemy. The Crossbow radius is fixed (explosion research does not apply).

**Hit effects:** the Crossbow and the Catapult show one hit effect (the same for every level) where the shot lands;
an enemy shows at most one at a time, and a new one starts only when the last one is over. The Crystal has no hit
effect (its explosion ring shows the hit).

### Special effect chance

The chance of an effect on each hit = its two chance technologies (+5% per level, 50% at most) + *Arcane Mastery*
(all towers, +25% at max) + the tower's *Attunement* (+25% at max) + hero effect-chance buffs, **100% at most**.
The tower Info window shows where the chance comes from. Some effects have a cooldown per tower.

**Status effects** (slow, stun, bleed, burn, armor break, marks) have a duration and a stacking rule (replace if
stronger, refresh, or stack). Enemies may resist them:
- some enemies resist some effects (`enemy.json` "statusEffectResistance");
- from wave 60 every enemy gets +2.3% resistance per wave to stun, slow, bleed, marks and armor break (70% from
  wave 90, bosses +20% more, 95% at most in total; `waves.json` "statusResistance");
- Bleed and Armor Break: only the first one can be resisted (an enemy that already has it gets every new stack or refresh). Stun: a short immunity follows every stun.
- *Lingering Frost* / *Concussion* make slows / stuns last longer.

### Enemy defense

Enemy defense grows by +5 every 6 waves from wave 10 (70 at most, bosses +10 and 90 at most;
`waves.json` "defenseGrowth"). The panel at the top left of the battlefield shows the defense of the wave.

### Gold, cores and the end of a wave

- **Gold per kill** = (enemy gold + flat kill gold) × (1 + kill gold %); bosses give ×8.
- **Energy Cores:** each boss killed drops `2 + floor(wave / 50)`; the Base makes 1 after every wave. A boss that
  reaches the wall dies **without** dropping cores.
- A wave ends when every enemy is dead or has reached the wall. After it: building production, wall regen
  (*Self-Mending Stone*, then the Halo Spires' out-of-combat mending), then the "Wave cleared" window: rewards, damage per tower type, and the damage sources
  (one *Normal hits* row per tower type + every effect and skill; their shares add up to 100%, the mark bonus rows
  in brackets are part of the normal hits).

### The wall

- **HP:** 1000, + *Stone Blocks* (+100 per level), then × (1 + wall HP %) (*Reinforced Wall*, *Living Stone*,
  heroes). Raising the max HP also gives the new HP.
- **Defense:** physical and magic, from *Wall Plating* and heroes, 70 at most (Bulwark passive: ×3, 90 at most).
- **Damage taken** = enemy damage × (1 − wall defense / 100), rounded down.
  - An enemy that touches the wall hits it once (its damage, + abilities like more damage at low HP or vs walls)
    and dies.
  - Ranged enemies (Flying Demon, Lich) shoot projectiles at it from afar; a Halo Spire shield stops them (boss
    ones too) until it breaks. Barrier Block stops whole hits.
  - Last Stand passive: the wall stays at 1 HP for a while instead of falling.
- **Repair** (preparation only): missing HP × (0.5 gold + 0.5 material) × 1 / 3 / 8 (Base Lv 1 / 2 / 3)
  × (1 − *Masonry Guild* discount).
- **Mending:** *Self-Mending Stone* gives back 2% of the max HP per level after each wave; *Mending Halo*
  heals during the wave.
- The game is over when the wall reaches 0 HP.

---

## Heroes

Heroes are recruited at the Base. Each recruit is a random pick among the heroes you do not own yet.

- **Pool:** 27 heroes: twelve 3★, nine 4★, six 5★. Each is shown as an animated card.
- **Drop rate:** 3★ 60%, 4★ 30%, 5★ 10%.
- **Buffs:** a hero gets one random buff per star (3 to 5 buffs). Buffs are rolled when a new game
  starts, so every game is a little different.
- **Buff types:**
  - Tower damage, attack speed, range, explosion radius
  - Crit rate and crit damage
  - Food, material and gold production; gold from kills
  - Research cost
  - Enemy physical / magic defense, damage, speed and HP reduction
- **Passives:** some 5★ heroes have an extra skill.
  - *Crossbow Specialist*
  - *Crystal Guardian*
  - *Siege Commander*
  - *Treasurer*
- **Limits:** the Base level limits how many heroes you can own (3 / 7 / 12).
- **Hero window** (`prefabs/popups/HeroInfo`): tap a hero card to open it: animated card on the left; on the right
  the buffs and the learned skills with their description, stacked from the top in a scroll area; under them two icon
  buttons, *Learn skill* and *Promote*. A locked button is grey and says why when tapped. Tap outside the window to
  close it.
- **Promotion** (research *Ascension*, Research Lab Lv 3): a hero below 5 stars goes straight to 5 stars and gets
  1 random buff it does not have yet per star gained: **2 buffs from 3 stars, 1 buff from 4 stars**. Cost (`heroes.json`
  "promotion"): from 3 stars 12,000 gold + 15,000 material + 15,000 food + 5 Energy Cores; from 4 stars 8,000 gold
  + 10,000 material + 10,000 food + 3 Energy Cores. A promoted hero gets the 5-star skill slots (1 active + 1 passive),
  and the 5-star bar is drawn over the stars printed on its card (`sprites/ui/star_tab_5`).
- **Price:** each recruit costs 600 gold + 600 material + 600 food, plus 400 of each per hero you already own.

The buffs of every owned hero are permanent and stack with research.

### Market

The Base also opens the **Market** (*Market* button), a screen to trade one resource for another.
- **Trade Amount** (left): pick the resource to give; its button shows the amount you trade.
- **Receive Amount** (right): pick the resource to get (one of the three); its button shows the amount you receive.
- Any resource can be traded for any other. Set the amount with the buttons in the middle
  (-1K / -100 / +100 / +1K / +10K / Max), then *Trade*.
- Gold is worth 2, material and food 1 each. The market keeps a fee: 30% / 25% / 20% at Base Lv 1 / 2 / 3.
- Prices change every wave by up to ±20% per resource (shown on the screen), so it can pay to wait for a better wave.
  The changes come from a random seed stored in the save, so reopening the Market does not change them.
  The rate line is green when this wave's rate is better than usual and red when it is worse.
- Only between waves. Rates and fees are in `building.json` (`"trade"`).

---

## Research

Research is a **tree** (`research.json`): 6 branches side by side, 3 tiers from top to bottom.
- **Tier N needs Research Lab Lv N.**
- **A node needs its parent** (the node above it in the same branch) **at max level.**
- Some tier 2 nodes give only **half of their levels** until the Lab reaches Lv 3 (`"halfCap"`).
  *Armor Piercing* and *Spell Piercing* have three nodes each: I (tier 1, 2 levels), II (tier 2, 3 levels) and
  III (tier 3, 5 levels), -10 enemy def per level (100 in all). Old saves get their level split over the three.
- The tree window (`prefabs/popups/ResearchTree`): the whole height of the tree fits on screen at first. Drag to
  move around; zoom with the **- / +** buttons, the mouse wheel or two fingers; the branch buttons at the top jump to
  a branch. Tap a node: a confirm window shows what it does, its level and its cost (*Research* / *Cancel*); a locked
  or finished node shows an info window with the reason. Lines light up in the branch color once the parent is done.
- Layout: tiers are well apart (dashed line between two tiers), nodes of a branch 34 px apart, and two branches twice
  as far (68 px) with a frame bar (the top bar frame, standing up) between them.
- Nodes: the branch color as a dark-to-bright band gradient (like the hero card backgrounds) with a darker frame of
  the same color; open nodes are a little darker than finished ones, locked nodes are grey. Pictures come from
  `"icon"` (`sprites/research/<name>`, served by the research atlas, see Tools); nodes without a picture show a short
  text (`"label"`).

| Branch | Tier 1 (Lab Lv 1) | Tier 2 (Lab Lv 2) | Tier 3 (Lab Lv 3) |
|---|---|---|---|
| Offense | Flat bonuses: +10 damage, +0.05 attacks/s, +4 px range (10 levels each); Armor / Spell Piercing I | Damage % (+3%), Attack speed % (+3%), Range %, Crit rate (+2%), Explosion radius; Armor / Spell Piercing II | Aerodynamics, Smart Targeting, Crit damage; Armor / Spell Piercing III |
| Economy | +25 food / material per building per wave, +150 gold per wave (only the Base makes gold), +5 gold per kill (4 levels each) | Food / material / gold production %, gold from kills % | One more % node for each, Scholarship (-4% research cost per level) |
| Fortification | +100 wall HP per level (5 levels) | Wall HP %, Wall defense (half levels) | Self-Mending Stone (+2% max HP back after each wave), Masonry Guild (-8% repair cost); Halo Spire (unlocks the tower, needs both at max), then Warding Halo (4 levels, shield HP and defense), then Empowering Halo (5 levels) and Mending Halo |
| Tower Effects | - | Unlock each of the 9 effects, then its first 5 rate levels | 5 more rate levels per effect; Arcane Mastery; Crossbow / Crystal / Catapult Attunement under it (+5% effect chance per level for that tower, 5 levels); Tower Awakening, then the 9 effect Masteries (3 levels each) |
| Heroes | - | Hero Scholarship (heroes can learn skills) | Ascension (hero promotion), Battle Tactics, Twin Cast, Arcane Amplifier |
| Curses | - | Weakening Hex, Withering Curse, Slow / Stun duration (half levels) | (full levels) |

**Endless row** (Research Lab Lv 3, at the bottom of the tree): *Masterwork Ammunition* (+5 base damage per level,
added before the % bonuses, under the Damage % node) and *Living Stone* (+5% wall HP per level, under the Wall HP % node) have no max level.

**Tower Awakening** (Tower Effects, tier 3, 1 level, `"requiresAll"`): the last step of the tree, below a line of
its own at the end of tier 3. It needs every technology above that line at max level (endless ones aside): the
lowest node of every column is linked to it. Below it: the 9 effect Masteries (each under its effect's column) and,
in the Fortification branch, Warding Halo, then Empowering Halo and Mending Halo (`"afterAwakening"`: not needed for
Tower Awakening, and they do not need it either). Its info window counts the technologies still missing.

Flat bonuses are added to the base value before the % bonuses. Research costs are much lower than in earlier
versions so the whole tree above the awakening line, Tower Awakening and every building can be done before wave 50,
and the rest before wave 80: technologies above the awakening line x0.18, Tower Awakening x0.4, the ones under it
x0.5, rounded to nice numbers (`baseCost`; Energy Cores and the endless technologies unchanged;
`tools/balance/scale_costs.py`).

**Old saves** (before the tree) keep their technology levels: every node with a level gets its parents at max
level for free, effect research is split into the Unlock node + the two rate nodes, and *Hero Scholarship* is
given when the Research Lab is Lv 2 or more. Saves made before the Mastery technologies get Mastery 3 for every
effect whose two rate technologies are at max level, so those effects keep their full strength.

---

## Active skills

Skills are defined in `config/skills.json` (`combat/SkillManager.ts`). The **skill circle** has the
diameter of the enemy lane (top to bottom of the path, `battlefield.enemyLaneY`); targeted skills use a
zone that is a share of it (`areaScale`). Skill damage is a share of each enemy's max HP, ignores
defense, and bosses take only 50% of it (`bossDamageMul`). Cooldowns are counted in waves and kept in
the save.

**Testing (temporary):** during a wave, the green button at the bottom left casts the skills one after
another, ignoring cooldowns. Targeted skills wait for a tap on the enemy path (tap the button again to
cancel); `<<` and `>>` go to the previous / next skill.

| Skill | Cooldown (waves) | Effect |
|---|---|---|
| Air Burst | 5 | A blast of wind along the wall throws every enemy back, away from the wall. |
| Crater Impact | 8 | Every enemy is stunned for 5 s (even when immune; the time is never reduced) and loses 20% of its max HP. |
| Fire Cast | 5 | Calls a small fire zone (half of the skill circle) at the chosen spot: enemies inside lose 80% of their max HP. |
| Ice Cast | 5 | Calls a small ice zone (half of the skill circle) at the chosen spot: enemies inside lose 80% of their max HP. |
| Lightning Cast | 5 | Calls a small lightning zone (half of the skill circle) at the chosen spot: enemies inside lose 80% of their max HP. |
| Shadow Cast | 5 | Calls a small shadow zone (half of the skill circle) at the chosen spot: enemies inside lose 80% of their max HP. |
| Nature Cast | 5 | Calls a small nature zone (half of the skill circle) at the chosen spot: enemies inside lose 80% of their max HP. |
| Arcane Cast | 5 | Calls a small arcane zone (half of the skill circle) at the chosen spot: enemies inside lose 80% of their max HP. |
| Holy Sword Hit | 7 | Holy swords strike the whole battlefield: every enemy loses 40% of its max HP. |
| Divine Beam | 10 | A beam of light falls on the chosen spot. Enemies in a small zone (3/8 of the skill circle) lose 100% of their max HP. |
| Frost Circle | 10 | A frost magic circle opens on the chosen spot. Enemies in a small zone (3/8 of the skill circle) lose 100% of their max HP. |
| Solar Circle | 10 | A solar magic circle opens on the chosen spot. Enemies in a small zone (3/8 of the skill circle) lose 100% of their max HP. |
| Spirit Circle | 10 | A spirit magic circle opens on the chosen spot. Enemies in a small zone (3/8 of the skill circle) lose 100% of their max HP. |
| Crimson Circle | 10 | A crimson magic circle opens on the chosen spot. Enemies in a small zone (3/8 of the skill circle) lose 100% of their max HP. |
| Meteor Strike | 10 | A meteor crashes on the chosen spot. Enemies in a small zone (9/16 of the skill circle) lose 100% of their max HP. |
| Angel Feather | 5 | Doubles the damage of every tower (+100% of the current damage) for 15 s. |
| Gravity Well | 5 | A gravity well on the chosen spot pulls the enemies of the skill circle to its center, then they lose 20% of their max HP. |
| Fire Tornado | 2 | Fire tornadoes sweep the whole battlefield: every enemy loses 20% of its max HP. |
| Buff Arrow | 5 | Doubles the attack speed of every tower (+100% of the current speed) for 15 s. |
| Holy Heal | 12 | Holy light runs along the wall and restores it to full HP. |
| Barrier Block | 5 | Blocks the next 20 hits on the wall. Only lasts for the wave it is cast in. |
| Lightning Strike | 5 | Lightning bolts rain on the chosen spot. Enemies inside the skill circle lose 50% of their max HP. |
| Rock Fall | 5 | Rocks fall on the chosen spot. Enemies inside the skill circle lose 50% of their max HP. |
| Void Rift | 5 | Void rifts tear open on the chosen spot. Enemies inside the skill circle lose 50% of their max HP. |

---

## Hero skills and Energy Cores

**Energy Cores** drop from every boss: `2 + floor(wave / 50)` cores per boss (`waves.json` "bossCoreDrop"),
so later bosses give more, and the Base makes **1 Energy Core after every wave** (`building.json` base
"production"). The cores of a wave are listed in the "Wave cleared" window.

**Skill books** are sold in the Market of the Base, tab **Skill Books** (bottom right): books owned on the
left, this wave's offers on the right. Every wave brings a new random choice of 4-6 books, paid in gold
(`skills.json` "bookShop": price = 2000 x (1 + 5% per wave), +/- 20%). A book can teach any of the active
skills above or a passive skill.

**Learning** (research *Hero Scholarship*, Research Lab Lv 2): in the hero recruitment, owned heroes with a free
skill slot can learn from the *Learn skill* button of the hero window (tap the hero card). It opens
a popup listing the books the hero can learn; learning costs **1 Energy Core** and
uses up the book. 5-star heroes learn 1 active + 1 passive skill, the other heroes 1 skill (active or
passive). Learned skills are listed on the hero card.

**In battle:** when a wave starts, the Build Tower button is replaced by small cards of the heroes that
learned an active skill. Tap a card to highlight it and read its skill on the right side of the screen;
drag it up out of the card bar to cast the skill. For an area skill the card goes back to its place and the
player taps the enemy path to choose where it lands (tap the card again to cancel).
An active hero skill can be used **once every 5 waves**.

**Passive skills** (`skills.json` "passives", 24) work while a hero has learned them. Each skill can only be bought
once per game, so each passive is owned by one hero at most. The books of the effect passives are only sold once
that effect is unlocked. Numbers are in each passive's `"params"`.

| Effect | Passive | What it does |
|---|---|---|
| Piercing Bolt | Skewer | Pierced enemies can also get the Crossbow's Bleed and Hunter's Mark. |
| Piercing Bolt | Long Shot | 2 more enemies, jump range 140 to 200. |
| Bleeding Bolt | Hemorrhage | At full Bleed stacks, enemies nearby (140) get 2 stacks. With Mastery 3 Bleed also deals 0.1% current HP per second per stack (before: +50% Bleed damage). |
| Bleeding Bolt | Deep Cuts | With Mastery 3 the burst comes 1 stack earlier and deals 6% max HP (before: +50% Bleed damage). |
| Hunter's Mark | Prey | When an enemy with full mark stacks dies, 3 stacks move to the closest enemy (200). |
| Hunter's Mark | Open Season | The mark also counts for every other tower, at 1/3 of its value. |
| Frost Explosion | Deep Freeze | A slowed enemy hit by Frost 2 more times is frozen (stunned) for 1 s. |
| Frost Explosion | Bitter Cold | Slow +15%, slowed enemies take +15% damage from Crystals. |
| Chain Lightning | Conductor | Jumps to slowed enemies first and stuns them for 0.3 s. |
| Chain Lightning | Overload | Every jump deals 10% more than the one before. |
| Arcane Vulnerability | Arcane Rupture | At full stacks the enemy explodes (radius 100): 4% max HP with Mastery 3, flat damage before; the stacks are removed. |
| Arcane Vulnerability | Spell Weave | Arcane stacks raise hero skill damage by half of their value. |
| Shockwave | Aftershock | A stunned enemy takes +50% damage for 7 s; every new stun starts the 7 s again. |
| Shockwave | Tremor | Stun +0.2 s, stun-immune hit 4% to 6% max HP (before Mastery 2: +50% Shockwave damage). |
| Heavy Impact | Crusher | On an enemy that has Armor Break or is stunned at that moment: Heavy Impact's max HP share x2 (3% -> 6%), limit 15 hits (instead of 3 / up to 8). |
| Heavy Impact | Giant Slayer | +50% on bosses. |
| Armor Break | Sunder | Stacks up to 3 times. |
| Armor Break | Exposed | An enemy that gets Armor Break takes +50% critical damage for 7 s; every new or refreshed Armor Break starts the 7 s again. |
| - | Last Stand | The wall stays at 1 HP for 20 s instead of falling. Recharges in 15 waves. |
| - | Bulwark | Below 50% HP the wall defense is tripled (max 90) for 30 s. Recharges in 10 waves. |
| - | Spoils of War | After a boss is defeated, the next building production is x10. |
| - | Time Warp | After every wave, a random recharging hero skill needs 1 wave less. |
| - | Treasure Hunter | +1 gold per normal kill; +1 Energy Core and +8888 gold per boss. |
| - | Hawk's Gaze | +35% critical chance for every tower. |

The skill card of a passive that recharges shows how many waves are left.

**Special research** (Research Lab Lv 3, paid with Energy Cores as well):

| Technology | Effect | Energy Cores |
|---|---|---|
| Battle Tactics | Hero skills recharge 1 wave faster (5 -> 4 waves) | 4 |
| Twin Cast | Every hero skill can be used one more time before it recharges | 5 |
| Arcane Amplifier | +10% skill damage per level (5 levels) | 1 per level |

The research cost discount never applies to Energy Cores.

---

## Art style

- **Pixel-art fantasy:**
  - animated towers with rotating weapons
  - animated monsters with walk and death animations
  - animated castle buildings for every level
- **Ornate medieval UI:**
  - framed popups with parchment-scroll titles
  - decorated buttons
  - resource icons
  - a decorated top bar
  - round see-through light blue action buttons with icons around a selected building or tower
    (upgrade, info, move, target, recruit, market, research, destroy)
- **Status icons:** an enemy under an effect shows a small 16 px icon above its HP bar (bleeding, burning, hunter's mark,
  slow, magic vulnerability, armor break, stun; `visual.icon` in `effects.json`, packed in the combat atlas).
- **Damage numbers:** critical hits are bigger, red and thickly outlined.
- **Catapult explosions:** the blast art grows with the explosion radius (a third of the explosion circle) and is drawn under the enemies.
- **Live main menu:** the menu plays an endless battle in the background behind a dark veil.

### Sound
- **Music:**
  - Calm orchestral music in the menu and inside the castle (*Knights chamber*).
  - Battle music on the battlefield (*Fate of battle*).
  - Boss waves switch to *First Battle* until the wave is cleared.
- **Sound effects:**
  - Every tower has its own firing and hit sound.
  - Catapult stones crash down with falling debris.
  - Crystal effects crackle with frost and lightning.
  - Each enemy type has a death cry.
  - The wall thuds when it is hit.
  - Waves, bosses, upgrades and errors have their own cues.
- **Sound limits:** a sound is never repeated faster than a few times per second, so big fights stay clear.
- **Stone sounds:** the wall-hit and catapult-impact sounds are generated by code (`tools/audio/rock_sfx.py`).

---

## Getting started

1. Install **Cocos Creator 3.8.8** with the Cocos Dashboard.
2. Clone this repository and add the folder in the Dashboard (*Add* → select the project folder).
3. Open `assets/scenes/Main.scene` and press **Play**.

The design resolution is 1024 × 576.
- The height always fits the screen.
- The width follows the window, so the game works on wide phones and on desktop.
- The UI sticks to the screen edges.

The folders `library/`, `temp/`, `local/`, `build/` and `profiles/` are generated by Cocos
Creator and are not in the repository; the editor recreates them the first time the project opens.

### Test saves

For testing, **Load Game** also lists ten read-only saves under *Test saves (bot)*: the game as the bot (seed 1)
played it up to wave 10, 20, 30, …, 100 with the current balance. The bot builds and upgrades everything (4 Halo
Spires next to the wall), recruits heroes, buys skill books and teaches them, promotes the heroes to 5 stars, casts
the hero skills in battle, researches every technology (every building at max at wave 37, Tower Awakening at wave
50, every finite technology by wave 65, all 12 heroes at 5 stars at wave 67 with their 24 skills at wave 68) and
uses the Market. It falls at wave 130 (the two other test seeds at 100 and 90).
Below them, nine more saves of the weaker **seed 3** run (fewer good heroes) at waves 10 to 90
(`presets/seed3_wave_<n>.json`, "Test - Wave N (seed 3)"): it falls at wave 90, the Lich wave.
- They are the files `assets/resources/presets/wave_<n>.json` and `seed3_wave_<n>.json` and cannot be deleted in the game.
- Loading one starts a normal game from that point; the file itself is never changed.
- To hide them, empty `TEST_SAVES` in `Main.ts`.

---

## Project architecture

The game has **one scene**. A single `Main` component boots the game and switches between
screens and popups. Every screen, popup and list item is a **prefab**; the game logic is plain
TypeScript classes.

```
assets/
  scenes/Main.scene           the only scene; Main (under Canvas) boots the game
  scripts/
    Main.ts                   boot, loading, screens, popups, save / load, audio
    core/
      ConfigMgr.ts            loads and validates the JSON configs
      Assets.ts               textures, combat atlas, asset bundles, prefabs
      ResourceMgr.ts          game state (resources, buildings, towers, wall, heroes, research)
      services/               game rules: Building, Tower, Wall, Research, Hero, Buff
      state/                  SaveCodec (save data + validation), Placement (free placement geometry)
    combat/
      CombatManager.ts        targeting, damage pipeline, effects, object pools
      Enemy.ts, TowerUnit.ts, Projectile.ts, WaveMgr.ts, HpBar.ts, CombatText.ts, SpriteAnim.ts
    views/                    screen controllers: MainMenu, InCastle, OutCastle, HeroRecruit, Loading, Overlays
      screens/ popups/ items/ view components of the prefabs (references to their nodes)
      common/                 PrefabUi, PopupTemplate, ButtonTemplate, Popups (confirm, message, toast, info), TopBar, DefTab, UIKit
  prefabs/                    asset bundle "prefabs": screens/, popups/, items/
                              popups/PopupTemplate, items/ButtonTemplate: see "Popup and button templates"
  bundles/heroes/             asset bundle "heroes": hero card sheets (256-color PNG), loaded only when shown
  resources/
    config/                   all balancing data (.json)
    sprites/                  sprite sheets; sprites/atlas/combat packs every enemy, tower and status sheet,
                              sprites/atlas/research the research tree icons; sprites/map/map.jpg the castle map
    audio/                    music and sound effects (MP3, built by tools/audio)
art/                          picture sources that are not shipped as they are (packed into the atlases)
  combat/                     enemies/, towers/, status/: sources of sprites/atlas/combat
  boss/                       one folder per boss (lich/): sources of sprites/atlas/boss
  halo/                       Halo Spire shield sheets, ring and effect disc: sources of sprites/atlas/halo
  research/                   research icons (96 x 96 PNG): sources of sprites/atlas/research
```

### Main ideas

- **Data-driven.** Everything that affects balance is in `assets/resources/config`, so the game
  can be tuned without touching code:
  - `building.json`: buildings, Base limits, wall, start resources, recruit cost, market rates
  - `tower.json`: towers, levels, battlefield layout, target modes
  - `enemy.json`: enemies, resistances, abilities
  - `waves.json`: wave size, HP curve, bosses, milestones, special waves, defense growth
  - `heroes.json` and `herobuff.json`: hero pool, star weights, buff ranges
  - `research.json`: research tree (branches, tiers, technologies with their parent node, costs)
  - `effects.json`: status effects and tower special effects

  Configs are validated when the game starts: errors stop the loading screen and are listed,
  warnings are shown on the main menu.
- **UI in prefabs, logic in code.** Each prefab has a small view component (for example
  `PauseView`) whose properties point at its nodes. The controller only fills in texts and
  connects buttons, so layouts are edited in the editor. HUD elements use Widgets to stay on
  the screen edges.
- **Services.** `ResourceMgr` is a small facade over one service per game system. Screens
  listen to its change event instead of polling
---

## Tools

The `tools/` folder is outside the game assets.
- `tools/atlas/pack_atlas.py`: packs the enemy, tower and status sheets of `art/combat/` into
  `sprites/atlas/combat`, the Halo Spire ring of `art/halo/` into `sprites/atlas/halo`, the boss sheets of `art/boss/`
  into `sprites/atlas/boss` (full color), and the research icons of `art/research/` into `sprites/atlas/research` (2048 x 512,
  256 colors, about 250 KB instead of 1.4 MB in 70 files). The configs keep the old paths
  (`sprites/towers/base_t1`, `sprites/research/off_damage`), which are looked up in the atlas manifests.
  Run it again after changing a sheet or an icon: `python tools/atlas/pack_atlas.py assets/resources
  [combat|halo|boss|research|all]`. Needs Python + Pillow.
- `tools/towers/prepare_shield.py`: makes the Halo Spire shield sheets of `art/halo` (loop 10, collapse 8 frames,
  2 rows each; cells 108 x 256 px: the right 2/5 of the bubble, cut edge faded) from the two "Shield Round Magic" 512 px sheets and prints the bubble radius for tower.json.
  The halo atlas uses linear filtering, so the shield (drawn bigger than its cells) stays smooth instead of blocky.
- `tools/towers/prepare_halo.py`: copies the Halo Spire base and crystals of "Spire - Tower Pack 3" into
  `art/combat/towers` and draws the thin halo ring `art/halo/halo_ring.png` and the disc `art/halo/fx_disc.png`
  (also used by the explosion rings; `--ring <art/halo>` draws only these two). Needs Python + Pillow + NumPy.
- `tools/research/make_tree_parts.py`: draws the research tree pictures (`art/research/tree_*.png`: node square,
  frame, line, dashed line), packed into the research atlas with the icons.
- `tools/ui/make_info_button.py`: makes `sprites/ui/btn_info.png` (castle Guide button) from `btn_pause.png`: the bars
  are painted over and a pixel "i" is drawn: `python tools/ui/make_info_button.py <btn_pause.png> <btn_info.png>`.
- `tools/enemies/thin_frames.py`: keeps only some frames of a sheet (`every2`: every 2nd frame + the last one).
  The death animations were thinned with it (Clampbeetle 13 -> 7 frames, Firebug 11 -> 6, Magma Crab 10 -> 6,
  Scorpion 8 -> 5, Lich King 23 -> 12), and the Flying Demon death keeps only its own 4 frames (the fall was cut).
- `tools/boss/prepare_lich.py`: makes `art/boss/lich/` from the "AW - Lich King" pack and the two shield sheets:
  mirrors every frame (the pack faces right), crops each animation to what its frames use and prints the
  `"anchor"` of each animation for enemy.json (the ground pivot stays at the same place in every animation; the
  enemy position is 55 px above it, enemy.json `"feetY"`). The shield is scaled to 40%.
- `tools/atlas/quantize_cards.py`: turns a full-color hero card sheet into a 256-color PNG (ordered dither,
  exact alpha), about 4x smaller: `python tools/atlas/quantize_cards.py <in.png> <out.png>`, or a folder to
  convert every `*_card_sheet.png` in place. Run it on the full-color source only, not on a sheet that is
  already converted. Needs Python + Pillow + NumPy.
- `tools/balance/scale_costs.py`: scales the research costs from a reference `research.json` and rounds them to nice
  numbers; `tools/balance/set_curve.py`: writes the enemy HP curve of `waves.json` from target values at some waves.
- `tools/audio/build_audio.py`: builds `resources/audio` from the downloaded sound packs.
  - Keeps one loop of each music track and cuts silence.
  - Converts everything to small MP3 files: about 3.8 MB in total, against about 115 MB of original WAV files.
- `tools/audio/rock_sfx.py`: generates the stone impact sounds (needs Python + NumPy + SciPy).
- `tools/prefab/`: the generator that made the first version of the prefabs, and the UI
  sprite-frame metas. Running it again overwrites changes made in the editor, so new prefabs are made one by one with
  `--only`: `node build_prefabs.js <project> ui_frames.json --only=guidePopup,guideRowItem` (function names).
  `new_ui_meta.py` writes the sprite-frame meta of a new `sprites/ui` picture and adds it to `ui_frames.json`.
- `tools/ui/make_guide_icons.py`: draws `sprites/ui/red_dot.png` and `sprites/ui/check_tick.png` (Guide red dot and tick).

---

## Credits

Thanks to the artists whose free assets are used in this game. All packs were downloaded from itch.io; please follow each author's license if you reuse them.

### Art

| Asset | Author | Used for | License |
|---|---|---|---|
| [Spire Tower Pack 1](https://foozlecc.itch.io/spire-tower-pack-1), [Spire Tower Pack 2](https://foozlecc.itch.io/spire-tower-pack-2) and Spire Tower Pack 3 | Baldur / [Foozle](https://foozlecc.itch.io) | Defense tower sprites (pack 3: Halo Spire base and crystal) | CC0 |
| Monster sprites | Baldur / [Foozle](https://foozlecc.itch.io) (same source as the towers) | Monsters | CC0 |
| Flying Demon | [luizmelo](https://luizmelo.itch.io) | Flying Demon (fly, attack, death) | CC0 |
| AW - Lich King 1.0 | [artistworld](https://artistworld.itch.io) | Lich King boss (Frost palette): body animations, Soul Bolt, impact, summoning circle | artistworld license (games and edits allowed, credit appreciated; no resale or redistribution as assets) |
| Shield Elliptic Magic (Blue) | (pack sent by the owner) | Lich King spell shield: loop and collapse | to be confirmed |
| Shield Round Magic (Blue) | (pack sent by the owner) | Halo Spire shield: loop and collapse | to be confirmed |
| PVFX Foundry 1.0.0 | Pixel VFX Studio (made with the [pixelfx](https://github.com/patch-gg/pixelfx) toolkit, MIT) | Active skill effects (`sprites/skills`), Flying Demon fireball and fire impact | CC0 |
| Hero cards | AI generated | Hero pictures | AI generated |
| Castle buildings, maps, UI | Project author | Everything else | Project-owned |

### Music

| Track | Pack | Author | Used as | License |
|---|---|---|---|---|
| Knights chamber | [Village Medieval Music Pack](https://thesoundrack.itch.io/village-medieval-music-pack) | Leonardo Calvo ([The Sound Rack](https://thesoundrack.itch.io)) | `bgm_castle` - inside the castle | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| Fate of battle | [Battle Medieval Music Pack](https://thesoundrack.itch.io/battle-medieval-music-pack) | Leonardo Calvo ([The Sound Rack](https://thesoundrack.itch.io)) | `bgm_battle` - normal waves | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| First Battle | [Battle Medieval Music Pack](https://thesoundrack.itch.io/battle-medieval-music-pack) | Leonardo Calvo ([The Sound Rack](https://thesoundrack.itch.io)) | `bgm_boss` - boss waves | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |

Changes made (as asked by CC BY 4.0): *Knights chamber* was cut to its loop part (0:38.275 - 1:48.620); all three tracks were resampled to 44.1 kHz and converted to MP3 (112 kbps). No other changes.

### Sound effects

| Pack | Author | Used for | License |
|---|---|---|---|
| [RPG Essentials SFX - Free!](https://leohpaz.itch.io/rpg-essentials-sfx-free) | [Leohpaz](https://leohpaz.itch.io) | Buttons, denied, coin, upgrade, wave start, win / lose, crystal tower shot, arrow hit, tank death | Free for commercial and non-commercial use, credit appreciated |
| [Basic Spell Impacts](https://lentikula.itch.io/freecc0-basic-spell-impacts-sfx) | [Lentikula](https://lentikula.itch.io) | Crystal hit, frost and lightning effects | CC0 |
| [Free Monster Sounds (Classic Monster Sounds)](https://coucassi.itch.io/free-monster-sounds) | [Coucassi](https://coucassi.itch.io) | Boss arrival, berserker / runner / juggernaut deaths | Free to use with credit: *Credits to Coucassi* |
| [Fantasy Audio Bundle (Starter Pack)](https://pupaya.itch.io/fantasy-audio-bundle) | [Pupaya](https://pupaya.itch.io) | Button, crossbow and catapult shots, bleed effect | Royalty free |

The sounds were trimmed, faded out, mixed down to mono, volume-normalised and converted to MP3 (80 kbps) by `tools/audio/build_audio.py`. The exact source file of every sound is listed in that script.

The stone sounds (`wall_hit_v1..3`, `explode_v1..3`) are not from any pack: they are generated by `tools/audio/rock_sfx.py` for this project.

### Engine

Made with [Cocos Creator](https://www.cocos.com/en/creator) 3.8.8.
