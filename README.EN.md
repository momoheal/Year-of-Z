# Year of Z (Y 年 Z)

> A narrative exploration game where the zombies never appear on screen · Original story written in Chinese · 100% front-end, zero remote assets

[中文 README → README.md](README.md)

**Year of Z** is a browser-based narrative exploration game adapted from an original long-form
Chinese story. **Chapter 1: Out the Wall (《出墙》) is now playable** — you are Lao Zhou,
the gatekeeper of a logistics park. On the morning of the lockdown you deliver "the last truck",
then walk yourself all the way back inside the walls of your own neighborhood.
No gunshots, no chase — just a crowbar, qualified pallets, a wire-mesh pen and a paper list.

> 🌿 **Play online**: [momoheal.github.io/Year-of-Z](https://momoheal.github.io/Year-of-Z/) (automatically deployed from `main` by GitHub Pages).

---

## ✨ Features

- **12 narrative nodes**, full playthrough: gate handover → borrow the crowbar → open the side door →
  the warehouse choice (settle / hand over) → call the medics → mark qualified pallets →
  observe the mesh pen → rehome the dog → the supply depot → a night in quarantine → homecoming
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
| `npm test` | vitest: 12 narrative-kernel invariants |
| `npm run verify` | **Playwright runtime acceptance** (run `npx playwright install chromium` first; walks the key flow and writes 5 screenshots to `shots/`) |
| `npm run pack` | Build & package `dist/` → `release/yoz-*.tar.gz` (cross-platform, pure Node) |

### Controls

- **Move**: WASD / arrow keys, Shift to run; or click the ground to set a waypoint
- **Interact**: press **E** near people or objects
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
│   ├── story.ts          # narrative kernel: 12 nodes, items, flags, save serialization (pure, testable)
│   ├── world.ts          # scenes / characters / lighting / physics / animation (4 scenes)
│   ├── mapdata.ts        # single source of truth for collision walls (shared by build & tests)
│   ├── workshop.ts       # workshop overlay (own renderer & save)
│   └── style.css         # responsive UI
├── tests/story.test.ts   # narrative-kernel invariants (12 cases)
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
- [doc/27](doc/27-第一章Demo实施记录.md) — implementation records & known leftovers

## ⚠️ Acceptance Status (honesty clause)

Automated checks are green (`tsc`, `vitest` 12/12, `vite build`). The Playwright runtime
acceptance script is in place but has **not yet run in the delivery environment** (no browser
can be installed there). A 10–15-minute human playtest is still pending — see doc/27.
Issues on game feel (walk speed, camera, dust density) are very welcome.

## 📄 License

[MIT](LICENSE) © 2026 momoheal
