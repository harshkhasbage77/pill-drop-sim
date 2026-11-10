/*
 * Pill drop physics.
 *
 * Model: a 2D rigid body (x, y, rotation) that uses real 3D masses, volumes and areas.
 * The pill is a capsule: a cylinder with two half-spheres on the ends.
 *   - the "metal" half points along +u (u = (cos th, sin th))
 *   - the "plastic" half points along -u
 *
 * Forces:
 *   weight      M·g, down, at the balance point (centre of mass)
 *   buoyancy    rho·V·g, up, at the middle of the pill (centre of volume)
 *   drag        pressure drag  ½·rho·Cd·A·v²   (wins when fast / thin fluid)
 *             + viscous drag   6π·mu·R·v       (wins when slow / thick fluid)
 *               computed slice by slice along the pill, so a tilted or spinning
 *               pill feels the push at the right place and turns.
 *   contacts    ground + building box, with bounce (restitution) and grip (friction)
 *
 * No drawing code here, so this file also runs in Node for quick checks.
 */
(function (root) {
  'use strict';

  const STANDARD_ENV = {
    g: 9.80665,       // m/s², standard gravity
    rho: 1.225,       // kg/m³, air at sea level, 15 °C
    mu: 1.81e-5,      // Pa·s, air viscosity at 15 °C
    wind: 0,          // m/s, + = away from the building
    dragMult: 1,      // multiplier on pressure drag
    cdSide: 1.0,      // drag coefficient for flow across the pill (like a cylinder)
    cdEnd: 0.4,       // drag coefficient for flow along the pill (rounded nose)
    viscMult: 1,      // multiplier on viscous drag
    restitution: 0.3, // 0 = no bounce, 1 = perfect bounce
    friction: 0.5,    // ground grip
  };

  const SLICES = 32;
  const AXIAL_VISC_FACTOR = 0.8; // long bodies feel less viscous drag along their axis
  const BOUNCE_CUTOFF = 0.3;     // m/s; slower hits do not bounce (stops jitter at rest)
  const MAX_TIME = 600;          // s of simulated time before we give up
  const NEAR = 1e-3;             // m; closer than this counts as touching

  function makeBody(p) {
    const diameter = Math.min(p.diameter, p.length);
    const r = diameter / 2;
    const lCyl = Math.max(0, p.length - diameter) / 2; // cylinder length in EACH half
    const halfLen = lCyl + r;

    const vCyl = Math.PI * r * r * lCyl;
    const vHem = (2 / 3) * Math.PI * r * r * r;
    const hemOffset = lCyl + (3 * r) / 8; // centroid of a half-sphere sits 3r/8 past its flat face

    // [mass, position along axis, own moment of inertia about its centroid (perpendicular axis)]
    const parts = [
      [p.metalDensity * vCyl, lCyl / 2, 0],
      [p.metalDensity * vHem, hemOffset, 0],
      [p.plasticDensity * vCyl, -lCyl / 2, 0],
      [p.plasticDensity * vHem, -hemOffset, 0],
    ];
    parts[0][2] = parts[0][0] * (r * r / 4 + lCyl * lCyl / 12);
    parts[2][2] = parts[2][0] * (r * r / 4 + lCyl * lCyl / 12);
    parts[1][2] = parts[1][0] * (83 / 320) * r * r;
    parts[3][2] = parts[3][0] * (83 / 320) * r * r;

    const mass = parts.reduce((a, q) => a + q[0], 0);
    const sCom = parts.reduce((a, q) => a + q[0] * q[1], 0) / mass;
    const inertia = parts.reduce((a, q) => a + q[2] + q[0] * (q[1] - sCom) ** 2, 0);
    const volume = 2 * (vCyl + vHem);

    const ds = (2 * halfLen) / SLICES;
    const slices = [];
    for (let i = 0; i < SLICES; i++) {
      const s = -halfLen + (i + 0.5) * ds;
      const a = Math.abs(s);
      const w = a <= lCyl ? 2 * r : 2 * Math.sqrt(Math.max(0, r * r - (a - lCyl) ** 2));
      slices.push({ s, w, ds });
    }

    return {
      length: p.length, diameter, r, lCyl, halfLen, volume,
      rEq: Math.cbrt((3 * volume) / (4 * Math.PI)), // radius of a ball with the same volume
      mass,
      massMetal: parts[0][0] + parts[1][0],
      massPlastic: parts[2][0] + parts[3][0],
      sCom, inertia, slices,
    };
  }

  function viscousTotal(b, env) {
    return 6 * Math.PI * env.mu * b.rEq * env.viscMult;
  }

  // Net force and torque about the balance point.
  // cLin / cRot = how strongly drag resists change; used to pick a stable time step.
  function computeForces(st, b, env) {
    const ux = Math.cos(st.th), uy = Math.sin(st.th);
    let fx = 0, fy = -b.mass * env.g, tau = 0;
    let cLin = 0, cRot = 0;

    // Buoyancy: up, at the middle of the pill.
    const mx = -b.sCom * ux;
    const buoy = env.rho * b.volume * env.g;
    fy += buoy;
    tau += mx * buoy;

    const rvx = st.vx - env.wind, rvy = st.vy;
    const bVisc = viscousTotal(b, env);
    const kPerLen = bVisc / (2 * b.halfLen);
    const kAxial = AXIAL_VISC_FACTOR * bVisc;

    // Along the axis: end-on pressure drag + viscous drag. Every point on the axis has the
    // same along-axis speed, and the force runs through the balance point, so no turning.
    const va = rvx * ux + rvy * uy;
    const qa = 0.5 * env.rho * env.cdEnd * env.dragMult * Math.PI * b.r * b.r * Math.abs(va);
    const fa = -(qa + kAxial) * va;
    let dragX = fa * ux, dragY = fa * uy;
    cLin += 2 * qa + kAxial;

    // Across the axis: slice by slice.
    for (const sl of b.slices) {
      const arm = sl.s - b.sCom;
      const dx = arm * ux, dy = arm * uy;
      const svx = rvx - st.w * dy, svy = rvy + st.w * dx;
      const along = svx * ux + svy * uy;
      const nx = svx - along * ux, ny = svy - along * uy;
      const vn = Math.hypot(nx, ny);
      const q = 0.5 * env.rho * env.cdSide * env.dragMult * sl.w * sl.ds * vn;
      const k = kPerLen * sl.ds;
      const sfx = -(q + k) * nx, sfy = -(q + k) * ny;
      dragX += sfx;
      dragY += sfy;
      tau += dx * sfy - dy * sfx;
      cLin += 2 * q + k;
      cRot += (2 * q + k) * arm * arm;
    }

    fx += dragX;
    fy += dragY;
    return { fx, fy, tau, cLin, cRot, dragX, dragY, buoy };
  }

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  // The building is a solid box: x from -width to 0, y from 0 to height.
  function buildingWidth(height) {
    return Math.max(6, 0.3 * height);
  }

  // Each end of the pill is a ball. Find where those balls are within NEAR of
  // the ground or the building. gap < 0 means overlap.
  function findContacts(st, b) {
    const ux = Math.cos(st.th), uy = Math.sin(st.th);
    const bd = st.building;
    const out = [];
    for (const [end, sign] of [['metal', 1], ['plastic', -1]]) {
      const ox = (sign * b.lCyl - b.sCom) * ux, oy = (sign * b.lCyl - b.sCom) * uy;
      const cx = st.x + ox, cy = st.y + oy;

      if (cy - b.r < NEAR) out.push({ end, ground: true, ox, oy, nx: 0, ny: 1, gap: cy - b.r });

      const qx = clamp(cx, bd.x0, bd.x1), qy = clamp(cy, 0, bd.top);
      const dx = cx - qx, dy = cy - qy, dist = Math.hypot(dx, dy);
      if (dist === 0) {
        // Ball centre inside the building: push out the shortest way.
        const ways = [[cx - bd.x0, -1, 0], [bd.x1 - cx, 1, 0], [bd.top - cy, 0, 1]];
        ways.sort((a, c) => a[0] - c[0]);
        out.push({ end, ground: false, ox, oy, nx: ways[0][1], ny: ways[0][2], gap: -ways[0][0] - b.r });
      } else if (dist - b.r < NEAR) {
        out.push({ end, ground: false, ox, oy, nx: dx / dist, ny: dy / dist, gap: dist - b.r });
      }
    }
    return out;
  }

  // Push the pill out of overlaps, then apply bounce + friction impulses.
  // Returns null if nothing is close, else { groundEnd }: the end touching the ground, if any.
  function resolveContacts(st, b, env, dt) {
    const contacts = findContacts(st, b);
    if (!contacts.length) return null;

    contacts.sort((a, c) => a.gap - c.gap);
    let sx = 0, sy = 0;
    for (const c of contacts) {
      const g = c.gap + sx * c.nx + sy * c.ny;
      if (g < 0) { sx -= g * c.nx; sy -= g * c.ny; }
    }
    st.x += sx;
    st.y += sy;

    for (const c of contacts) {
      c.rx = c.ox - b.r * c.nx; // contact point, relative to balance point
      c.ry = c.oy - b.r * c.ny;
      c.tx = c.ny; // tangent along the surface
      c.ty = -c.nx;
      c.rn = c.rx * c.ny - c.ry * c.nx;
      c.rt = c.rx * c.ty - c.ry * c.tx;
      const vn = (st.vx - st.w * c.ry) * c.nx + (st.vy + st.w * c.rx) * c.ny;
      const gapNow = c.gap + sx * c.nx + sy * c.ny;
      if (gapNow > 1e-9) {
        // Close but not touching: only slow it so it lands exactly on the surface
        // next tick. Fast hits are left alone so they overlap and bounce properly.
        c.target = -vn > BOUNCE_CUTOFF ? -Infinity : -gapNow / dt;
      } else {
        // Touching: bounce speed is decided once, from the speed before any impulse.
        c.target = -vn < BOUNCE_CUTOFF ? 0 : -env.restitution * vn;
      }
    }
    const active = contacts.filter((c) => c.target > -Infinity);

    // Two ends can touch at once; repeat so the impulses agree with each other.
    for (let pass = 0; pass < 6; pass++) {
      for (const c of active) {
        const vn = (st.vx - st.w * c.ry) * c.nx + (st.vy + st.w * c.rx) * c.ny;
        if (vn >= c.target) continue;

        const j = (c.target - vn) / (1 / b.mass + (c.rn * c.rn) / b.inertia);
        st.vx += (j * c.nx) / b.mass;
        st.vy += (j * c.ny) / b.mass;
        st.w += (c.rn * j) / b.inertia;

        const vt = (st.vx - st.w * c.ry) * c.tx + (st.vy + st.w * c.rx) * c.ty;
        const lim = env.friction * j;
        const jt = clamp(-vt / (1 / b.mass + (c.rt * c.rt) / b.inertia), -lim, lim);
        st.vx += (jt * c.tx) / b.mass;
        st.vy += (jt * c.ty) / b.mass;
        st.w += (c.rt * jt) / b.inertia;
      }
    }

    const ground = contacts.find((c) => c.ground && c.gap + sx * c.nx + sy * c.ny <= 1e-9);
    return { groundEnd: ground ? ground.end : null };
  }

  // 0° = metal end straight down, 90° = lying flat, 180° = metal end straight up.
  function tiltDeg(th) {
    return (Math.acos(Math.max(-1, Math.min(1, -Math.sin(th)))) * 180) / Math.PI;
  }

  function step(st, b, env, dtMax) {
    const f = computeForces(st, b, env);
    let dt = dtMax;
    if (f.cLin > 0) dt = Math.min(dt, (0.3 * b.mass) / f.cLin);
    if (f.cRot > 0) dt = Math.min(dt, (0.3 * b.inertia) / f.cRot);
    dt = Math.max(dt, 1e-6);

    st.vx += (f.fx / b.mass) * dt;
    st.vy += (f.fy / b.mass) * dt;
    st.w += (f.tau / b.inertia) * dt;
    st.x += st.vx * dt;
    st.y += st.vy * dt;
    st.th += st.w * dt;
    st.t += dt;

    const speedBefore = Math.hypot(st.vx, st.vy);
    const hit = resolveContacts(st, b, env, dt);
    if (hit && hit.groundEnd && !st.impact) {
      st.impact = { t: st.t, x: st.x, speed: speedBefore, end: hit.groundEnd, tilt: tiltDeg(st.th) };
    }

    if (hit && Math.hypot(st.vx, st.vy) < 0.02 && Math.abs(st.w) < 0.05) st.rest += dt;
    else st.rest = 0;

    if (st.rest > 0.3) st.done = 'landed';
    else if (st.y > st.ceiling) st.done = 'floated';
    else if (st.t > MAX_TIME) st.done = 'timeout';
    return dt;
  }

  // Advance by simDt seconds of simulated time. Stops early after maxSteps ticks, so
  // extreme settings slow the playback down instead of freezing the page.
  function advance(st, b, env, simDt, opts) {
    const dtMax = (opts && opts.dtMax) || 1 / 2000;
    const maxSteps = (opts && opts.maxSteps) || 300000;
    let left = simDt;
    let n = 0;
    while (left > 1e-12 && !st.done && n < maxSteps) {
      left -= step(st, b, env, Math.min(dtMax, left));
      if (opts && opts.stopOnImpact && st.impact) st.done = 'impact';
      n++;
    }
    return n;
  }

  // Start state: pill resting on the roof edge, just past the wall.
  function makeStart(p, b) {
    const th = ((-90 + p.tilt) * Math.PI) / 180;
    const ux = Math.cos(th), uy = Math.sin(th);
    const gx = Math.abs(ux) * b.lCyl + b.r + 0.02;
    const gy = p.height + Math.abs(uy) * b.lCyl + b.r;
    const a = (p.angle * Math.PI) / 180;
    return {
      t: 0,
      x: gx + b.sCom * ux,
      y: gy + b.sCom * uy,
      vx: p.speed * Math.cos(a),
      vy: p.speed * Math.sin(a),
      th,
      w: (p.spin * Math.PI) / 180,
      impact: null,
      rest: 0,
      done: null,
      ceiling: p.height * 3 + 50,
      building: { x0: -buildingWidth(p.height), x1: 0, top: p.height },
    };
  }

  // Steady falling speed with the metal end first, from:
  // weight − buoyancy = ½·rho·CdEnd·A·v² + viscous·v
  function terminalSpeed(b, env) {
    const net = (b.mass - env.rho * b.volume) * env.g;
    if (net <= 0) return env.g > 0 && env.rho * b.volume > b.mass ? -1 : 0; // -1 = it floats
    const qa = 0.5 * env.rho * env.cdEnd * env.dragMult * Math.PI * b.r * b.r;
    const kv = AXIAL_VISC_FACTOR * viscousTotal(b, env);
    if (qa === 0 && kv === 0) return Infinity;
    if (qa === 0) return net / kv;
    return (-kv + Math.sqrt(kv * kv + 4 * qa * net)) / (2 * qa);
  }

  function reynolds(st, b, env) {
    const v = Math.hypot(st.vx - env.wind, st.vy);
    if (env.mu === 0) return env.rho === 0 ? 0 : Infinity;
    return (env.rho * v * b.diameter) / env.mu;
  }

  const api = {
    STANDARD_ENV, makeBody, makeStart, computeForces, advance, step,
    terminalSpeed, reynolds, tiltDeg, buildingWidth,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PillPhysics = api;
})(this);
