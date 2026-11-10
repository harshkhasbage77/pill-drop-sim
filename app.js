/* Controls + drawing for the pill drop. All physics lives in physics.js. */
(function () {
  'use strict';
  const P = window.PillPhysics;
  const S = P.STANDARD_ENV;
  const $ = (id) => document.getElementById(id);

  // ---------------------------------------------------------------- controls

  const MEDIUMS = [
    { name: 'Air (sea level, 15 °C)', rho: 1.225, mu: 1.81e-5 },
    { name: 'No air (vacuum)', rho: 0, mu: 0 },
    { name: 'Water (20 °C)', rho: 998, mu: 1.0e-3 },
    { name: 'Olive oil', rho: 910, mu: 0.08 },
    { name: 'Honey', rho: 1420, mu: 10 },
  ];

  // reset: true  = changing it restarts the drop
  // scale 'log'  = slider moves in multiples (for values that span many sizes)
  // zero: true   = far-left of a log slider means exactly 0
  const GROUPS = [
    { title: 'Launch', note: 'Changing these restarts the drop.', open: true, items: [
      { id: 'height', label: 'Building height', unit: 'm', min: 2, max: 300, step: 1, def: 40, reset: true },
      { id: 'speed', label: 'Throw speed', unit: 'm/s', min: 0, max: 40, step: 0.5, def: 5, reset: true, hint: '0 = just let go' },
      { id: 'angle', label: 'Throw angle', unit: '°', min: -90, max: 90, step: 1, def: 30, reset: true,
        hint: '0 = straight out, 90 = straight up, −90 = straight down' },
      { id: 'tilt', label: 'Pill start angle', unit: '°', min: -180, max: 180, step: 1, def: 90, reset: true,
        hint: '0 = metal end down, 90 = lying flat (metal end away from building), 180 = metal end up' },
      { id: 'spin', label: 'Start spin', unit: '°/s', min: -1080, max: 1080, step: 10, def: 0, reset: true,
        hint: '+ = turns anti-clockwise' },
    ] },
    { title: 'Pill', note: 'Changing these restarts the drop.', open: true, items: [
      { id: 'length', label: 'Length', unit: 'cm', min: 1, max: 100, step: 0.5, def: 20, reset: true },
      { id: 'diameter', label: 'Thickness', unit: 'cm', min: 0.5, max: 50, step: 0.5, def: 6, reset: true,
        hint: 'If thicker than the length, it is cut to the length (a ball).' },
      { id: 'metalDensity', label: 'Metal half', unit: 'kg/m³', min: 1000, max: 22000, step: 10, def: 7850, reset: true,
        presets: [['Steel', 7850], ['Aluminium', 2700], ['Copper', 8960], ['Lead', 11340], ['Tungsten', 19300]] },
      { id: 'plasticDensity', label: 'Plastic half', unit: 'kg/m³', min: 10, max: 2000, step: 5, def: 1050, reset: true,
        presets: [['ABS plastic (solid)', 1050], ['Polypropylene (solid)', 900], ['Hollow plastic shell', 300], ['Foam', 50]] },
    ] },
    { title: 'World', note: 'Changes apply right away, even mid-fall.', open: true, standard: true, items: [
      { id: 'g', label: 'Gravity', unit: 'm/s²', min: 0, max: 30, step: 0.01, def: S.g,
        presets: [['Earth (standard)', 9.80665], ['Moon', 1.62], ['Mars', 3.71], ['Jupiter', 24.79]] },
      { id: 'medium', type: 'medium' },
      { id: 'rho', label: 'Fluid density', unit: 'kg/m³', min: 0.01, max: 2000, scale: 'log', zero: true, def: S.rho,
        hint: 'How heavy the air or liquid is. Drives drag and buoyancy.' },
      { id: 'mu', label: 'Viscosity (thickness)', unit: 'Pa·s', min: 1e-6, max: 100, scale: 'log', zero: true, def: S.mu,
        hint: 'How sticky the fluid is. Air is tiny, honey is big.' },
      { id: 'wind', label: 'Wind / current', unit: 'm/s', min: -30, max: 30, step: 0.5, def: S.wind,
        hint: '+ = blows away from the building' },
    ] },
    { title: 'Calibration', note: 'Tune the resistance to match a real test. Applies right away.', open: false, standard: true, items: [
      { id: 'dragMult', label: 'Pressure drag ×', unit: '', min: 0, max: 10, step: 0.05, def: S.dragMult, hint: '1 = normal, 0 = off' },
      { id: 'viscMult', label: 'Viscous drag ×', unit: '', min: 0, max: 10, step: 0.05, def: S.viscMult, hint: '1 = normal, 0 = off' },
      { id: 'cdSide', label: 'Drag coefficient, side-on', unit: 'Cd', min: 0, max: 2.5, step: 0.05, def: S.cdSide,
        hint: 'Flow across the pill. About 1.0 for a cylinder.' },
      { id: 'cdEnd', label: 'Drag coefficient, end-on', unit: 'Cd', min: 0, max: 2, step: 0.05, def: S.cdEnd,
        hint: 'Flow along the pill. About 0.4 for a rounded nose.' },
      { id: 'restitution', label: 'Bounce', unit: '', min: 0, max: 1, step: 0.05, def: S.restitution,
        hint: '0 = no bounce, 1 = perfect bounce' },
      { id: 'friction', label: 'Ground grip', unit: '', min: 0, max: 1.5, step: 0.05, def: S.friction,
        hint: '0 = ice, about 1 = rubber on concrete' },
    ] },
    { title: 'Playback', open: true, items: [
      { id: 'timeScale', label: 'Playback speed', unit: '×', min: 0.05, max: 20, scale: 'log', def: 1,
        hint: '0.1 = slow motion, 10 = fast forward. Does not change the physics.' },
    ] },
  ];

  const CTL = {};
  const values = {};
  const ui = {};

  const fmt = (x) => (x === 0 ? '0' : String(+x.toPrecision(6)));

  function fromPos(c, pos) {
    pos = +pos;
    if (c.scale !== 'log') return pos;
    if (c.zero) return pos === 0 ? 0 : c.min * Math.pow(c.max / c.min, (pos - 1) / 999);
    return c.min * Math.pow(c.max / c.min, pos / 1000);
  }

  function toPos(c, x) {
    if (c.scale !== 'log') return x;
    if (c.zero && x <= 0) return 0;
    const t = Math.min(1, Math.max(0, Math.log(Math.max(x, c.min) / c.min) / Math.log(c.max / c.min)));
    return c.zero ? 1 + Math.round(t * 999) : Math.round(t * 1000);
  }

  function buildControl(c) {
    const wrap = document.createElement('div');
    wrap.className = 'ctl';
    wrap.innerHTML = `
      <div class="ctl-top">
        <label for="n-${c.id}">${c.label}</label>
        <span class="ctl-val"><input id="n-${c.id}" type="number" step="any"><span class="unit">${c.unit}</span></span>
      </div>
      ${c.presets ? '<select aria-label="Preset"></select>' : ''}
      <input type="range" aria-label="${c.label}">
      ${c.hint ? `<div class="hint">${c.hint}</div>` : ''}`;

    const num = wrap.querySelector('input[type=number]');
    const range = wrap.querySelector('input[type=range]');
    const sel = wrap.querySelector('select');

    if (c.scale === 'log') Object.assign(range, { min: 0, max: 1000, step: 1 });
    else Object.assign(range, { min: c.min, max: c.max, step: c.step });

    range.addEventListener('input', () => {
      let x = fromPos(c, range.value);
      if (c.scale === 'log' && x !== 0) x = +x.toPrecision(3);
      setValue(c.id, x);
    });
    num.addEventListener('change', () => setValue(c.id, parseFloat(num.value)));
    if (sel) {
      sel.innerHTML = c.presets.map(([n, v]) => `<option value="${v}">${n} — ${fmt(v)} ${c.unit}</option>`).join('')
        + '<option value="">Custom</option>';
      sel.addEventListener('change', () => { if (sel.value !== '') setValue(c.id, parseFloat(sel.value)); });
    }
    ui[c.id] = { num, range, sel };
    return wrap;
  }

  function buildMedium() {
    const wrap = document.createElement('div');
    wrap.className = 'ctl';
    wrap.innerHTML = `
      <div class="ctl-top"><label for="medium">Falls through</label></div>
      <select id="medium"></select>
      <div class="hint">Sets fluid density and viscosity below.</div>`;
    const sel = wrap.querySelector('select');
    sel.innerHTML = MEDIUMS.map((m, i) => `<option value="${i}">${m.name}</option>`).join('')
      + '<option value="">Custom</option>';
    sel.addEventListener('change', () => {
      if (sel.value === '') return;
      const m = MEDIUMS[+sel.value];
      setValue('rho', m.rho);
      setValue('mu', m.mu);
    });
    ui.medium = { sel };
    return wrap;
  }

  function buildControls() {
    const root = $('controls');
    for (const g of GROUPS) {
      const det = document.createElement('details');
      det.className = 'group';
      det.open = g.open;
      det.innerHTML = `<summary>${g.title}</summary>${g.note ? `<div class="gnote">${g.note}</div>` : ''}`;
      for (const c of g.items) {
        if (c.type === 'medium') { det.appendChild(buildMedium()); continue; }
        c.group = g;
        CTL[c.id] = c;
        values[c.id] = c.def;
        det.appendChild(buildControl(c));
      }
      root.appendChild(det);
    }
    Object.keys(CTL).forEach(syncControl);
    syncMedium();
  }

  const near = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

  function syncControl(id) {
    const c = CTL[id], x = values[id], el = ui[id];
    if (document.activeElement !== el.num) el.num.value = fmt(x);
    el.range.value = toPos(c, x);
    if (el.sel) {
      const hit = c.presets.find(([, v]) => near(v, x));
      el.sel.value = hit ? String(hit[1]) : '';
    }
  }

  function syncMedium() {
    const i = MEDIUMS.findIndex((m) => near(m.rho, values.rho) && near(m.mu, values.mu));
    ui.medium.sel.value = i >= 0 ? String(i) : '';
  }

  function setValue(id, x) {
    const c = CTL[id];
    if (!Number.isFinite(x)) x = values[id];
    x = Math.min(c.max, Math.max(c.zero ? 0 : c.min, x));
    values[id] = x;
    syncControl(id);
    if (id === 'rho' || id === 'mu') syncMedium();
    if (c.reset) resetSim();
  }

  // ---------------------------------------------------------------- simulation

  const params = () => ({
    height: values.height,
    speed: values.speed,
    angle: values.angle,
    tilt: values.tilt,
    spin: values.spin,
    length: values.length / 100,
    diameter: values.diameter / 100,
    metalDensity: values.metalDensity,
    plasticDensity: values.plasticDensity,
  });

  const env = () => ({
    g: values.g, rho: values.rho, mu: values.mu, wind: values.wind,
    dragMult: values.dragMult, viscMult: values.viscMult, cdSide: values.cdSide, cdEnd: values.cdEnd,
    restitution: values.restitution, friction: values.friction,
  });

  const TICKS_PER_FRAME = 40000; // above this, playback slows down instead of freezing the page
  const GHOST_EVERY = 0.25;      // s

  let body, st, running = false, slow = false;
  let trail = [], ghosts = [], nextGhost = 0, track = null;

  function resetSim() {
    running = false;
    slow = false;
    const p = params();
    body = P.makeBody(p);
    st = P.makeStart(p, body);
    trail = [[st.x, st.y]];
    ghosts = [];
    nextGhost = GHOST_EVERY;
    track = { minX: st.x, maxX: st.x, maxY: st.y };
    cam.snap = true;
    updatePlayButton();
  }

  function advanceFrame(realDt) {
    const e = env();
    const stopOnImpact = $('stopOnImpact').checked;
    let left = realDt * values.timeScale;
    let budget = TICKS_PER_FRAME;
    slow = false;
    while (left > 1e-9 && !st.done) {
      if (budget <= 0) { slow = true; break; }
      const chunk = Math.min(left, 1 / 120);
      budget -= P.advance(st, body, e, chunk, { stopOnImpact, maxSteps: budget });
      left -= chunk;

      trail.push([st.x, st.y]);
      if (trail.length > 20000) trail.splice(0, trail.length - 20000);
      while (st.t >= nextGhost) {
        ghosts.push({ x: st.x, y: st.y, th: st.th });
        nextGhost += GHOST_EVERY;
      }
      if (ghosts.length > 400) ghosts.shift();
      track.minX = Math.min(track.minX, st.x);
      track.maxX = Math.max(track.maxX, st.x);
      track.maxY = Math.max(track.maxY, st.y);
    }
    if (st.done) {
      running = false;
      updatePlayButton();
    }
  }

  function updatePlayButton() {
    const label = running ? '❚❚ Pause' : st.done ? '▶ Play again' : st.t > 0 ? '▶ Resume' : '▶ Play';
    $('play').textContent = label;
  }

  function togglePlay() {
    if (st.done) resetSim();
    running = !running;
    updatePlayButton();
  }

  // ---------------------------------------------------------------- drawing

  const scene = $('scene'), ctx = scene.getContext('2d');
  const inset = $('inset'), ictx = inset.getContext('2d');
  const cam = { ppm: 10, ox: 0, gy: 0, snap: true };

  function fitCanvas(cv, c) {
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth, h = cv.clientHeight;
    const pw = Math.round(w * dpr), ph = Math.round(h * dpr);
    if (cv.width !== pw || cv.height !== ph) { cv.width = pw; cv.height = ph; }
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    return [w, h];
  }

  // Fit building + flight path; keep the right side free for the side cards.
  function updateCamera(W, H) {
    const h = values.height, bw = P.buildingWidth(h);
    const side = W > 800 ? 270 : 0;
    const pad = Math.max(2, h * 0.08);
    const xMin = Math.min(-bw - pad, track.minX - pad);
    const xMax = Math.max(h * 0.8, track.maxX + pad);
    const yMax = Math.max(h, track.maxY) * 1.1 + 1;
    const ground = 40;
    const ppm = Math.min((W - side) / (xMax - xMin), (H - ground) / yMax);
    const target = { ppm, ox: -xMin * ppm, gy: H - ground };
    if (cam.snap) { Object.assign(cam, target); cam.snap = false; return; }
    cam.ppm += (target.ppm - cam.ppm) * 0.08;
    cam.ox += (target.ox - cam.ox) * 0.08;
    cam.gy = target.gy;
  }
  const X = (x) => cam.ox + x * cam.ppm;
  const Y = (y) => cam.gy - y * cam.ppm;

  function fluidTint() {
    if (values.rho < 50) return null;
    if (values.mu > 0.05) return `rgba(205, 140, 30, ${0.25 + 0.08 * Math.min(3, Math.log10(values.mu / 0.05))})`;
    return 'rgba(30, 110, 200, 0.3)';
  }

  function capsulePath(c, r, lc, from, to) {
    // from/to: 'plastic' half (-x), 'metal' half (+x), or full outline
    c.beginPath();
    if (from === 'metal') {
      c.moveTo(0, -r); c.lineTo(lc, -r); c.arc(lc, 0, r, -Math.PI / 2, Math.PI / 2); c.lineTo(0, r);
    } else if (from === 'plastic') {
      c.moveTo(0, -r); c.lineTo(-lc, -r); c.arc(-lc, 0, r, -Math.PI / 2, Math.PI / 2, true); c.lineTo(0, r);
    } else {
      c.moveTo(-lc, -r); c.lineTo(lc, -r); c.arc(lc, 0, r, -Math.PI / 2, Math.PI / 2);
      c.lineTo(-lc, r); c.arc(-lc, 0, r, Math.PI / 2, (3 * Math.PI) / 2);
    }
    c.closePath();
  }

  // (sx, sy) = screen position of the balance point; k = pixels per metre.
  function drawPill(c, sx, sy, th, k, alpha) {
    const r = body.r * k, lc = body.lCyl * k;
    c.save();
    c.translate(sx, sy);
    c.rotate(-th);
    c.translate(-body.sCom * k, 0);
    c.globalAlpha = alpha;
    capsulePath(c, r, lc, 'plastic');
    c.fillStyle = '#ff9f43';
    c.fill();
    capsulePath(c, r, lc, 'metal');
    const gr = c.createLinearGradient(0, -r, 0, r);
    gr.addColorStop(0, '#c9ced6');
    gr.addColorStop(0.45, '#f1f3f6');
    gr.addColorStop(1, '#6e757f');
    c.fillStyle = gr;
    c.fill();
    capsulePath(c, r, lc, 'full');
    c.lineWidth = 1.2;
    c.strokeStyle = '#2b2f36';
    c.stroke();
    c.restore();
  }

  function niceStep(minMetres) {
    for (const s of [1, 2, 5, 10, 20, 50, 100, 200]) if (s >= minMetres) return s;
    return 500;
  }

  function drawBuilding() {
    const h = values.height, bw = P.buildingWidth(h);
    const x0 = X(-bw), x1 = X(0), y0 = Y(0), y1 = Y(h);
    ctx.fillStyle = '#9aa3ad';
    ctx.fillRect(x0, y1, x1 - x0, y0 - y1);

    const floorH = 3, fpx = floorH * cam.ppm;
    if (fpx >= 6) {
      ctx.fillStyle = 'rgba(40, 60, 90, 0.5)';
      const cols = Math.max(1, Math.floor(bw / 3)), cw = (x1 - x0) / cols;
      for (let f = 0; f < Math.floor(h / floorH); f++) {
        for (let col = 0; col < cols; col++) {
          ctx.fillRect(x0 + col * cw + cw * 0.25, Y((f + 1) * floorH) + fpx * 0.25, cw * 0.5, fpx * 0.45);
        }
      }
    }
    ctx.fillStyle = '#59626d';
    ctx.fillRect(x0, y1 - 4, x1 - x0, 4); // roof edge

    // Height scale on the wall.
    const step = niceStep(32 / cam.ppm);
    ctx.strokeStyle = '#fff';
    ctx.fillStyle = '#fff';
    ctx.lineWidth = 1;
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let y = step; y < h - step * 0.3; y += step) {
      ctx.beginPath();
      ctx.moveTo(x1 - 7, Y(y));
      ctx.lineTo(x1, Y(y));
      ctx.stroke();
      if (x1 - x0 > 40) ctx.fillText(`${y} m`, x1 - 10, Y(y));
    }
  }

  function drawWind(W) {
    const w = values.wind;
    if (Math.abs(w) < 0.1) return;
    const len = Math.min(70, 8 + Math.abs(w) * 3) * Math.sign(w);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.lineWidth = 2;
    const right = W > 800 ? W - 290 : W - 20;
    for (let i = 0; i < 3; i++) {
      const x = right - 90 - i * 120, y = 70 + (i % 2) * 18;
      arrowLine(ctx, x, y, x + len, y);
    }
    ctx.font = '12px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(`wind ${w > 0 ? '→' : '←'} ${Math.abs(w)} m/s`, right - 330, 102);
  }

  function arrowLine(c, x0, y0, x1, y1) {
    const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy);
    if (len < 3) return;
    const ux = dx / len, uy = dy / len, hd = Math.min(9, len * 0.4);
    c.beginPath();
    c.moveTo(x0, y0);
    c.lineTo(x1, y1);
    c.stroke();
    c.beginPath();
    c.moveTo(x1, y1);
    c.lineTo(x1 - hd * ux - hd * 0.5 * uy, y1 - hd * uy + hd * 0.5 * ux);
    c.lineTo(x1 - hd * ux + hd * 0.5 * uy, y1 - hd * uy - hd * 0.5 * ux);
    c.closePath();
    c.fill();
  }

  function drawScene() {
    const [W, H] = fitCanvas(scene, ctx);
    updateCamera(W, H);

    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#8ec5ff');
    sky.addColorStop(1, '#dff0ff');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);
    const tint = fluidTint();
    if (tint) { ctx.fillStyle = tint; ctx.fillRect(0, 0, W, H); }

    ctx.fillStyle = '#6b8e4e';
    ctx.fillRect(0, cam.gy, W, H - cam.gy);
    ctx.fillStyle = '#56763d';
    ctx.fillRect(0, cam.gy, W, 3);

    drawBuilding();
    drawWind(W);

    const drawScale = Math.max(1, 48 / (body.length * cam.ppm));
    const k = cam.ppm * drawScale;

    if ($('showTrail').checked && trail.length > 1) {
      ctx.strokeStyle = 'rgba(30, 40, 60, 0.5)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(X(trail[0][0]), Y(trail[0][1]));
      for (const [x, y] of trail) ctx.lineTo(X(x), Y(y));
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if ($('showGhosts').checked) {
      for (const g of ghosts) drawPill(ctx, X(g.x), Y(g.y), g.th, k, 0.22);
    }

    if (st.impact) {
      const ix = X(st.impact.x);
      ctx.strokeStyle = '#e5484d';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(ix, cam.gy - 6);
      ctx.lineTo(ix, cam.gy + 10);
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = '12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(`first hit · ${st.impact.x.toFixed(1)} m from wall`, ix, cam.gy + 14);
    }

    drawPill(ctx, X(st.x), Y(st.y), st.th, k, 1);

    $('scaleNote').textContent = drawScale > 1.5
      ? `Pill drawn ${Math.round(drawScale)}× bigger than real so you can see it (physics uses the real size).`
      : '';
  }

  function drawInset() {
    const [W, H] = fitCanvas(inset, ictx);
    const cx = W / 2, cy = H / 2;
    ictx.clearRect(0, 0, W, H);

    ictx.beginPath();
    ictx.arc(cx, cy, W / 2 - 2, 0, Math.PI * 2);
    ictx.fillStyle = 'rgba(142, 197, 255, 0.35)';
    ictx.fill();
    const tint = fluidTint();
    if (tint) { ictx.fillStyle = tint; ictx.fill(); }

    const k = Math.min((W * 0.55) / (2 * body.halfLen), (W * 0.4) / body.diameter);
    drawPill(ictx, cx, cy, st.th, k, 1);

    const ux = Math.cos(st.th), uy = Math.sin(st.th);
    const mx = cx - body.sCom * k * ux, my = cy + body.sCom * k * uy;

    // Arrows are scaled against the largest force, so you can compare them.
    const e = env();
    const f = P.computeForces(st, body, e);
    const weight = body.mass * e.g;
    const fluidX = f.dragX, fluidY = f.dragY + f.buoy;
    const ref = Math.max(weight, Math.hypot(fluidX, fluidY), 1e-12);
    const L = W * 0.34;

    ictx.lineWidth = 2;
    const speed = Math.hypot(st.vx, st.vy);
    if (speed > 0.01) {
      ictx.strokeStyle = '#555';
      ictx.fillStyle = '#555';
      ictx.setLineDash([4, 3]);
      arrowLine(ictx, cx, cy, cx + (L * st.vx) / speed, cy - (L * st.vy) / speed);
      ictx.setLineDash([]);
    }
    ictx.lineWidth = 3;
    ictx.strokeStyle = ictx.fillStyle = '#2f6fde';
    arrowLine(ictx, mx, my, mx + (L * fluidX) / ref, my - (L * fluidY) / ref);
    ictx.strokeStyle = ictx.fillStyle = '#e5484d';
    arrowLine(ictx, cx, cy, cx, cy + (L * weight) / ref);

    ictx.beginPath();
    ictx.arc(mx, my, 3.5, 0, Math.PI * 2);
    ictx.fillStyle = '#2f6fde';
    ictx.fill();
    ictx.beginPath();
    ictx.arc(cx, cy, 4, 0, Math.PI * 2);
    ictx.fillStyle = '#111';
    ictx.fill();
    ictx.lineWidth = 2;
    ictx.strokeStyle = '#fff';
    ictx.stroke();
  }

  // ---------------------------------------------------------------- readouts

  const row = (k, v) => `<div class="k">${k}</div><div class="v">${v}</div>`;
  const note = (t) => `<div class="full">${t}</div>`;
  const sec = (t) => `<div class="sec">${t}</div>`;
  const kg = (m) => (m < 1 ? `${(m * 1000).toFixed(0)} g` : `${m.toFixed(2)} kg`);

  function lowestPoint() {
    const uy = Math.sin(st.th);
    const a = st.y + (body.lCyl - body.sCom) * uy, b = st.y + (-body.lCyl - body.sCom) * uy;
    return Math.min(a, b) - body.r;
  }

  function regime(re) {
    if (values.rho === 0) return 'No fluid, so no drag.';
    if (Math.hypot(st.vx - values.wind, st.vy) < 0.01) return 'Not moving through the fluid.';
    if (re < 1) return 'Thick-fluid zone: viscous drag wins.';
    if (re < 1000) return 'Middle zone: both kinds of drag matter.';
    return 'Fast zone: pressure drag wins.';
  }

  function updateReadouts() {
    const e = env();
    const re = P.reynolds(st, body, e);
    const term = P.terminalSpeed(body, e);
    const tilt = P.tiltDeg(st.th);

    let termText;
    if (term === -1) termText = 'floats up';
    else if (term === Infinity) termText = 'no limit';
    else termText = `${term.toFixed(2)} m/s`;

    let html = sec('Now')
      + row('Time', `${st.t.toFixed(2)} s`)
      + row('Height', `${Math.max(0, lowestPoint()).toFixed(2)} m`)
      + row('Speed', `${Math.hypot(st.vx, st.vy).toFixed(2)} m/s`)
      + row('Pill angle', `${tilt.toFixed(0)}°`)
      + note('0° = metal end straight down, 90° = flat')
      + row('Spin', `${((st.w * 180) / Math.PI).toFixed(0)} °/s`)
      + row('Reynolds no.', Number.isFinite(re) ? (re < 10 ? re.toFixed(2) : Math.round(re).toLocaleString()) : '∞')
      + note(regime(re));

    html += sec('First ground hit');
    if (st.impact) {
      const im = st.impact;
      const what = im.tilt > 75 && im.tilt < 105 ? 'side (almost flat)' : `${im.end} end`;
      html += row('After', `${im.t.toFixed(2)} s`)
        + row('Speed', `${im.speed.toFixed(2)} m/s`)
        + row('Hit with', what)
        + row('Angle', `${im.tilt.toFixed(0)}°`);
    } else {
      html += note('Not yet.');
    }

    html += sec('Pill')
      + row('Metal half', kg(body.massMetal))
      + row('Plastic half', kg(body.massPlastic))
      + row('Total', kg(body.mass))
      + row('Balance point', `${(body.sCom * 100).toFixed(1)} cm`)
      + note('from the middle, toward the metal end')
      + row('Top speed', termText)
      + note('Fastest it can fall, metal end first.');

    $('readouts').innerHTML = html;

    let status;
    if (running) status = st.impact ? 'Bouncing / settling…' : 'Falling…';
    else if (st.done === 'landed') status = 'Landed and stopped';
    else if (st.done === 'impact') status = 'Stopped at first ground hit';
    else if (st.done === 'floated') status = 'Floated away: lighter than the fluid';
    else if (st.done === 'timeout') status = 'Stopped after 10 minutes of sim time';
    else if (st.t > 0) status = 'Paused';
    else status = 'Ready: press Play (or Space)';
    if (running && slow) status += ' (slower than real time: heavy settings)';
    $('status').textContent = status;
  }

  // ---------------------------------------------------------------- main loop

  let lastTs = null, frameNo = 0;
  function frame(ts) {
    const realDt = lastTs == null ? 0 : Math.min(0.05, (ts - lastTs) / 1000);
    lastTs = ts;
    if (running && !st.done) advanceFrame(realDt);
    drawScene();
    drawInset();
    if (frameNo++ % 3 === 0) updateReadouts();
    requestAnimationFrame(frame);
  }

  $('play').addEventListener('click', togglePlay);
  $('reset').addEventListener('click', resetSim);
  $('standard').addEventListener('click', () => {
    for (const c of Object.values(CTL)) if (c.group.standard) setValue(c.id, c.def);
  });
  window.addEventListener('keydown', (ev) => {
    const tag = (ev.target && ev.target.tagName) || '';
    if (['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON', 'SUMMARY'].includes(tag)) return;
    if (ev.code === 'Space') { ev.preventDefault(); togglePlay(); }
    if (ev.key === 'r' || ev.key === 'R') resetSim();
  });

  // For scripted checks: window.pillSim.run(seconds) steps the sim without waiting for frames.
  window.pillSim = {
    setValue,
    run(seconds) {
      running = true;
      for (let i = 0; i < seconds * 60 && running; i++) advanceFrame(1 / 60 / values.timeScale);
      updatePlayButton();
    },
  };

  buildControls();
  resetSim();
  if (location.hash === '#autoplay') togglePlay(); // index.html#autoplay starts right away
  requestAnimationFrame(frame);
})();
