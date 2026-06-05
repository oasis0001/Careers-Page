import { useEffect } from 'react';

/**
 * Animated ASCII Dither — renders the man's head (david_before.png) onto the statue
 * canvas as drifting monospace glyphs. Ported verbatim from the original page.
 * The canvas is owned by App (canvasRef) and reused by the shatter-dive snapshot.
 */
export default function Statue({ canvasRef }) {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // 2x oversample so characters stay crisp when the stage scales up.
    const OVERSAMPLE = 2;
    const W = 782 * OVERSAMPLE;
    const H = 838 * OVERSAMPLE;
    canvas.width = W;
    canvas.height = H;

    const ctx = canvas.getContext('2d', { alpha: true });

    const offscreen = document.createElement('canvas');
    offscreen.width = W;
    offscreen.height = H;
    const offCtx = offscreen.getContext('2d', { willReadFrequently: true });

    const RES = 6 * OVERSAMPLE;
    const NOISE = 132;
    const FPS = 35;
    const THRESH = 1.7;
    const CONTRAST = 1.1;
    const SHADOW_LIFT = 49;
    const CHARSET = 'Ñ@#W$9876543210?!abc;:+=-,._ ';
    const TINT = { r: 0x1a, g: 0x56, b: 0xff };

    const img = new Image();
    let ready = false;
    let lastDraw = 0;
    let raf = 0;

    img.onload = () => {
      offCtx.drawImage(img, 0, 0, W, H);
      ready = true;
    };
    img.src = 'david_before.png';

    function frame(ts) {
      raf = requestAnimationFrame(frame);
      if (!ready) return;
      const interval = 1000 / FPS;
      if (ts - lastDraw < interval) return;
      lastDraw = ts;

      ctx.clearRect(0, 0, W, H);
      ctx.font = `bold ${RES}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const pixels = offCtx.getImageData(0, 0, W, H).data;

      for (let y = 0; y < H; y += RES) {
        for (let x = 0; x < W; x += RES) {
          const i = (y * W + x) * 4;
          const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2], a = pixels[i + 3];

          if (a < 128) continue;

          let brightness = r * 0.299 + g * 0.587 + b * 0.114;
          brightness = ((brightness / 255 - 0.5) * CONTRAST + 0.5) * 255;
          brightness = brightness + SHADOW_LIFT * (1 - Math.max(0, Math.min(255, brightness)) / 255);

          const noise = (Math.random() - 0.5) * NOISE;
          brightness = brightness * THRESH + noise;
          brightness = Math.max(0, Math.min(255, brightness));

          if (brightness < 10) continue;

          const charIndex = Math.floor((1 - brightness / 255) * (CHARSET.length - 1));
          const intensity = brightness / 255;
          ctx.fillStyle = `rgb(${TINT.r * intensity}, ${TINT.g * intensity}, ${TINT.b * intensity})`;
          ctx.fillText(CHARSET[charIndex], x + RES / 2, y + RES / 2);
        }
      }
    }

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [canvasRef]);

  return <canvas className="statue" id="statueCanvas" aria-hidden="true" ref={canvasRef} />;
}
