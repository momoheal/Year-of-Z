# Year of Z (Y 年 Z)

> A narrative exploration game where the zombies never appear on screen · Original story written in Chinese · 100% front-end, zero remote assets

[中文 README → README.md](README.md)

**Year of Z** is a browser-based narrative exploration game adapted from an original long-form
Chinese story. **Chapters 1-3 are now playable.** Chapter 1 *Out the Wall* is an errand without a
gun — a crowbar, qualified pallets, a wire-mesh pen and a paper list. Chapter 2 *Two Kilometres*
hauls a handcart to Liu'anli and brings back seven sacks of rice. Chapter 3 *Not Cooking Today*
walks into a makeshift kitchen on Dongjie Street and into the game's **only fight**: no gun, no
combo kills, no pursuit — only backing away, blocking, and a knife that isn't yours.

> 🌿 **Play online**: [momoheal.github.io/Year-of-Z](https://momoheal.github.io/Year-of-Z/) (automatically deployed from `main` by GitHub Pages).

---

## ✨ Features

- **30 narrative nodes across 3 chapters**: Ch.1 (12) gate handover → side door → warehouse choice →
  qualified pallets → a night in quarantine → homecoming; Ch.2 (12) handcart, underpass, window
  handover at Liu'anli, the sack lost on the steel plate; Ch.3 (6) departure → seventeen bowls →
  the duty-room door → **the encounter** → the follow-up statement → three temporary days
- **The Chapter 3 encounter** (the only combat): real-time dodging plus stamina, on a fixed story
  order — back away → grab the chair → the chair breaks → the knife on the prep counter.
  One attacker only; **no combo kills, no pursuit, no finishing blow**. Being pinned is not a death
  screen — you can retry from the moment the door was pulled open.
- **Isometric orthographic 3D**: three.js + original low-poly geometry + procedural Canvas
  textures — **zero remote assets**, fully playable offline
- **Physics**: cannon-es (circular player proxy, static building boxes, story-gated doors)
- **Dual input**: desktop (WASD / Shift / E / click-to-walk) and mobile touch, portrait & landscape
- **Four lighting presets**: dawn / noon / dusk / night with smooth transitions driven by story time
- **Auto-save**: localStorage with throttled writes and corrupt-save recovery — "Continue" after refresh
- **Workshop**: an isolated overlay with its own renderer and save key — strictly separated from
  chapter state (a narrative red line: the gun never enters Chapter 1's world)
- **Block-figure characters / single-focus smooth camera**: original primitive-built figures have articulated limb motion; camera position and view share one damped focus for stable starts, stops and turns
- **Polish in progress**: fake-AO ground patches, dust motes, NPC story staging

## 🎮 Quick Start

```bash
npm install        # Node.js ≥ 18
npm run dev        # dev server → http://localhost:5173
```

| Command | Description |
| --- | --- |
| `npm run dev` | Dev server (external hosts allowed; preview-sandbox friendly) |
| `npm run build` | Type-check + production build into `dist/` |
| `npm run preview` | Preview the production build locally |
| `npm test` | vitest: 31 cases (17 narrative-kernel + 14 encounter-kernel) |
| `npm run verify` | **Playwright runtime acceptance** (run `npx playwright install chromium` first; walks the key flow and writes 5 screenshots to `shots/`) |
| `npm run pack` | Build & package `dist/` → `release/yoz-*.tar.gz` (cross-platform, pure Node) |

### Jump straight into Chapter 3

The title screen has a **第三章试玩 · 直奔东街** button: chapters 1-2 are auto-completed with their
default choices and you start on the morning of the Dongjie run (this clears the old save).
Append `?jump=fight` to the URL to spawn inside the kitchen with the door about to be pulled open.

### Controls

- **Move**: WASD / arrow keys, Shift to run; or click the ground to set a waypoint
- **Interact**: press **E** near people or objects
- **Encounter (Chapter 3 kitchen only)**: Space / right mouse to **block**, J / left mouse to
  **swing**, E to **grab** what is at hand; mash Space to break free when pinned. Touch users get
  a three-button cluster (block / swing / grab)
- **Inventory / tasks**: I / Tab; **lighting mode**: the on-screen slider (auto · dawn · noon · dusk · night)
- **Mobile**: tap ground to move, tap the on-screen E prompt (landscape recommended)

### Play online (GitHub Pages)

The repo ships `.github/workflows/pages.yml`. After merging to `main`, open
**Settings → Pages → Source: GitHub Actions** and every push to `main` will build `dist/` and
publish to `https://<user>.github.io/Year-of-Z/` (Vite uses a relative `base: './'`, so a
subpath deployment just works).

## 🛠 Tech Stack

TypeScript · Vite 5 · three.js 0.169 · cannon-es · lucide icons · vitest · Playwright (acceptance).
No server, no database, no CDN — the whole game is a static site.

## 📁 Project Layout

```
├── index.html            # DOM shell (UI panels, title screen)
├── src/
│   ├── main.ts           # boot / input / saves / audio / main-loop wiring
│   ├── story.ts          # narrative kernel: node assembly, items, flags, save serialization (pure)
│   ├── data/chapter1-3.ts# per-chapter narrative data (nodes, choices, items, log)
│   ├── combat.ts         # Chapter 3 kitchen encounter kernel (pure state machine, no DOM/three.js)
│   ├── world.ts          # scenes / characters / lighting / physics / animation (12 scenes)
│   ├── mapdata.ts        # single source of truth for collision walls & the kitchen arena
│   ├── workshop.ts       # workshop overlay (own renderer & save)
│   └── style.css         # responsive UI
├── tests/story.test.ts   # narrative-kernel invariants (17 cases)
├── tests/combat.test.ts  # encounter invariants & playability regression (14 cases)
├── scripts/
│   ├── verify.mjs        # Playwright end-to-end acceptance
│   └── pack.mjs          # cross-platform dist archiver (tar.gz)
├── .github/workflows/    # CI (tsc + tests + build) and Pages deploy
└── doc/                  # 27+ Chinese story & design documents (see doc/README.md)
```

## 📖 Docs

Story bible, chapter outlines and design audits live in [`doc/`](doc/README.md) (Chinese):

- [doc/24](doc/24-第一章Demo关卡与交互.md) — Chapter 1 level & interaction spec (12 nodes)
- [doc/25](doc/25-Demo技术路线与验收.md) — tech route & acceptance criteria (with runtime verification notes)
- [doc/27](doc/27-第一章Demo实施记录.md) — Chapter 1 implementation record & known leftovers
- [doc/28](doc/28-第三章Demo实施记录.md) — Chapter 3 implementation record: node table, encounter design & tuning, red-line audit

## ⚠️ Acceptance Status (honesty clause)

Automated checks are green (`tsc`, `vitest` 31/31, `vite build`). The Playwright runtime
acceptance script is in place but has **not yet run in the delivery environment** (Chromium cannot
be downloaded there), and `scripts/verify.mjs` does not cover the Chapter 3 encounter yet.
Combat feel (dodge spacing, lunge telegraph, mash rhythm, touch button placement) still needs a
hands-on pass — see doc/28. Dongjie Street and the observation room are still placeholder sets
with dedicated props. Issues on game feel are very welcome.

## 📄 License

[MIT](LICENSE) © 2026 momoheal
