// Procedural "painted" wallpapers for Driftsky. Runs in a browser canvas.
// Every scene is drawn in a 1440×900 coordinate space; the caller scales for resolution.
/* eslint-disable */
(function () {
  const W = 1440, H = 900;

  function rng(seed) {
    let s = seed >>> 0;
    return () => {
      let t = (s = (s + 0x6d2b79f5) >>> 0);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const lerp = (a, b, t) => a + (b - a) * t;

  function sky(c, stops) {
    const g = c.createLinearGradient(0, 0, 0, H);
    for (const [o, col] of stops) g.addColorStop(o, col);
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);
  }

  function stars(c, r, n, maxY, alpha = 1) {
    for (let i = 0; i < n; i++) {
      const x = r() * W, y = r() * maxY, s = r() ** 3 * 1.6 + 0.3;
      c.globalAlpha = (0.3 + r() * 0.7) * alpha * (1 - y / maxY * 0.6);
      c.fillStyle = r() < 0.15 ? '#ffe9c4' : '#ffffff';
      c.beginPath(); c.arc(x, y, s, 0, Math.PI * 2); c.fill();
      if (s > 1.4 && r() < 0.5) { // sparkle
        c.globalAlpha *= 0.6; c.fillRect(x - s * 3, y - 0.3, s * 6, 0.6); c.fillRect(x - 0.3, y - s * 3, 0.6, s * 6);
      }
    }
    c.globalAlpha = 1;
  }

  function glow(c, x, y, r, color, a = 1) {
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.globalAlpha = a; c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill(); c.globalAlpha = 1;
  }

  function moon(c, x, y, r, phase, color = '#ffe7b0') {
    glow(c, x, y, r * 6, 'rgba(255,230,170,0.22)');
    glow(c, x, y, r * 2.2, 'rgba(255,236,190,0.35)');
    const m = document.createElement('canvas');
    const k = c.__scale || 1;
    m.width = m.height = Math.ceil(r * 2.4 * k);
    const mc = m.getContext('2d');
    mc.scale(k, k);
    mc.fillStyle = color; mc.beginPath(); mc.arc(r * 1.2, r * 1.2, r, 0, Math.PI * 2); mc.fill();
    if (phase) { mc.globalCompositeOperation = 'destination-out'; mc.beginPath(); mc.arc(r * 1.2 + r * phase, r * 1.2 - r * 0.25, r * 0.95, 0, Math.PI * 2); mc.fill(); }
    c.drawImage(m, x - r * 1.2, y - r * 1.2, r * 2.4, r * 2.4);
  }

  // Mountain range: a few big peaks plus fractal detail.
  function peaks(r, base, heights) {
    const n = 256, arr = new Array(n + 1).fill(base);
    const detail = ridge(r, 0, 40, 0.55, n);
    for (const [px, ph, pw] of heights) for (let i = 0; i <= n; i++) {
      const x = (i / n) * W, d = Math.abs(x - px) / pw;
      if (d < 1) arr[i] = Math.min(arr[i], base - ph * (1 - d) ** 1.25);
    }
    return arr.map((v, i) => v + detail[i]);
  }

  // Snow only above a wavy snowline, clipped to the mountain.
  function snowline(c, pts, color, lineY, shade) {
    c.save(); c.beginPath(); c.moveTo(0, H);
    pts.forEach((y, i) => c.lineTo((i / (pts.length - 1)) * W, y)); c.lineTo(W, H); c.closePath(); c.clip();
    c.fillStyle = color; c.beginPath(); c.moveTo(0, 0);
    for (let x = 0; x <= W; x += 12) c.lineTo(x, lineY + Math.sin(x * 0.045) * 14 + Math.sin(x * 0.013) * 22);
    c.lineTo(W, 0); c.closePath(); c.fill();
    // shadowed faces: darken right-hand slopes
    if (shade) { c.fillStyle = shade; for (let i = 1; i < pts.length; i++) if (pts[i] > pts[i - 1]) { const x = (i / (pts.length - 1)) * W; c.fillRect(x - W / pts.length, 0, W / pts.length + 1, lineY + 40); } }
    c.restore();
  }

  // Painted foliage: dark core, mid layer, light upper-left highlights.
  function foliage(c, r, cx, cy, rx, ry, [dark, mid, light]) {
    const g = () => (r() + r() + r() - 1.5) / 1.5;
    for (const [col, n, sz, ox, oy] of [[dark, 90, 1, 0, 0.12], [mid, 110, 0.8, -0.06, -0.04], [light, 60, 0.55, -0.16, -0.2]]) {
      c.fillStyle = col;
      for (let i = 0; i < n; i++) { const x = cx + (g() + ox) * rx, y = cy + (g() + oy) * ry; c.beginPath(); c.arc(x, y, (4 + r() * 9) * sz * Math.max(1, rx / 120), 0, Math.PI * 2); c.fill(); }
    }
  }

  function cloud(c, r, cx, cy, w, top, bottom) {
    const g = c.createLinearGradient(0, cy - 60, 0, cy + 20);
    g.addColorStop(0, top); g.addColorStop(1, bottom);
    c.fillStyle = g;
    for (let i = 0; i < 46; i++) {
      const t = r(), x = cx + (t - 0.5) * w, hump = Math.sin(t * Math.PI);
      const y = cy - hump * (20 + r() * 40) + r() * 10, rad = 12 + hump * (14 + r() * 20);
      c.beginPath(); c.arc(x, Math.min(y, cy), rad, Math.PI, 0); c.lineTo(x + rad, cy + 6); c.lineTo(x - rad, cy + 6); c.fill();
    }
  }

  // 1D fractal noise ridge
  function ridge(r, base, amp, rough = 0.55, points = 256) {
    const arr = new Array(points + 1).fill(0);
    let step = points, a = amp;
    arr[0] = (r() - 0.5) * amp; arr[points] = (r() - 0.5) * amp;
    while (step > 1) {
      const half = step / 2;
      for (let i = half; i < points; i += step) arr[i] = (arr[i - half] + arr[i + half]) / 2 + (r() - 0.5) * a;
      a *= rough; step = half;
    }
    return arr.map((v) => base + v);
  }

  function fillRidge(c, pts, fill, bottom = H) {
    c.fillStyle = fill; c.beginPath(); c.moveTo(0, bottom);
    pts.forEach((y, i) => c.lineTo((i / (pts.length - 1)) * W, y));
    c.lineTo(W, bottom); c.closePath(); c.fill();
  }

  function ridgeAt(pts, x) {
    const f = (x / W) * (pts.length - 1); const i = Math.max(0, Math.min(pts.length - 2, Math.floor(f)));
    return lerp(pts[i], pts[i + 1], f - i);
  }

  function pine(c, x, y, h, color, snow) {
    const w = h * 0.42, tiers = 5;
    c.fillStyle = color;
    c.fillRect(x - h * 0.03, y - h * 0.12, h * 0.06, h * 0.14);
    for (let t = 0; t < tiers; t++) {
      const ty = y - h * 0.1 - t * (h * 0.85 / tiers), tw = w * (1 - t / tiers * 0.75), th = h * 0.32;
      c.fillStyle = color; c.beginPath(); c.moveTo(x - tw / 2, ty); c.lineTo(x, ty - th); c.lineTo(x + tw / 2, ty); c.closePath(); c.fill();
      if (snow) { c.fillStyle = snow; c.beginPath(); c.moveTo(x - tw * 0.32, ty - th * 0.38); c.lineTo(x, ty - th); c.lineTo(x + tw * 0.32, ty - th * 0.38); c.quadraticCurveTo(x, ty - th * 0.5, x - tw * 0.32, ty - th * 0.38); c.fill(); }
    }
  }

  function blobTree(c, r, x, y, h, colors, trunk) {
    c.fillStyle = trunk; c.fillRect(x - h * 0.03, y - h * 0.45, h * 0.06, h * 0.45);
    for (let i = 0; i < 9; i++) {
      c.fillStyle = colors[i % colors.length];
      c.beginPath(); c.arc(x + (r() - 0.5) * h * 0.5, y - h * 0.6 + (r() - 0.5) * h * 0.35, h * (0.13 + r() * 0.1), 0, Math.PI * 2); c.fill();
    }
  }

  function cabin(c, x, y, s, wall, roof, light, roofSnow) {
    // body
    c.fillStyle = wall; c.fillRect(x, y - s * 0.6, s, s * 0.6);
    // roof
    c.fillStyle = roof; c.beginPath(); c.moveTo(x - s * 0.12, y - s * 0.58); c.lineTo(x + s * 0.5, y - s * 1.05); c.lineTo(x + s * 1.12, y - s * 0.58); c.closePath(); c.fill();
    if (roofSnow) { c.fillStyle = roofSnow; c.beginPath(); c.moveTo(x - s * 0.14, y - s * 0.6); c.lineTo(x + s * 0.5, y - s * 1.1); c.lineTo(x + s * 1.14, y - s * 0.6); c.lineTo(x + s * 1.1, y - s * 0.54); c.quadraticCurveTo(x + s * 0.5, y - s * 0.86, x - s * 0.1, y - s * 0.54); c.closePath(); c.fill(); }
    // chimney
    c.fillStyle = wall; c.fillRect(x + s * 0.72, y - s * 1.0, s * 0.1, s * 0.25);
    // windows
    for (const [wx, wy] of [[0.15, 0.4], [0.62, 0.4]]) {
      glow(c, x + s * (wx + 0.11), y - s * wy + s * 0.1, s * 0.7, light.replace('1)', '0.35)'));
      c.fillStyle = light; c.fillRect(x + s * wx, y - s * wy, s * 0.22, s * 0.2);
      c.fillStyle = wall; c.fillRect(x + s * (wx + 0.1), y - s * wy, s * 0.02, s * 0.2);
    }
    // door
    c.fillStyle = 'rgba(0,0,0,0.35)'; c.fillRect(x + s * 0.42, y - s * 0.32, s * 0.16, s * 0.32);
  }

  function reflection(c, y0, y1, tint, alpha) {
    // mirror what's above the waterline into the lake, squashed, with ripples
    const h = y1 - y0;
    const img = c.getImageData(0, Math.max(0, y0 - h), W * c.__scale, h * c.__scale);
    void img;
    c.save();
    c.beginPath(); c.rect(0, y0, W, h); c.clip();
    c.translate(0, y0 * 2); c.scale(1, -1);
    c.globalAlpha = alpha;
    c.drawImage(c.canvas, 0, (y0 - h) * c.__scale, W * c.__scale, h * c.__scale, 0, y0 - h, W, h);
    c.restore();
    c.fillStyle = tint; c.fillRect(0, y0, W, h);
    for (let i = 0; i < 160; i++) {
      const y = y0 + (i / 160) ** 1.5 * h, x = (i * 397) % W;
      c.globalAlpha = 0.08 + (i / 160) * 0.08; c.fillStyle = '#ffffff';
      c.fillRect(x, y, 30 + (i % 7) * 25, 0.8);
    }
    c.globalAlpha = 1;
  }

  function fog(c, y, h, color, a) {
    const g = c.createLinearGradient(0, y - h, 0, y + h);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.5, color); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.globalAlpha = a; c.fillStyle = g; c.fillRect(0, y - h, W, h * 2); c.globalAlpha = 1;
  }

  function grass(c, r, y, n, colors, hMax) {
    for (let i = 0; i < n; i++) {
      const x = r() * W, h = hMax * (0.3 + r() * 0.7), lean = (r() - 0.5) * h * 0.5;
      c.strokeStyle = colors[Math.floor(r() * colors.length)]; c.lineWidth = 1 + r() * 1.6;
      c.beginPath(); c.moveTo(x, y + r() * 30); c.quadraticCurveTo(x + lean * 0.3, y - h * 0.5, x + lean, y - h); c.stroke();
    }
  }

  function grain(c, r, amount) {
    for (let i = 0; i < 9000; i++) {
      c.globalAlpha = amount * r(); c.fillStyle = r() < 0.5 ? '#000' : '#fff';
      c.fillRect(r() * W, r() * H, 1, 1);
    }
    c.globalAlpha = 1;
  }

  const scenes = {
    snow(c) {
      const r = rng(11);
      sky(c, [[0, '#0d1230'], [0.45, '#2a2d63'], [0.7, '#4b4b8a'], [1, '#6e6aa8']]);
      stars(c, r, 520, 520);
      moon(c, 1150, 150, 34, 0.55, '#fff1c8');
      const far = peaks(r, 560, [[260, 230, 420], [700, 330, 380], [1080, 260, 420], [1400, 200, 300]]);
      fillRidge(c, far, '#4a4c8c'); snowline(c, far, '#b9bfeb', 330);
      fog(c, 520, 70, 'rgba(160,160,220,0.6)', 0.5);
      const mid = peaks(r, 600, [[150, 90, 260], [520, 120, 300], [980, 100, 280], [1330, 80, 220]]);
      fillRidge(c, mid, '#34386f'); snowline(c, mid, '#8088c6', 520);
      for (let i = 0; i < 160; i++) { const x = r() * W; pine(c, x, ridgeAt(mid, x) + 30 + r() * 30, 30 + r() * 30, '#232650', 'rgba(170,180,230,0.7)'); }
      // lake
      const lakeY = 640;
      fillRidge(c, new Array(10).fill(lakeY), '#2b2f5e');
      reflection(c, lakeY, 720, 'rgba(30,34,80,0.45)', 0.55);
      // village lights across the water
      for (let i = 0; i < 26; i++) { const x = 760 + r() * 520, y = lakeY - 6 - r() * 18; glow(c, x, y, 10, 'rgba(255,190,110,0.6)'); c.fillStyle = '#ffd38a'; c.fillRect(x, y, 3, 3); c.globalAlpha = 0.35; c.fillRect(x, lakeY + (lakeY - y) * 1.4, 2, 12); c.globalAlpha = 1; }
      // snowy foreground hill
      const fg = ridge(r, 700, 70, 0.45);
      const g = c.createLinearGradient(0, 620, 0, H); g.addColorStop(0, '#c9cff2'); g.addColorStop(0.5, '#9aa0d8'); g.addColorStop(1, '#6d6fae');
      fillRidge(c, fg, g);
      cabin(c, 180, ridgeAt(fg, 240) + 18, 190, '#4a2f2c', '#3a2422', 'rgba(255,196,110,1)', '#f1f2ff');
      glow(c, 275, ridgeAt(fg, 240) - 40, 260, 'rgba(255,170,90,0.22)');
      for (let i = 0; i < 9; i++) { const x = 30 + i * 60 + r() * 40; if (x > 150 && x < 420) continue; pine(c, x, ridgeAt(fg, x) + 30, 120 + r() * 120, '#1d1f45', '#e6e9ff'); }
      for (let i = 0; i < 6; i++) { const x = 1180 + i * 50 + r() * 30; pine(c, x, ridgeAt(fg, x) + 40, 160 + r() * 140, '#1b1d42', '#e6e9ff'); }
      // fence
      c.strokeStyle = '#3d2a30'; c.lineWidth = 4;
      for (let x = 520; x < 900; x += 46) { const y = ridgeAt(fg, x) + 20; c.beginPath(); c.moveTo(x, y); c.lineTo(x, y - 40); c.stroke(); }
      c.lineWidth = 3; c.beginPath(); for (let x = 520; x <= 900; x += 10) { const y = ridgeAt(fg, x) - 6; x === 520 ? c.moveTo(x, y) : c.lineTo(x, y); } c.stroke();
      grain(c, r, 0.05);
    },

    rain(c) {
      const r = rng(23);
      sky(c, [[0, '#1d2a35'], [0.5, '#344a57'], [0.75, '#557080'], [1, '#2a3a44']]);
      // heavy clouds
      for (let i = 0; i < 70; i++) { c.globalAlpha = 0.18; c.fillStyle = r() < 0.5 ? '#2a3944' : '#4a6170'; c.beginPath(); c.ellipse(r() * W, r() * 300, 120 + r() * 220, 30 + r() * 50, 0, 0, Math.PI * 2); c.fill(); }
      c.globalAlpha = 1;
      const far = ridge(r, 470, 120, 0.5);
      fillRidge(c, far, '#3c5462'); fog(c, 470, 90, 'rgba(150,180,195,0.55)', 0.6);
      const mid = ridge(r, 540, 70, 0.5);
      fillRidge(c, mid, '#2c414d');
      for (let i = 0; i < 120; i++) { const x = r() * W; pine(c, x, ridgeAt(mid, x) + 20, 40 + r() * 45, '#203440'); }
      fog(c, 560, 50, 'rgba(160,190,200,0.5)', 0.45);
      const lakeY = 600;
      fillRidge(c, new Array(10).fill(lakeY), '#263844');
      reflection(c, lakeY, 760, 'rgba(25,40,50,0.4)', 0.5);
      // ripples
      for (let i = 0; i < 260; i++) { const x = r() * W, y = lakeY + 10 + r() * 150; c.strokeStyle = 'rgba(200,225,235,0.25)'; c.lineWidth = 0.8; c.beginPath(); c.ellipse(x, y, 4 + r() * 8, 1 + r() * 2, 0, 0, Math.PI * 2); c.stroke(); }
      // jetty + lamp hut
      const fg = ridge(r, 770, 40, 0.4);
      fillRidge(c, fg, '#172630');
      c.fillStyle = '#20313b'; c.fillRect(560, 700, 300, 10); for (let x = 570; x < 860; x += 40) c.fillRect(x, 700, 6, 70);
      cabin(c, 980, ridgeAt(fg, 1050) + 12, 150, '#22333d', '#182730', 'rgba(255,200,130,1)');
      glow(c, 760, 610, 160, 'rgba(255,200,120,0.25)');
      c.fillStyle = '#121d24'; c.fillRect(756, 610, 4, 92); glow(c, 758, 606, 30, 'rgba(255,214,150,0.9)');
      // reeds
      grass(c, r, 800, 380, ['#142029', '#1d2c35', '#27404a'], 90);
      // rain streaks
      c.strokeStyle = 'rgba(210,230,240,0.18)'; c.lineWidth = 1;
      for (let i = 0; i < 900; i++) { const x = r() * W, y = r() * H, l = 10 + r() * 22; c.beginPath(); c.moveTo(x, y); c.lineTo(x - l * 0.15, y + l); c.stroke(); }
      grain(c, r, 0.05);
    },

    autumn(c) {
      const r = rng(37);
      sky(c, [[0, '#2b2350'], [0.3, '#7a3a6a'], [0.52, '#e06a4a'], [0.62, '#ffb35c'], [1, '#3a1f2c']]);
      stars(c, r, 90, 180, 0.6);
      moon(c, 1180, 130, 16, 0.5, '#ffe2c0');
      glow(c, 760, 540, 380, 'rgba(255,170,80,0.55)');
      c.fillStyle = '#ffd38a'; c.beginPath(); c.arc(760, 548, 30, 0, Math.PI * 2); c.fill();
      // streaky clouds
      for (let i = 0; i < 40; i++) { c.globalAlpha = 0.25; c.fillStyle = r() < 0.5 ? '#d0587a' : '#8a3d6e'; c.beginPath(); c.ellipse(r() * W, 220 + r() * 230, 140 + r() * 220, 6 + r() * 12, 0, 0, Math.PI * 2); c.fill(); }
      c.globalAlpha = 1;
      const far = ridge(r, 540, 90, 0.5); fillRidge(c, far, '#5a2c4a');
      const mid = ridge(r, 575, 50, 0.5); fillRidge(c, mid, '#3d1f36');
      for (let i = 0; i < 90; i++) { const x = r() * W; blobTree(c, r, x, ridgeAt(mid, x) + 10, 40 + r() * 30, ['#7a2c2c', '#9a3b26', '#5e2a35'], '#2a1520'); }
      const lakeY = 600;
      fillRidge(c, new Array(10).fill(lakeY), '#4a2a40');
      reflection(c, lakeY, 760, 'rgba(70,30,50,0.25)', 0.7);
      glow(c, 760, 640, 220, 'rgba(255,170,80,0.35)');
      const fg = ridge(r, 780, 50, 0.45); fillRidge(c, fg, '#22121c');
      // big tree on the left
      c.fillStyle = '#1e0f17'; c.beginPath(); c.moveTo(150, H); c.quadraticCurveTo(190, 520, 120, 300); c.lineTo(160, 300); c.quadraticCurveTo(240, 560, 230, H); c.fill();
      c.strokeStyle = '#1e0f17'; c.lineWidth = 9; c.lineCap = 'round';
      for (const [x2, y2] of [[360, 200], [40, 180], [260, 120], [120, 110]]) { c.beginPath(); c.moveTo(150, 330); c.quadraticCurveTo((150 + x2) / 2, 230, x2, y2); c.stroke(); }
      foliage(c, r, 120, 170, 260, 150, ['#7d2418', '#c2411f', '#f0953a']);
      foliage(c, r, 380, 150, 130, 90, ['#8a2a1a', '#d4572a', '#f6b04a']);
      cabin(c, 380, ridgeAt(fg, 450) + 14, 150, '#3a1d22', '#2a1218', 'rgba(255,190,110,1)');
      // fallen leaves in the grass
      for (let i = 0; i < 300; i++) { c.fillStyle = ['#c2411f', '#e2702a', '#f0a03a'][Math.floor(r() * 3)]; c.globalAlpha = 0.7; c.beginPath(); c.ellipse(r() * W, 800 + r() * 100, 3, 1.6, r() * 3, 0, Math.PI * 2); c.fill(); }
      c.globalAlpha = 1;
      grain(c, r, 0.05);
    },

    fireflies(c) {
      const r = rng(53);
      sky(c, [[0, '#06121c'], [0.5, '#0c2a33'], [0.8, '#123a3a'], [1, '#081a1a']]);
      stars(c, r, 260, 420, 0.8);
      moon(c, 1020, 120, 22, 0.6, '#f3f0d0');
      const far = ridge(r, 470, 80, 0.5); fillRidge(c, far, '#0f2f33');
      for (let i = 0; i < 140; i++) { const x = r() * W; blobTree(c, r, x, ridgeAt(far, x) + 20, 70 + r() * 70, ['#0c2629', '#0f2c2e', '#11302f'], '#0a2022'); }
      fog(c, 560, 70, 'rgba(120,180,170,0.35)', 0.5);
      const mid = ridge(r, 640, 60, 0.5); fillRidge(c, mid, '#0b2222');
      // tall dark trees framing the meadow
      for (const x of [60, 170, 1290, 1390]) { c.fillStyle = '#04110f'; c.fillRect(x - 10, 120, 20, H); }
      foliage(c, r, 110, 90, 220, 150, ['#030d0b', '#061612', '#0b231d']);
      foliage(c, r, 1340, 80, 220, 150, ['#030d0b', '#061612', '#0b231d']);
      const fg = ridge(r, 790, 40, 0.4); fillRidge(c, fg, '#061412');
      grass(c, r, 840, 1400, ['#0b2420', '#0f2d27', '#123631', '#071a17'], 120);
      // fireflies baked in
      for (let i = 0; i < 140; i++) { const x = r() * W, y = 420 + r() * 420; glow(c, x, y, 10 + r() * 14, 'rgba(210,255,120,0.55)', 0.4 + r() * 0.6); c.fillStyle = '#f4ffc0'; c.fillRect(x - 1, y - 1, 2, 2); }
      // white flowers
      for (let i = 0; i < 160; i++) { const x = r() * W, y = 780 + r() * 120; c.fillStyle = 'rgba(220,235,230,0.7)'; c.beginPath(); c.arc(x, y, 1.6 + r() * 1.6, 0, Math.PI * 2); c.fill(); }
      grain(c, r, 0.05);
    },

    stars(c) {
      const r = rng(71);
      sky(c, [[0, '#070a24'], [0.5, '#1a1748'], [0.8, '#3b2a68'], [1, '#1c1438']]);
      // milky way band
      c.save(); c.translate(720, 380); c.rotate(-0.42);
      for (let i = 0; i < 1600; i++) { const x = (r() - 0.5) * 1900, y = (r() + r() + r() - 1.5) * 90; c.globalAlpha = 0.25 + r() * 0.5; c.fillStyle = r() < 0.2 ? '#ffd9f2' : '#ffffff'; c.fillRect(x, y, r() * 1.4 + 0.3, r() * 1.4 + 0.3); }
      glow(c, 0, 0, 520, 'rgba(160,130,255,0.18)'); c.restore();
      stars(c, r, 700, 700);
      moon(c, 1180, 160, 30, 0.6, '#fff1d0');
      // pink-lit clouds
      for (const [cx, cy, w] of [[170, 210, 360], [560, 140, 260], [1290, 330, 420], [330, 470, 300], [980, 520, 380]]) cloud(c, r, cx, cy, w, '#d27fb6', '#4a2f78');
      const far = ridge(r, 720, 70, 0.5); fillRidge(c, far, '#241a4a');
      // village lights
      for (let i = 0; i < 40; i++) { const x = 300 + r() * 900, y = ridgeAt(far, x) + 10 + r() * 50; glow(c, x, y, 12, 'rgba(255,190,110,0.6)'); c.fillStyle = '#ffcf85'; c.fillRect(x, y, 3, 3); }
      const fg = ridge(r, 820, 40, 0.4); fillRidge(c, fg, '#140e2e');
      // blossom bushes
      for (let i = 0; i < 260; i++) { const x = r() < 0.5 ? r() * 360 : W - r() * 360, y = 740 + r() * 160; c.fillStyle = ['#f29cc2', '#ffc7de', '#e46b9e'][Math.floor(r() * 3)]; c.globalAlpha = 0.85; c.beginPath(); c.arc(x, y, 2 + r() * 2.5, 0, Math.PI * 2); c.fill(); }
      c.globalAlpha = 1;
      grain(c, r, 0.05);
    },
  };

  window.renderScene = function (name, scale) {
    const cv = document.createElement('canvas');
    cv.width = W * scale; cv.height = H * scale;
    const c = cv.getContext('2d');
    c.__scale = scale;
    c.scale(scale, scale);
    scenes[name](c);
    return cv;
  };
  window.SCENES = Object.keys(scenes);
})();
