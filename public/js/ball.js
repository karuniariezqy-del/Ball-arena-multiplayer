/* =====================================================================
   BALL ARENA LEGENDS — ball + skin renderer (shared by UI and arena)
   ===================================================================== */
(function () {
  'use strict';
  const TAU = Math.PI * 2;

  /* ---------- color utils ---------- */
  function hexToRgb(hex) {
    let h = String(hex || '#888888').replace('#', '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const n = parseInt(h, 16);
    if (Number.isNaN(n)) return { r: 136, g: 136, b: 136 };
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  function rgbToHex(r, g, b) {
    const f = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
    return `#${f(r)}${f(g)}${f(b)}`;
  }
  function mix(a, b, amt) {
    const A = hexToRgb(a); const B = hexToRgb(b);
    return rgbToHex(A.r + (B.r - A.r) * amt, A.g + (B.g - A.g) * amt, A.b + (B.b - A.b) * amt);
  }
  function shade(hex, amt) {
    return amt >= 0 ? mix(hex, '#ffffff', amt) : mix(hex, '#000000', -amt);
  }
  function rgba(hex, a) {
    const { r, g, b } = hexToRgb(hex);
    return `rgba(${r},${g},${b},${a})`;
  }
  function hsl(h, s, l) { return `hsl(${((h % 360) + 360) % 360} 92% ${l}%)`; }
  function seeded(id) {
    let n = 0;
    for (let i = 0; i < String(id).length; i += 1) n = (n * 31 + String(id).charCodeAt(i)) % 9973;
    return n / 9973;
  }

  /* ---------- pattern painters (local space, already clipped to ball) ---------- */
  const P = {
    solid(ctx, r, s) {
      const g = ctx.createLinearGradient(-r, -r, r, r);
      g.addColorStop(0, rgba(shade(s.primary, 0.28), 0.55));
      g.addColorStop(1, rgba(shade(s.secondary, -0.2), 0.25));
      ctx.fillStyle = g; ctx.fillRect(-r, -r, r * 2, r * 2);
    },
    ring(ctx, r, s) {
      ctx.strokeStyle = rgba(s.accent, 0.9); ctx.lineWidth = r * 0.16;
      ctx.beginPath(); ctx.arc(0, 0, r * 0.58, 0, TAU); ctx.stroke();
      ctx.strokeStyle = rgba(s.secondary, 0.85); ctx.lineWidth = r * 0.1;
      ctx.beginPath(); ctx.arc(0, 0, r * 0.82, 0, TAU); ctx.stroke();
    },
    stripe(ctx, r, s) {
      ctx.save(); ctx.rotate(-0.7);
      for (let i = -3; i <= 3; i += 2) {
        ctx.fillStyle = i % 4 === 1 ? rgba(s.accent, 0.85) : rgba(s.secondary, 0.75);
        ctx.fillRect(-r, i * r * 0.26, r * 2, r * 0.24);
      }
      ctx.restore();
    },
    core(ctx, r, s, t, hue) {
      const p = 0.86 + Math.sin(t * 2.4) * 0.06;
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 0.62 * p);
      g.addColorStop(0, '#ffffff'); g.addColorStop(0.35, rgba(s.accent, 0.98)); g.addColorStop(1, rgba(s.accent, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, r * 0.68, 0, TAU); ctx.fill();
    },
    pulse(ctx, r, s, t) {
      for (let i = 0; i < 3; i += 1) {
        const k = ((t * 0.55 + i / 3) % 1);
        ctx.strokeStyle = rgba(s.accent, 0.65 * (1 - k)); ctx.lineWidth = r * 0.09;
        ctx.beginPath(); ctx.arc(0, 0, r * (0.18 + k * 0.78), 0, TAU); ctx.stroke();
      }
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(0, 0, r * 0.16, 0, TAU); ctx.fill();
    },
    orbit(ctx, r, s, t) {
      for (let i = 0; i < 4; i += 1) {
        const a = t * 1.5 + (i * TAU) / 4;
        ctx.fillStyle = i % 2 ? rgba(s.accent, 0.95) : rgba('#ffffff', 0.8);
        ctx.beginPath(); ctx.arc(Math.cos(a) * r * 0.62, Math.sin(a) * r * 0.62, r * 0.1, 0, TAU); ctx.fill();
      }
      ctx.strokeStyle = rgba(s.secondary, 0.45); ctx.lineWidth = r * 0.04;
      ctx.beginPath(); ctx.arc(0, 0, r * 0.62, 0, TAU); ctx.stroke();
    },
    petal(ctx, r, s) {
      for (let i = 0; i < 6; i += 1) {
        ctx.save(); ctx.rotate((i * TAU) / 6);
        ctx.fillStyle = rgba(s.accent, 0.62);
        ctx.beginPath(); ctx.ellipse(0, -r * 0.46, r * 0.17, r * 0.34, 0, 0, TAU); ctx.fill();
        ctx.restore();
      }
      ctx.fillStyle = rgba('#ffffff', 0.85); ctx.beginPath(); ctx.arc(0, 0, r * 0.19, 0, TAU); ctx.fill();
    },
    circuit(ctx, r, s) {
      ctx.strokeStyle = rgba(s.accent, 0.7); ctx.lineWidth = r * 0.045;
      for (let i = 0; i < 3; i += 1) {
        const y = -r * 0.45 + i * r * 0.45;
        ctx.beginPath(); ctx.moveTo(-r * 0.8, y); ctx.lineTo(-r * 0.1, y); ctx.lineTo(r * 0.15, y + r * 0.22); ctx.lineTo(r * 0.8, y + r * 0.22); ctx.stroke();
      }
      for (let i = 0; i < 5; i += 1) {
        ctx.fillStyle = rgba('#ffffff', 0.85);
        ctx.beginPath(); ctx.arc(-r * 0.7 + i * r * 0.34, -r * 0.45 + ((i * 2) % 3) * r * 0.45 + r * 0.11, r * 0.055, 0, TAU); ctx.fill();
      }
    },
    hex(ctx, r, s) {
      ctx.strokeStyle = rgba(s.accent, 0.72); ctx.lineWidth = r * 0.06;
      const h = r * 0.42;
      for (let k = -1; k <= 1; k += 1) {
        ctx.beginPath();
        for (let i = 0; i < 6; i += 1) {
          const a = (i * TAU) / 6 + Math.PI / 6;
          const x = Math.cos(a) * h; const y = Math.sin(a) * h + k * h * 1.45;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.closePath(); ctx.stroke();
      }
    },
    bolt(ctx, r, s) {
      ctx.fillStyle = rgba('#ffffff', 0.92);
      ctx.beginPath();
      ctx.moveTo(-r * 0.1, -r * 0.85); ctx.lineTo(r * 0.34, -r * 0.18); ctx.lineTo(r * 0.04, -r * 0.18);
      ctx.lineTo(r * 0.28, r * 0.85); ctx.lineTo(-r * 0.36, r * 0.02); ctx.lineTo(-r * 0.03, r * 0.02);
      ctx.closePath(); ctx.fill();
    },
    swirl(ctx, r, s, t) {
      ctx.strokeStyle = rgba(s.accent, 0.8); ctx.lineWidth = r * 0.085; ctx.lineCap = 'round';
      for (let s2 = 0; s2 < 2; s2 += 1) {
        ctx.beginPath();
        for (let i = 0; i <= 40; i += 1) {
          const k = i / 40; const a = k * TAU * 1.7 + t * 0.6 + s2 * Math.PI;
          const rad = r * 0.12 + k * r * 0.7;
          const x = Math.cos(a) * rad; const y = Math.sin(a) * rad;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    },
    star(ctx, r, s) {
      ctx.fillStyle = rgba(s.accent, 0.92);
      ctx.beginPath();
      for (let i = 0; i < 10; i += 1) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const rad = i % 2 === 0 ? r * 0.74 : r * 0.3;
        const x = Math.cos(a) * rad; const y = Math.sin(a) * rad;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath(); ctx.fill();
    },
    flame(ctx, r, s, t) {
      for (let i = 0; i < 3; i += 1) {
        const w = r * (0.26 - i * 0.05); const hh = r * (0.9 - i * 0.2);
        const wob = Math.sin(t * 4 + i) * r * 0.05;
        ctx.fillStyle = i === 2 ? 'rgba(255,255,255,0.9)' : rgba(i === 0 ? s.accent : s.primary, 0.8);
        ctx.beginPath();
        ctx.moveTo(wob * 0.3, r * 0.72);
        ctx.quadraticCurveTo(-w * 2, r * 0.1, wob, -hh * 0.55);
        ctx.quadraticCurveTo(w * 2.2, r * 0.15, -wob, r * 0.72);
        ctx.fill();
      }
    },
    streak(ctx, r, s) {
      ctx.save(); ctx.rotate(-0.4);
      for (let i = 0; i < 5; i += 1) {
        ctx.fillStyle = rgba(i % 2 ? s.accent : '#ffffff', 0.2 + i * 0.09);
        ctx.fillRect(-r, -r * 0.7 + i * r * 0.3, r * (0.7 + i * 0.16), r * 0.06);
      }
      ctx.restore();
    },
    gear(ctx, r, s, t) {
      ctx.save(); ctx.rotate(t * 0.5);
      ctx.fillStyle = rgba(s.accent, 0.85);
      for (let i = 0; i < 8; i += 1) {
        ctx.save(); ctx.rotate((i * TAU) / 8);
        ctx.fillRect(-r * 0.07, -r * 0.86, r * 0.14, r * 0.24); ctx.restore();
      }
      ctx.strokeStyle = rgba(s.accent, 0.8); ctx.lineWidth = r * 0.08;
      ctx.beginPath(); ctx.arc(0, 0, r * 0.5, 0, TAU); ctx.stroke();
      ctx.fillStyle = rgba('#ffffff', 0.9); ctx.beginPath(); ctx.arc(0, 0, r * 0.16, 0, TAU); ctx.fill();
      ctx.restore();
    },
    rune(ctx, r, s) {
      ctx.strokeStyle = rgba(s.accent, 0.85); ctx.lineWidth = r * 0.06;
      ctx.beginPath(); ctx.moveTo(0, -r * 0.66); ctx.lineTo(r * 0.44, r * 0.34); ctx.lineTo(-r * 0.44, r * 0.34); ctx.closePath(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-r * 0.3, -r * 0.1); ctx.lineTo(r * 0.3, -r * 0.1); ctx.stroke();
      ctx.fillStyle = rgba('#ffffff', 0.9); ctx.beginPath(); ctx.arc(0, r * 0.08, r * 0.08, 0, TAU); ctx.fill();
    },
    prism(ctx, r, s) {
      const cols = [s.primary, s.secondary, s.accent];
      for (let i = 0; i < 6; i += 1) {
        ctx.fillStyle = rgba(cols[i % 3], 0.55);
        ctx.beginPath(); ctx.moveTo(0, 0);
        ctx.arc(0, 0, r, (i * TAU) / 6, ((i + 1) * TAU) / 6); ctx.closePath(); ctx.fill();
      }
      ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.beginPath(); ctx.arc(0, 0, r * 0.15, 0, TAU); ctx.fill();
    },
    crystal(ctx, r, s) {
      ctx.fillStyle = rgba('#ffffff', 0.16);
      ctx.beginPath(); ctx.moveTo(-r * 0.6, -r * 0.5); ctx.lineTo(r * 0.1, -r * 0.72); ctx.lineTo(r * 0.55, 0); ctx.lineTo(-r * 0.2, r * 0.45); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = rgba(s.accent, 0.8); ctx.lineWidth = r * 0.05; ctx.stroke();
      ctx.strokeStyle = rgba(s.accent, 0.5); ctx.beginPath(); ctx.moveTo(-r * 0.6, -r * 0.5); ctx.lineTo(r * 0.55, 0); ctx.lineTo(-r * 0.2, r * 0.45); ctx.stroke();
    },
    ripple(ctx, r, s, t) {
      for (let i = 0; i < 4; i += 1) {
        const k = (t * 0.4 + i * 0.25) % 1;
        ctx.strokeStyle = rgba(s.accent, 0.5 * (1 - k) + 0.1); ctx.lineWidth = r * 0.07;
        ctx.beginPath(); ctx.arc(0, r * 0.2, r * (0.15 + k * 0.7), Math.PI * 1.08, Math.PI * 1.92); ctx.stroke();
      }
    },
    scale(ctx, r, s) {
      ctx.strokeStyle = rgba(s.accent, 0.55); ctx.lineWidth = r * 0.045;
      for (let row = 0; row < 5; row += 1) {
        for (let col = 0; col < 5; col += 1) {
          const x = -r * 0.72 + col * r * 0.36 + (row % 2) * r * 0.18;
          const y = -r * 0.7 + row * r * 0.34;
          ctx.beginPath(); ctx.arc(x, y, r * 0.16, 0, Math.PI); ctx.stroke();
        }
      }
    },
    eye(ctx, r, s, t) {
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.ellipse(0, 0, r * 0.62, r * 0.38, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = rgba(s.accent, 0.95);
      ctx.beginPath(); ctx.arc(Math.sin(t * 0.8) * r * 0.1, 0, r * 0.24, 0, TAU); ctx.fill();
      ctx.fillStyle = '#08080f';
      ctx.beginPath(); ctx.arc(Math.sin(t * 0.8) * r * 0.1, 0, r * 0.11, 0, TAU); ctx.fill();
    },
    halo(ctx, r, s, t) {
      const bob = Math.sin(t * 1.8) * r * 0.05;
      ctx.strokeStyle = rgba(s.accent, 0.95); ctx.lineWidth = r * 0.09;
      ctx.beginPath(); ctx.ellipse(0, -r * 0.62 + bob, r * 0.44, r * 0.16, 0, 0, TAU); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = r * 0.03;
      ctx.beginPath(); ctx.ellipse(0, -r * 0.62 + bob, r * 0.52, r * 0.2, 0, 0, TAU); ctx.stroke();
      ctx.fillStyle = rgba('#ffffff', 0.9); ctx.beginPath(); ctx.arc(0, 0, r * 0.13, 0, TAU); ctx.fill();
    },
    void(ctx, r, s, t) {
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 0.85);
      g.addColorStop(0, '#000000'); g.addColorStop(0.45, rgba(s.secondary, 0.95)); g.addColorStop(1, rgba(s.primary, 0.1));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();
      for (let i = 0; i < 14; i += 1) {
        const a = (i / 14) * TAU + t * 0.25;
        ctx.fillStyle = rgba('#ffffff', 0.3 + 0.3 * Math.sin(t * 2 + i));
        ctx.beginPath(); ctx.arc(Math.cos(a) * r * 0.62, Math.sin(a) * r * 0.62, r * 0.025, 0, TAU); ctx.fill();
      }
    },
    infinity(ctx, r, s) {
      ctx.strokeStyle = rgba(s.accent, 0.9); ctx.lineWidth = r * 0.1; ctx.lineCap = 'round';
      ctx.beginPath();
      for (let i = 0; i <= 64; i += 1) {
        const a = (i / 64) * TAU;
        const x = (r * 0.62 * Math.cos(a)) / (1 + Math.sin(a) * Math.sin(a));
        const y = (r * 0.62 * Math.sin(a) * Math.cos(a)) / (1 + Math.sin(a) * Math.sin(a));
        if (i === 0) ctx.moveTo(x * 1.35, y * 1.35); else ctx.lineTo(x * 1.35, y * 1.35);
      }
      ctx.stroke();
    },
    crown(ctx, r, s) {
      ctx.fillStyle = rgba(s.accent, 0.95);
      ctx.beginPath();
      ctx.moveTo(-r * 0.62, r * 0.2); ctx.lineTo(-r * 0.62, -r * 0.28); ctx.lineTo(-r * 0.3, r * 0.02);
      ctx.lineTo(0, -r * 0.48); ctx.lineTo(r * 0.3, r * 0.02); ctx.lineTo(r * 0.62, -r * 0.28);
      ctx.lineTo(r * 0.62, r * 0.2); ctx.closePath(); ctx.fill();
      ctx.fillStyle = rgba('#ffffff', 0.85);
      for (let i = -1; i <= 1; i += 1) { ctx.beginPath(); ctx.arc(i * r * 0.34, r * 0.32, r * 0.06, 0, TAU); ctx.fill(); }
    },
    genesis(ctx, r, s, t) {
      ctx.save(); ctx.rotate(t * 0.35);
      for (let i = 0; i < 12; i += 1) {
        ctx.rotate(TAU / 12);
        const g = ctx.createLinearGradient(0, 0, r * 0.9, 0);
        g.addColorStop(0, rgba('#ffffff', 0.9)); g.addColorStop(1, rgba(s.accent, 0));
        ctx.fillStyle = g; ctx.fillRect(r * 0.1, -r * 0.018, r * 0.82, r * 0.036);
      }
      ctx.restore();
      ctx.fillStyle = rgba('#ffffff', 0.95); ctx.beginPath(); ctx.arc(0, 0, r * 0.2, 0, TAU); ctx.fill();
      ctx.strokeStyle = rgba(s.accent, 0.7); ctx.lineWidth = r * 0.04;
      ctx.beginPath(); ctx.arc(0, 0, r * 0.36, 0, TAU); ctx.stroke();
    },
    glitch(ctx, r, s, t) {
      const j = ((Math.floor(t * 8) % 3) - 1) * r * 0.06;
      ctx.fillStyle = rgba(s.accent, 0.75); ctx.fillRect(-r, -r * 0.2 + j, r * 2, r * 0.17);
      ctx.fillStyle = 'rgba(34,211,238,0.55)'; ctx.fillRect(-r, r * 0.18 - j, r * 2, r * 0.12);
      ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(-r * 0.6, -r * 0.55, r * 0.9, r * 0.08);
    },
    matrix(tx, r, s, t) {
      for (let i = 0; i < 8; i += 1) {
        const x = -r * 0.75 + (i % 4) * r * 0.48;
        const off = ((t * 0.6 + i * 0.31) % 1);
        for (let k = 0; k < 6; k += 1) {
          const y = -r + ((k / 6 + off) % 1) * r * 2;
          tx.fillStyle = rgba(i % 3 === 0 ? '#ffffff' : s.accent, 0.16 + 0.55 * (1 - Math.abs(y) / r));
          tx.fillRect(x, y, r * 0.055, r * 0.15);
        }
      }
    },
    ultimax(ctx, r, s, t) {
      const g = ctx.createRadialGradient(0, 0, r * 0.1, 0, 0, r);
      g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(0.4, rgba(s.accent, 0.55)); g.addColorStop(1, 'rgba(0,0,0,0.15)');
      ctx.fillStyle = g; ctx.fillRect(-r, -r, r * 2, r * 2);
      ctx.save(); ctx.rotate(-t * 0.7);
      for (let i = 0; i < 3; i += 1) {
        ctx.strokeStyle = rgba(i === 1 ? '#ffffff' : s.accent, 0.85); ctx.lineWidth = r * (0.05 + i * 0.02);
        ctx.beginPath(); ctx.arc(0, 0, r * (0.4 + i * 0.2), 0, Math.PI * 1.5); ctx.stroke();
      }
      ctx.restore();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(0, 0, r * 0.12, 0, TAU); ctx.fill();
    },
    rainbow(ctx, r, s, t) {
      const hue = (t * 90) % 360;
      const bands = 9;
      for (let i = 0; i < bands; i += 1) {
        ctx.beginPath(); ctx.moveTo(0, 0);
        ctx.arc(0, 0, r * 1.02, (i * TAU) / bands + t * 0.5, ((i + 1) * TAU) / bands + t * 0.5);
        ctx.closePath();
        ctx.fillStyle = hsl(hue + (i * 360) / bands, 88, i % 2 ? 62 : 52);
        ctx.fill();
      }
      const g = ctx.createRadialGradient(-r * 0.2, -r * 0.25, 0, 0, 0, r * 0.9);
      g.addColorStop(0, 'rgba(255,255,255,0.95)'); g.addColorStop(0.5, 'rgba(255,255,255,0.18)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; ctx.fillRect(-r, -r, r * 2, r * 2);
      ctx.save(); ctx.rotate(-t * 0.9);
      ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = r * 0.045;
      for (let i = 0; i < 2; i += 1) { ctx.beginPath(); ctx.arc(0, 0, r * (0.62 + i * 0.2), 0, Math.PI * 1.2); ctx.stroke(); }
      ctx.restore();
    },
  };

  P.matrix = P.matrix;

  /* ---------- main ball draw ---------- */
  function drawBall(ctx, skin, x, y, r, t, opts) {
    const o = opts || {};
    const s = skin || { primary: '#7c3aed', secondary: '#22d3ee', accent: '#ffffff', pattern: 'solid', rarity: 'COMMON' };
    const time = t || 0;
    const rare = (s.rarity || 'COMMON');
    const glow = o.glow === false ? 0 : r * (o.glowScale || 0.7);
    ctx.save();
    ctx.translate(x, y);
    if (o.alpha != null) ctx.globalAlpha = o.alpha;

    // motion trail
    if (o.trail && o.trail.x != null) {
      const dx = o.trail.x - x; const dy = o.trail.y - y;
      const d = Math.hypot(dx, dy);
      if (d > 2) {
        const steps = Math.min(6, Math.ceil(d / (r * 0.5)));
        for (let i = 1; i <= steps; i += 1) {
          const k = i / (steps + 1);
          ctx.globalAlpha = (o.alpha != null ? o.alpha : 1) * 0.16 * (1 - k);
          ctx.fillStyle = s.accent || s.primary;
          ctx.beginPath(); ctx.arc(-dx * k * 0.7, -dy * k * 0.7, r * (1 - k * 0.45), 0, TAU); ctx.fill();
        }
        ctx.globalAlpha = o.alpha != null ? o.alpha : 1;
      }
    }

    if (glow > 0) { ctx.shadowColor = s.glow || s.accent || s.primary; ctx.shadowBlur = glow; }
    const body = ctx.createRadialGradient(-r * 0.34, -r * 0.4, r * 0.12, 0, 0, r * 1.04);
    body.addColorStop(0, shade(s.primary || '#7c3aed', 0.34));
    body.addColorStop(0.55, s.primary || '#7c3aed');
    body.addColorStop(1, shade(s.secondary || '#101a33', -0.42));
    ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fillStyle = body; ctx.fill();
    ctx.shadowBlur = 0;

    // pattern
    if (rare !== 'COMMON' || true) {
      ctx.save();
      ctx.beginPath(); ctx.arc(0, 0, r * 0.985, 0, TAU); ctx.clip();
      const fn = P[s.pattern] || P.solid;
      fn(ctx, r, s, time);
      // depth shading
      const sh = ctx.createLinearGradient(0, -r, 0, r);
      sh.addColorStop(0, 'rgba(255,255,255,0.14)');
      sh.addColorStop(0.45, 'rgba(255,255,255,0)');
      sh.addColorStop(1, 'rgba(0,0,0,0.34)');
      ctx.fillStyle = sh; ctx.fillRect(-r, -r, r * 2, r * 2);
      ctx.restore();
    }

    // specular
    ctx.save();
    ctx.beginPath(); ctx.arc(0, 0, r * 0.94, 0, TAU); ctx.clip();
    const spec = ctx.createRadialGradient(-r * 0.4, -r * 0.5, 0, -r * 0.4, -r * 0.5, r * 0.95);
    spec.addColorStop(0, 'rgba(255,255,255,0.55)'); spec.addColorStop(0.35, 'rgba(255,255,255,0.12)'); spec.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = spec; ctx.fillRect(-r, -r, r * 2, r * 2);
    ctx.restore();

    // rim
    ctx.lineWidth = Math.max(1.4, r * 0.075);
    ctx.strokeStyle = rgba(s.accent || '#ffffff', 0.85);
    ctx.beginPath(); ctx.arc(0, 0, r - ctx.lineWidth * 0.4, 0, TAU); ctx.stroke();
    if (rare === 'GODMAX' || rare === 'ULTIMAX' || rare === 'GODLY') {
      const hue = (time * 90) % 360;
      ctx.strokeStyle = hsl(hue, 95, 68); ctx.lineWidth = Math.max(1, r * 0.05);
      ctx.beginPath(); ctx.arc(0, 0, r + r * 0.09, 0, TAU); ctx.stroke();
    }

    // dash-ready / status ring
    if (o.ring) {
      ctx.strokeStyle = o.ring; ctx.lineWidth = Math.max(1.5, r * 0.07);
      ctx.beginPath(); ctx.arc(0, 0, r + r * 0.16, 0, TAU); ctx.stroke();
    }
    ctx.restore();
  }

  /* ---------- preview mounting ---------- */
  const mounts = [];
  let raf = null;
  function mount(canvas, getSkin) {
    if (!canvas) return;
    const entry = { canvas, getSkin, ctx: canvas.getContext('2d'), dpr: 1 };
    const idx = mounts.findIndex((m) => m.canvas === canvas);
    if (idx >= 0) mounts[idx] = entry; else mounts.push(entry);
    resize(entry);
    if (!raf) raf = requestAnimationFrame(loop);
  }
  function resize(entry) {
    const rect = entry.canvas.getBoundingClientRect();
    const w = Math.max(32, rect.width || entry.canvas.width || 64);
    const h = Math.max(32, rect.height || entry.canvas.height || 64);
    const dpr = Math.min(2.5, window.devicePixelRatio || 1);
    entry.canvas.width = Math.round(w * dpr);
    entry.canvas.height = Math.round(h * dpr);
    entry.dpr = dpr;
    entry.size = w;
  }
  function loop(now) {
    const t = now / 1000;
    for (const m of mounts) {
      const rect = m.canvas.getBoundingClientRect();
      if (rect.width < 2) continue;
      if (Math.abs((m.size || 0) - rect.width) > 1) resize(m);
      const ctx = m.ctx;
      const skin = m.getSkin();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, m.canvas.width, m.canvas.height);
      const cx = m.canvas.width / 2; const cy = m.canvas.height / 2;
      const r = (m.canvas.width / 2) * 0.78;
      drawBall(ctx, skin, cx, cy, r, t, { glow: true, glowScale: 1.05 });
    }
    raf = requestAnimationFrame(loop);
  }
  function unmount(canvas) {
    const idx = mounts.findIndex((m) => m.canvas === canvas);
    if (idx >= 0) mounts.splice(idx, 1);
  }

  window.BAL = { drawBall, mount, unmount, mix, shade, rgba, hsl, hexToRgb, seeded, PATTERNS: P };
})();
