# Content notes

All copy in `content/site.json` was taken from the live site (aurorarocketry.eu, as published on 24 May 2026).
The wording is unchanged except for the mechanical fixes below (typos, missing spaces, casing). Nothing was added or removed.

| Original | Used here |
|---|---|
| `1kg` | `1 kg` |
| `assembly in mind.The` | `assembly in mind. The` |
| `SRAD(Student` | `SRAD (Student` |
| `COTS(Commercial` | `COTS (Commercial` |
| `biological responses` | `biological responses.` |
| `Chemical Engineering.The department’s` | `Chemical Engineering.↵ (new paragraph) The department’s` |
| `Aurora Rocketry.The process` | `Aurora Rocketry.↵ (new paragraph) The process` |
| `acquireambient data,and` | `acquire ambient data, and` |
| `such asthe` | `such as the` |
| `[electronics overview paragraph was duplicated]` | `[kept once]` |
| `potassium nitrate -and sorbitol-based` | `potassium nitrate- and sorbitol-based` |
| `enhance performance.In parallel` | `enhance performance.↵ (new paragraph) In parallel` |
| `higher-performance motors` | `higher-performance motors.` |
| `safety valves.Each component` | `safety valves.↵ (new paragraph) Each component` |
| `integrated into REDAS` | `integrated into REDAS.` |
| `research area 'and external` | `research area is external` |
| `(cfd)` | `(CFD)` |
| `(cd mach curve)` | `(CD–Mach curve)` |
| `”validation cases”` | `“validation cases”` |
| `n support of these` | `In support of these` |
| `behavior on the ground` | `behavior on the ground.` |
| `GNC , Propulsion` | `GNC, Propulsion` |
| `usability standpoint` | `usability standpoint.` |
| `it’s own` | `its own` |
| `on board,such as the payload,recovery` | `on board, such as the payload, recovery` |
| `Wecover` | `We cover` |
| `pcb schematics` | `PCB schematics` |
| `fullyintegrated` | `fully integrated` |
| `simulations,recover the rocket,and` | `simulations, recover the rocket, and` |
| `what’sgoing on.In order to do that,we` | `what’s going on. In order to do that, we` |
| `telemetryand` | `telemetry and` |
| `componentsselection` | `components selection` |
| `Linkedin` | `LinkedIn` |
| `reach Aurora’s goals` | `reach Aurora’s goals.` |
| `stickers ect...` | `stickers, etc.` |
| `GROUD TESTING` | `GROUND TESTING` |
| `GUIDNCE` | `GUIDANCE` |
| `AERODYNAMIC (department name / button)` | `AERODYNAMICS` |
| `DISCOVER ELECTRONIC` | `DISCOVER ELECTRONICS` |
| `adress` | `address` |
| `belive` | `believe` |
| `possibilty` | `possibility` |
| `journey ,` | `journey,` |

## Left untouched on purpose

- "The simulation phase is crucial for **maximizing the aircraft's mass**" (Structure → FEM): probably meant *optimizing/minimizing*, but it is a content decision, so it was not changed.
- "SENSORS and MICROCONTROLLERS" (Electronics) has a heading and a picture but no body text on the live site.
- "with a selection that varies as a function of case of specific study and of the geometric complex of the system" (Aerodynamics): awkward but kept verbatim.
- The footer still says "© 2024".
- Homepage counters: 90+ students, 3 campuses, 8+ sponsors (the live site animates them from 0; the targets were read from its code).

## Assets

- Photos were downloaded from the live site at max 2048 px and re-encoded to WebP (1600 px + 800 px variants).
- The hero video was re-encoded from 44 MB (1080p) to ~7 MB (720p, no audio).
- The original display typeface (Integral CF, commercial) is replaced by **Archivo** expanded black; body text uses Space Grotesk as on the original. Fonts are self-hosted in `public/fonts`.

## Changes requested by the team (October 2026)

- Home stats: 120+ passionate students, 10+ private sponsors.
- New project **FRED**: only facts already on the site are used (Propulsion department text: reduced-scale prototype, in-house solid motor, potassium nitrate / sorbitol propellant). Its mission patch and mission description are still to be provided; the FRED render stands in for the patch.
- Partners: Emmetre moved to Main sponsors; Cofert moved to Strategic partners; Formtec added to Strategic partners (logo file and website still to be provided — the name is shown as a wordmark, without a link).
- Photo descriptions removed: images carry an empty `alt` and figures only show their number. Patches, rocket renders and partner logos keep their names.
- New team photos in a home-page gallery (`public/img/gallery`); transparent CAD renders replace some white-background renders/duplicated photos (aerodynamics, GNC, recovery, Atlas electronics, Borealis structure).
