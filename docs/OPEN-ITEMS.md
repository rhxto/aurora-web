# Open items

## Waiting for material

- FRED mission patch and mission description (the FRED page uses only facts already on the site).
- Formtec logo file and website.
- Department photos (planned) and any further CAD renders without background.

The automated review round was stopped early (2 Oct 2026). All 18 pages build, load without console errors on desktop and mobile, and pass the content/link checks. The desktop review below ran against the build *before* the last fixes, so some items may already be solved — reproduce before working on one.

## Major

- **Altimeter edge shade overlaps the content column and visibly dims the hero wordmark, slogan, body copy and a footer icon** (integration; / (and every page with the full altimeter))
- **Row titles overflow at narrow desktop widths: BOREALIS runs into its patch, NEMESIS crosses the frame line to the viewport edge** (projects; /projects/)
- **Altimeter backing shade darkens the right 24-72 px of the content column (white plots, logo plates, headings, body text, e-mail block)** (integration; all pages)

## Minor

- **Sub-page hero bottom-right corner bracket sits inside the altimeter ruler and reads as a stray tick** (integration; /projects/ (sub-page hero, all sub-pages share it))
- **Trajectory marker is drawn on top of the mission patch artwork as it travels** (home; / flight timeline (#projects))
- **Roll-out finishes too late: no scroll position shows a whole row with its rocket parked** (projects; /projects/)
- **Row hover spotlight is clipped to the row box, leaving hard straight edges** (projects; /projects/)
- **Specs row breaks 4 + 1, leaving the fifth spec orphaned on its own line** (projects; /projects/nemesis/, /projects/atlas/)
- **Nemesis drawing's patterned bay renders as pink static noise at display size** (projects; /projects/ (Nemesis row) and /projects/nemesis/ (blueprint))
- **Panel figures (plots/renders) reserve no height before the lazy image loads -> layout jumps by 125-304 px** (integration; /departments/ and /departments/aerodinamica/ (any page using)
- **Lock-on 'LOCK' tag covers the text directly above the locked element** (integration; /departments/<slug>/ (TOC) and /contact/ (e-mail block))
- **Step title 'GUIDANCE NAVIGATION and CONTROL' wraps to two lines and leaves 107 px holes between the red stepped lines and the text** (integration; /departments/gnc/)
- **Uppercased caption turns the sigma into a capital Sigma: '1Σ, 2Σ AND 3Σ DISPERSION ELLIPSES'** (departments; /departments/ (row 06 Mission Analysis; same figure on /depa)
- **Orbital map info card opens below the fold and closes as soon as the user scrolls to read it** (departments; /departments/)
- **WD-40 logo shows a grey rectangle under the shield on the light plate** (partners-contact; /partners/ (Technical partners, plate 12))
- **Duplicate id="main": the first tier section reuses the id of <main>** (partners-contact; /partners/)

## Polish

- **The shrinking video frame's bottom edge sweeps through the kicker/slogan row** (home; / hero)
- **Camera OSD tags lose contrast over the bright footage** (home; / hero in camera-feed state)
- **Sub-page hero photo is upscaled and its central subject ends up behind the title on very wide screens** (integration; /projects/ sub-page hero)
- **Lock-on tag and parked cursor rocket cover neighbouring blueprint labels** (integration; /projects/nemesis/ (blueprint legend and hotspots))
- **Blueprint micro-labels are set at 8-9.6 px** (projects; /projects/<slug>/ (blueprint sheet))
- **Section rail appears while the table of contents is still on screen: two numbered lists side by side with mismatched rows** (departments; /departments/<slug>/ (lead block))
- **Emmetre and Nuova Andrea logos are dominated by illegible micro-text and read weaker than their neighbours** (partners-contact; /partners/ (Technical partners, plates 09 and 10))
- **Copy confirmation message appears ~700 px away from the button, at the far right edge** (partners-contact; /contact/)

## Not tested

- Firefox (headless Firefox does not start on the dev machine); real phones; real Safari (only Playwright WebKit).
