# Pill drop simulator

A pill-shaped object, half metal (heavy) and half plastic (light), thrown from a roof.
Gravity, air resistance, viscosity, buoyancy, wind, and ground bounce are all included.

## Run

```sh
cd ~/Documents/pill-drop-sim
python3 -m http.server 8765 --bind 127.0.0.1
```

Open http://127.0.0.1:8765. Press **Play** or the Space key. `R` resets.
`http://127.0.0.1:8765/#autoplay` starts right away.

No install, no build step. Plain HTML + JavaScript.

## Files

| File | What it does |
|---|---|
| `physics.js` | All the physics. No drawing. Also runs in Node. |
| `app.js` | Controls, camera, drawing, readouts. |
| `index.html`, `style.css` | Page layout. |

## Physics model

```
weight     → pulls at the balance point (near the metal end)
fluid push → acts at the middle of the pill
middle is behind the balance point → the metal end turns to the front
```

| Force | Formula | Where it acts |
|---|---|---|
| Weight | M·g | balance point |
| Buoyancy | ρ·V·g, up | middle |
| Pressure drag | ½·ρ·Cd·A·v² | each of 32 slices along the pill |
| Viscous drag | 6π·μ·R·v (R = radius of a ball with the same volume) | each slice |
| Ground / wall | impulses with bounce and friction | the end balls |

- 2D: the pill moves in x/y and turns in the screen plane. Masses, areas and volumes are real 3D values.
- Drag across the pill is added up slice by slice. A tilted or spinning pill gets pushed harder on one side, and turns.
- Drag along the pill uses the end-on Cd and passes through the balance point, so it does not turn the pill.
- The time step shrinks on its own when drag is strong (thick fluids, tiny pills). If it gets too heavy,
  playback slows down instead of freezing.

Not modelled: tumbling out of the screen plane, gusts, the fluid moving with the pill ("added mass").

## Checks done

| Check | Result |
|---|---|
| Vacuum drop vs √(2d/g) | 2.8560 s vs 2.8562 s |
| Water / honey top speed vs formula | 5.52 / 1.71 m/s, both match |
| Air: metal end turns to the front | 90° → 36° at impact (vacuum stays 90°) |
| Bounce 0.8 | out/in speed 0.798 |
| Strong wind toward the building | stays outside the wall |
