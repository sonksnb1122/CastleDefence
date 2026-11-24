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

**Energy Core:** a fourth resource, dropped by bosses (see [Hero skills and Energy Cores](#hero-skills-and-energy-cores)). It is shown in the top bar and cannot be traded in the Market.

**Saving:** one autosave slot (written after every wave and when the app goes to the background)
and three manual slots. Saving is only possible during preparation.

---

## Castle buildings

Buildings are placed freely inside the castle's build area. They do not snap to a grid and
cannot overlap. Every building has 3 levels, and the Base level limits everything else.
Destroying a building refunds 50% of its build cost.

| Building | Produces after each wave (Lv 1 / 2 / 3) | Limit | Notes |
|---|---|---|---|
| **Base** | 120 / 250 / 900 gold | 1 (fixed in the centre) | Raises the tower limit (10 / 20 / 30), the hero limit (3 / 7 / 12), the number of other buildings and the max tower level. Upgrade: 900 gold + 500 material + 400 food, then 4000 gold + 6000 material + 6000 food. |
| **Farm** | 95 / 150 / 495 food | 5 per Base level | Build: 60 gold + 100 material |
| **Lumber & Quarry** | 115 / 180 / 480 material | 5 per Base level | Build: 80 gold + 80 food |
| **Research Lab** | nothing | 1 | Opens research. Max technology level is 2 / 5 / 10 at Lab Lv 1 / 2 / 3. Lab Lv 3 also unlocks the tower special effects, Smart Targeting and the endless technologies. |

---

## Defense towers

There are three towers, and each has 3 levels.
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

**Target modes** (switch with the *Target* button of a selected tower):
- **First:** the enemy closest to the wall.
- **Lowest HP**, **Highest HP**, **Nearest** (to the tower).
- **Smart:** unlocked by research. The tower picks the target where its damage is most useful.
  - Area towers aim at groups. The Catapult also goes for the boss, more and more as it gets close to the wall
    (`"smartBossBonus"` in `tower.json`).
  - Shots never waste damage on an enemy that is already going to die.
  - Enemies near the wall get priority.
  - A Crossbow with Smart mode always hits the enemy closest to the wall.

**No wasted shots:**
- Every shot reserves its expected damage (no crit) on its target; an area shot (Crystal, Catapult) also reserves it
  on the enemies close around the target, which its explosion will most likely hit.
- In every target mode, the Crossbow and the Crystal (`"avoidOverkill": true` in `tower.json`) skip an enemy once the
  shots already flying at it are enough to kill it, and fire at the next enemy right away.
- If the target still dies before a shot lands (a crit, another tower, bleeding), the shot flies on to the nearest
  living enemy that is not already doomed (or, when all are, to the nearest one).

### Special effects
Every tower has three special effects. They are unlocked and made more likely by research
at Research Lab Lv 3: each research step adds +5% chance, up to 50%. The Crystal gets twice
the chance at level 3, so a fully researched Crystal reaches 100%.
*Arcane Mastery* (and hero effect-chance buffs) add their points on top, above the 50% limit:
with +25% every researched effect reaches 75% (100% at most).
The tower's *Info* window lists its three effects with their current chance and what they do
(the texts are the `"description"` fields of `effects.json`).

| Tower | Effect | What it does |
|---|---|---|
| Crossbow | Piercing Bolt | The bolt goes on to hit 2 more enemies nearby. |
| Crossbow | Bleeding Bolt | Bleed: 20% of the hit as physical damage every second for 4 s (stacks 3 times). |
| Crossbow | Hunter's Mark | The target takes +50% damage from Crossbows for 5 s. |
| Crystal | Frost Explosion | Every enemy in the explosion is slowed by 35% for 2.5 s. |
| Crystal | Chain Lightning | Lightning jumps to 3 more enemies for 80% damage. |
| Crystal | Arcane Vulnerability | Enemies hit take +20% magic damage for 4 s. |
| Catapult | Shockwave | Enemies hit are stunned for 0.3 s. |
| Catapult | Heavy Impact | Bonus damage equal to 6% of the target's max HP. |
| Catapult | Armor Break | Enemies hit lose 20 defense for 4 s. |

---

## Enemies and waves

| Enemy | Role | HP | Wall damage | Speed | Phys / Magic def | Gold |
|---|---|---|---|---|---|---|
| **Scorpion** (Berserker) | Hits the wall hard | 97.5 | 55 physical | 20 | 5 / 8 | 10 |
| **Firebug** (Runner) | Very fast, fragile | 60 | 15 magic | 42.5 | 3 / 3 | 8 |
| **Clampbeetle** (Tank) | High HP and physical defense, resists stun | 240 | 25 physical | 12.5 | 20 / 5 | 12 |
| **Magma Crab** (Juggernaut) | Slow, tough, resists stun and slow | 210 | 50 magic | 10 | 15 / 15 | 25 |

Values are for wave 1. All stats grow with the wave number.

**How waves scale:**
- **Enemy count:** starts at 24 and grows by 2 every wave. Spawns come faster over time.
- **Stats:** HP follows a curve tuned by segments. Damage, speed and gold grow every 3 waves.
  From wave 86, HP grows much faster (×1.115 per wave) and gets an extra ×1.2 after wave 100:
  a player with every upgrade usually loses between wave 100 and 120.
- **Enemy types:**

  | Waves | Enemies |
  |---|---|
  | 1–3 | Scorpions and Firebugs |
  | from 4 | Clampbeetles join |
  | from 7 | Magma Crabs join |

- **Wave 5, "Swarm":** a special wave with many weak Firebugs and Scorpions.
- **Bosses:** every 10th wave adds a giant Magma Crab boss with ×4 HP, ×3 damage and ×8 gold.
- **Milestones:** waves 10, 30 and 70 are sieges with more enemies and extra bosses.
  - Wave 10: **Siege**
  - Wave 30: **Great Siege**
  - Wave 70: **Doom Siege**
- **Enemy armour:**
  - From wave 10, enemy defense rises by 5 every 6 waves, up to 70 (bosses up to 90).
  - The *Enemy armor* tab in the top left corner shows how much Armor / Spell Piercing the next wave needs
    compared with what you have.
- **Status limits** (so enemies are never stunned or slowed without a break):
  - After a Stun, an enemy cannot be stunned again for the stun time + 0.5 s (`"immunityAfter"` in `effects.json`).
  - From wave 70, enemies get +1.5% Stun and Slow resistance per wave, up to 70% (wave 116); bosses get +20% more
    (`"statusResistance"` in `waves.json`). This adds to the enemy's own resistance (Clampbeetle, Magma Crab).
- **Enemy abilities:** they are implemented but switched off (`"enabled": false` in `enemy.json`).
  - Iron Skin
  - Rage
  - Evasion
  - Sprint
  - Fortified Body
  - …

---

## Combat rules

All tower damage goes through one pipeline:

1. **Base damage** = tower damage × (1 + damage buffs).
2. **Effective defense** = enemy defense × 2 − defense reduction (research, heroes, Armor Break).
   It can go below 0, which makes the enemy take extra damage.
3. **Normal damage** = base damage × (1 − effective defense / 100).
   The Catapult computes this for both damage types and keeps the higher one.
4. **Critical hit:** roll the crit rate; a crit multiplies the damage by the crit damage.
5. Round down, minimum 1. Apply the damage, then pay the gold reward once on death.

**Explosions:** projectiles hit the target and every enemy inside the explosion radius.

**Status effects:**
- slow
- stun
- bleed
- burn
- armour break
- marks

Each effect has a duration and a stacking rule (replace if stronger, refresh, or stack), and
some enemies resist some effects.

**The wall:**
- **HP:** starts with 1000 HP and has its own physical and magic defense (max 70).
- **Damage:** enemies that reach it hit it until they die or the wall falls.
- **Repair:** costs gold and material per missing HP. The price goes up with the Base level.

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

The Research Lab has about 35 technologies. Each level costs more than the last, and the Lab
level limits how high a technology can go (2 / 5 / 10).
*Aerodynamics* (projectile speed, +5% per level) goes up to level 20: twice the Lab limit (`"labCapMul": 2`).
It does not add damage, so it stays cheap (all 20 levels cost about 3.7k gold and 7.9k material and food).

| Group | Technologies |
|---|---|
| Towers | Damage, Attack speed, Range, Explosion radius, Crit rate, Crit damage, Projectile speed |
| Economy | Food, Material and Gold production, Gold from kills |
| Wall | Wall HP, Wall defense |
| Enemies | Armor Piercing (physical def), Spell Piercing (magic def), Weakening Hex (damage), Withering Curse (HP) |
| Effects (Lab Lv 3) | One technology per tower special effect (9), Arcane Mastery (all effects), longer Slow / Stun, stronger Bleed / Burn |
| Endless (Lab Lv 3) | *Masterwork Ammunition* (damage) and *Living Stone* (wall HP) have no max level. They open once the normal version is maxed. |
| Smart Targeting (Lab Lv 3) | A very expensive one-time technology that adds the *Smart* target mode. |

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
so later bosses give more. The cores of a wave are listed in the "Wave cleared" window.

**Skill books** are sold in the Market of the Base, tab **Skill Books** (bottom right): books owned on the
left, this wave's offers on the right. Every wave brings a new random choice of 4-6 books, paid in gold
(`skills.json` "bookShop": price = 2000 x (1 + 5% per wave), +/- 20%). A book can teach any of the active
skills above or a passive skill.

**Learning:** in the hero recruitment, owned heroes with a free skill slot show a **+** at the top right of
their card. It opens a popup listing the books the hero can learn; learning costs **1 Energy Core** and
uses up the book. 5-star heroes learn 1 active + 1 passive skill, the other heroes 1 skill (active or
passive). Learned skills are listed on the hero card.

**In battle:** when a wave starts, the tower build buttons are replaced by small cards of the heroes that
learned an active skill. Tap a card to highlight it and read its skill on the right side of the screen;
drag it up out of the card bar to cast the skill (targeted skills land where the card is released).
An active hero skill can be used **once every 5 waves**. Passive skills (`skills.json` "passives") give
their buffs permanently, like hero buffs (the passive list is a placeholder for now).

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

For testing, **Load Game** also lists six read-only saves under *Test saves (bot)*: the game as a bot
played it up to wave 30, 50, 70, 90, 100 and 110. The bot builds and upgrades everything, recruits heroes,
researches every technology (Smart targeting on all towers from about wave 95) and uses the Market.
- They are the files `assets/resources/presets/wave_<n>.json` and cannot be deleted in the game.
- Loading one starts a normal game from that point; the file itself is never changed.
- To hide them, set `TEST_SAVES = []` in `Main.ts`.

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
      common/                 PrefabUi, Popups (confirm, message, toast, info), TopBar, DefTab, UIKit
  prefabs/                    asset bundle "prefabs": screens/, popups/, items/
  bundles/heroes/             asset bundle "heroes": hero card sheets, loaded only when shown
  resources/
    config/                   all balancing data (.json)
    sprites/                  sprite sheets; sprites/atlas/combat packs every enemy and tower sheet
    audio/                    music and sound effects (MP3, built by tools/audio)
```

### Main ideas

- **Data-driven.** Everything that affects balance is in `assets/resources/config`, so the game
  can be tuned without touching code:
  - `building.json`: buildings, Base limits, wall, start resources, recruit cost, market rates
  - `tower.json`: towers, levels, battlefield layout, target modes
  - `enemy.json`: enemies, resistances, abilities
  - `waves.json`: wave size, HP curve, bosses, milestones, special waves, defense growth
  - `heroes.json` and `herobuff.json`: hero pool, star weights, buff ranges
  - `research.json`: technologies, costs, requirements
  - `effects.json`: status effects and tower special effects

  Configs are validated when the game starts: errors stop the loading screen and are listed,
  warnings are shown on the main menu.
- **UI in prefabs, logic in code.** Each prefab has a small view component (for example
  `PauseView`) whose properties point at its nodes. The controller only fills in texts and
  connects buttons, so layouts are edited in the editor. HUD elements use Widgets to stay on
  the screen edges.
- **Services.** `ResourceMgr` is a small facade over one service per game system. Screens
  listen to its change event instead of polling.
- **Performance.**
  - **Pooling:** enemies, projectiles, effects and damage numbers are reused instead of being
    created and destroyed. About 660 nodes are created during wave 100, against more than
    50,000 before pooling.
  - **Fewer draw calls:** all combat sprites share one packed atlas texture. HP bars are sprites
    on the same texture. Damage numbers use the CHAR label cache.
  - **Loading on demand:** the 27 large hero card sheets are in a separate bundle. A card only
    keeps its texture while it is visible on screen.
- **Free placement.** Buildings and towers are placed at any position inside their area,
  with overlap and spacing checks, and their exact position is saved.
- **Saves.** Saves are JSON in local storage, with a version number and validation, so a
  broken or outdated save never crashes the game.

---

## Tools

The `tools/` folder is outside the game assets.
- `tools/atlas/pack_atlas.py`: packs every enemy and tower sheet into
  `sprites/atlas/combat`. Run it again after changing a sheet. Needs Python + Pillow.
- `tools/audio/build_audio.py`: builds `resources/audio` from the downloaded sound packs.
  - Keeps one loop of each music track and cuts silence.
  - Converts everything to small MP3 files: about 3.8 MB in total, against about 115 MB of original WAV files.
- `tools/audio/rock_sfx.py`: generates the stone impact sounds (needs Python + NumPy + SciPy).
- `tools/prefab/`: the generator that made the first version of the prefabs, and the UI
  sprite-frame metas. Running it again overwrites changes made in the editor.

---

## Credits

Thanks to the artists whose free assets are used in this game. All packs were downloaded from itch.io; please follow each author's license if you reuse them.

### Art

| Asset | Author | Used for | License |
|---|---|---|---|
| [Spire Tower Pack 1](https://foozlecc.itch.io/spire-tower-pack-1) and [Spire Tower Pack 2](https://foozlecc.itch.io/spire-tower-pack-2) | Baldur / [Foozle](https://foozlecc.itch.io) | Defense tower sprites | CC0 |
| Monster sprites | Baldur / [Foozle](https://foozlecc.itch.io) (same source as the towers) | Monsters | CC0 |
| PVFX Foundry 1.0.0 | Pixel VFX Studio (made with the [pixelfx](https://github.com/patch-gg/pixelfx) toolkit, MIT) | Active skill effects (`sprites/skills`) | CC0 |
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
