import { useEffect } from 'react';

/**
 * Ambient ASCII field — organic drifting glyph cloud (homepage background).
 * Ported from the original page's ascii_background script. Runs on its OWN canvas
 * behind the statue. David's silhouette is punched out so glyphs never show behind
 * the head. The canvas element is owned by App (canvasRef) and shared with the
 * shatter-dive snapshot.
 */
export default function AsciiBackground({ canvasRef }) {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: true });

    const W = 1440, H = 750;                    // stage design size
    function resize() {
      const DPR = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(W * DPR);
      canvas.height = Math.floor(H * DPR);
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    }
    resize();
    window.addEventListener('resize', resize);

    // Locked-in defaults (tuned via the studio panel)
    const CFG = {
      density: '■▪·· ',        // Dot Matrix
      tint: { r: 209, g: 209, b: 209 },
      opacity: 0.51, cell: 6, gscale: 0.45, scale: 1.8,
      detail: 1.9, wobble: 1, morph: 1.5, drift: 1.5,
      flicker: 0.21, fps: 30, invert: false,
      follow: true, lag: 0.02,
      contrast: 1.0,
    };

    let ptrX = window.innerWidth / 2, ptrY = window.innerHeight / 2;
    const onMove = (e) => { ptrX = e.clientX; ptrY = e.clientY; };
    window.addEventListener('pointermove', onMove, { passive: true });
    let curX = 0, curY = 0;   // eased follow centre (trails the cursor)

    const STATUE_RECT = { x: 329, y: -10, w: 782, h: 838 };
    const maskImg = new Image();
    let maskReady = false;
    maskImg.onload = () => { maskReady = true; };
    maskImg.src = 'david_before.png';

    // value noise + fbm
    function hash(x, y) { const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return n - Math.floor(n); }
    function smooth(t) { return t * t * (3 - 2 * t); }
    function noise2(x, y) {
      const ix = Math.floor(x), iy = Math.floor(y);
      const fx = x - ix, fy = y - iy, ux = smooth(fx), uy = smooth(fy);
      const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
      return a * (1 - ux) * (1 - uy) + b * ux * (1 - uy) + c * (1 - ux) * uy + d * ux * uy;
    }
    function fbm(x, y, oct) {
      let v = 0, amp = 0.5, freq = 1, norm = 0;
      for (let i = 0; i < oct; i++) { v += amp * noise2(x * freq, y * freq); norm += amp; amp *= 0.5; freq *= 2; }
      return v / norm;
    }
    function smoothstepf(a, b, x) { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }

    function shapeField(nx, ny, t, scale, detail, wobble, cx, cy) {
      const aspect = W / H;
      const sx = (nx - 0.5) * aspect, sy = (ny - 0.5);
      const mx = sx - cx, my = sy - cy;
      const ang = Math.atan2(my, mx);
      let r = Math.hypot(mx, my) / (0.34 * scale);
      r += (Math.sin(ang * 3 + t * 0.6) * 0.10 + Math.sin(ang * 5 - t * 0.4) * 0.06 + Math.sin(ang * 2 + t * 0.25) * 0.12) * wobble;
      r += (fbm(mx * 1.6 * detail + t * 0.15, my * 1.6 * detail - t * 0.12, 4) - 0.5) * 0.9 * wobble;
      const mask = 1 - smoothstepf(0.55, 1.15, r);
      const tex = fbm(sx * 3.2 * detail - t * 0.2, sy * 3.2 * detail + t * 0.18, 5);
      return Math.max(0, Math.min(1, mask * (0.35 + 0.85 * tex)));
    }

    let lastDraw = 0;
    let raf = 0;
    const t0 = performance.now();
    function draw(now) {
      raf = requestAnimationFrame(draw);
      if (now - lastDraw < 1000 / CFG.fps) return;
      lastDraw = now;

      const elapsed = (now - t0) / 1000;
      const t = elapsed * CFG.morph;
      const dt = elapsed * CFG.drift;
      const aspect = W / H;

      const wanderX = (Math.sin(dt * 0.047) * 0.75 + Math.sin(dt * 0.019) * 0.25) * 0.70;
      const wanderY = (Math.cos(dt * 0.039) * 0.74 + Math.sin(dt * 0.026) * 0.26) * 0.44;

      let anchorX = 0, anchorY = 0, wanderScale = 1.0;
      if (CFG.follow) {
        const rect = canvas.getBoundingClientRect();
        anchorX = ((ptrX - rect.left) / rect.width - 0.5) * aspect;
        anchorY = ((ptrY - rect.top) / rect.height - 0.5);
        wanderScale = 0.45;
      }
      const k = 1 - Math.pow(1 - CFG.lag, 60 / CFG.fps);
      curX += (anchorX - curX) * k;
      curY += (anchorY - curY) * k;
      const cx = curX + wanderX * wanderScale;
      const cy = curY + wanderY * wanderScale;

      const { cell, opacity, scale, detail, wobble, flicker, invert, density, tint, gscale, contrast } = CFG;

      ctx.clearRect(0, 0, W, H);                 // transparent → black stage shows through
      ctx.font = `${cell * gscale}px "SF Mono","Menlo",Consolas,monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const cols = Math.ceil(W / cell), rows = Math.ceil(H / cell);
      for (let gy = 0; gy < rows; gy++) {
        const py = gy * cell + cell * 0.5, ny = py / H;
        for (let gx = 0; gx < cols; gx++) {
          const px = gx * cell + cell * 0.5, nx = px / W;
          let v = shapeField(nx, ny, t, scale, detail, wobble, cx, cy);
          if (invert) v = 1 - v;
          if (flicker > 0) v += (Math.random() - 0.5) * flicker * 0.6;
          v = (v - 0.5) * contrast + 0.5;
          v = Math.max(0, Math.min(1, v));
          if (v < 0.06) continue;
          const ch = density[Math.floor((1 - v) * (density.length - 1))];
          if (ch === ' ') continue;
          ctx.fillStyle = `rgba(${tint.r},${tint.g},${tint.b},${(opacity * v * v).toFixed(3)})`;
          ctx.fillText(ch, px, py);
        }
      }

      if (maskReady) {
        ctx.save();
        ctx.globalCompositeOperation = 'destination-out';
        ctx.drawImage(maskImg, STATUE_RECT.x, STATUE_RECT.y, STATUE_RECT.w, STATUE_RECT.h);
        ctx.restore();
      }
    }
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', onMove);
    };
  }, [canvasRef]);

  return <canvas className="bg-ascii" id="asciiBgCanvas" aria-hidden="true" ref={canvasRef} />;
}
