import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

const CLOSE_BTN_STYLE = {
  position: 'absolute', top: '30px', right: '40px',
  fontFamily: "'JetBrains Mono', monospace", fontSize: '11px',
  color: 'var(--text-muted)', cursor: 'pointer',
  border: '1px solid rgba(255,255,255,0.15)', padding: '8px 16px', letterSpacing: '1px',
};

/**
 * Brain ASCII scene — rotating dithered Brain.glb + orbiting AI tagline screens.
 * Ported verbatim from the original `brainAscii` IIFE. Exposes { open, close,
 * preload, isOpen } via ref. open(true) plays the fly-in. The (hidden) dither
 * tuning panel is preserved for fidelity.
 */
const BrainAsciiOverlay = forwardRef(function BrainAsciiOverlay(_props, ref) {
  const overlayRef = useRef(null);
  const displayRef = useRef(null);
  const svgRef = useRef(null);
  const labelsRef = useRef(null);
  const closeBtnRef = useRef(null);
  const apiRef = useRef(null);

  useImperativeHandle(ref, () => ({
    open: (fly) => apiRef.current?.open(fly),
    close: () => apiRef.current?.close(),
    preload: () => apiRef.current?.preload(),
    isOpen: () => apiRef.current?.isOpen() ?? false,
  }), []);

  useEffect(() => {
    const THREE = window.THREE;
    const gsap = window.gsap;
    if (typeof THREE === 'undefined') {
      apiRef.current = { open() {}, close() {}, preload() {}, isOpen: () => false };
      return;
    }

    const overlay = overlayRef.current;
    const display = displayRef.current;
    const svg = svgRef.current;
    const labels = labelsRef.current;
    const closeBtn = closeBtnRef.current;
    const ctx = display.getContext('2d', { alpha: false });

    const W = 1440, H = 750;
    display.width = W; display.height = H;

    let RES = 9, NOISE = 47, FPS = 36, THRESH = 1.7, CONTRAST = 2.3, SHADOW_LIFT = 28;
    let CHARSET = '#*+-. ';
    let TINT = { r: 0xff, g: 0xff, b: 0xff };
    let MODE = 'ascii';
    let TONES = 2;
    let HIGHLIGHT = 1.0;

    let ROT_Y = 0.42;
    let TILT = { x: 0.0, y: -1.2, z: 0.0 };
    let ZOOM = 1.0;

    const POOL = [
      'BrainSpaceScreens/Frame 2147240451.png',
      'BrainSpaceScreens/Frame 2147240452.png',
      'BrainSpaceScreens/Group 2147235889.png',
      'BrainSpaceScreens/Group 2147235891.png',
      'BrainSpaceScreens/Group 2147235893.png',
      'BrainSpaceScreens/Group 2147235894.png',
      'BrainSpaceScreens/Group 2147235895.png',
      'BrainSpaceScreens/Group 2147235896.png',
      'BrainSpaceScreens/Group 2147235897.png',
      'BrainSpaceScreens/Group 2147235899.png',
    ];
    const TOP_ONLY = ['BrainSpaceScreens/Group 2147235899.png'];

    const IMG_SCALE = 0.12, IMG_MIN = 130, IMG_MAX = 360;
    function sizeImg(img) {
      const nw = img.naturalWidth;
      if (!nw) return;
      img.style.width = Math.max(IMG_MIN, Math.min(IMG_MAX, nw * IMG_SCALE)) + 'px';
    }

    let bag = [];
    function refillBag() {
      bag = POOL.slice();
      for (let i = bag.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [bag[i], bag[j]] = [bag[j], bag[i]];
      }
    }
    function drawTag(isTop) {
      if (!bag.length) refillBag();
      if (isTop) return bag.pop();
      for (let i = bag.length - 1; i >= 0; i--) {
        if (!TOP_ONLY.includes(bag[i])) return bag.splice(i, 1)[0];
      }
      refillBag();
      return drawTag(false);
    }

    let renderer, scene, camera, pivot, model, threeCanvas, offscreen, offCtx;
    let baseDistance = 3, R = 1, loaded = false, started = false;
    let isOpen = false, raf = 0, lastDraw = 0, lastT = performance.now();
    const introCam = { zoom: 1 };

    const anchors = [];

    function initThree() {
      threeCanvas = document.createElement('canvas');
      renderer = new THREE.WebGLRenderer({ canvas: threeCanvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
      renderer.setPixelRatio(1);
      renderer.setClearColor(0x000000, 0);
      renderer.setSize(W, H, false);

      offscreen = document.createElement('canvas'); offscreen.width = W; offscreen.height = H;
      offCtx = offscreen.getContext('2d', { willReadFrequently: true });

      scene = new THREE.Scene();
      camera = new THREE.PerspectiveCamera(45, W / H, 0.1, 100);
      camera.position.set(0, 0, 3);

      if (THREE.RectAreaLightUniformsLib) THREE.RectAreaLightUniformsLib.init();
      const light = new THREE.RectAreaLight(0xffffff, 6, 6, 6);
      light.position.set(6, 1, -4); light.lookAt(0, 0, 0); scene.add(light);

      const fill = new THREE.DirectionalLight(0xffffff, 0.45);
      fill.position.set(-5, 1.5, 2); scene.add(fill);

      scene.add(new THREE.HemisphereLight(0xffffff, 0x0a0a10, 0.2));

      pivot = new THREE.Group(); scene.add(pivot);

      const draco = new THREE.DRACOLoader();
      draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
      draco.setDecoderConfig({ type: 'js' });
      const gltf = new THREE.GLTFLoader();
      gltf.setDRACOLoader(draco);
      gltf.load('Brain.glb', (g) => {
        model = g.scene;
        model.traverse((n) => {
          if (n.isMesh) n.material = new THREE.MeshStandardMaterial({ color: new THREE.Color('#cfcfcf'), roughness: 0.78, metalness: 0.0 });
        });
        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        model.position.sub(center);
        const maxDim = Math.max(size.x, size.y, size.z);
        R = maxDim * 0.5;
        baseDistance = maxDim / (2 * Math.tan((camera.fov * Math.PI / 180) / 2));
        model.rotation.set(TILT.x, TILT.y, TILT.z);
        pivot.add(model);
        buildAnchors();
        loaded = true;
      }, undefined, (e) => console.warn('[brainAscii] Brain.glb load failed', e));
    }

    function buildAnchors() {
      const DIRS = [
        [0.55, 0.78, 0.30], [-0.42, 0.80, 0.45], [0.10, 0.82, -0.56],
        [0.50, -0.72, 0.48], [-0.58, -0.70, 0.40], [-0.15, -0.80, -0.58],
      ];
      DIRS.forEach((d) => {
        const dir = new THREE.Vector3(d[0], d[1], d[2]).normalize();
        const top = d[1] > 0;
        const dot = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        dot.setAttribute('width', '5'); dot.setAttribute('height', '5'); dot.setAttribute('class', 'brain-node');
        svg.appendChild(dot);
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('class', 'brain-leader'); svg.appendChild(line);
        const el = document.createElement('div'); el.className = 'brain-tag';
        const img = document.createElement('img');
        img.addEventListener('load', () => sizeImg(img));
        el.appendChild(img); labels.appendChild(el);
        anchors.push({ dir, top, dot, line, el, img, op: 0, hidden: true });
      });
    }

    function project(v) {
      const p = v.clone().project(camera);
      return { x: (p.x * 0.5 + 0.5) * W, y: (-p.y * 0.5 + 0.5) * H };
    }

    function updateLabels() {
      if (!loaded || !model) return;
      model.updateMatrixWorld();
      const q = new THREE.Quaternion(); model.getWorldQuaternion(q);
      const centerS = project(new THREE.Vector3(0, 0, 0));
      anchors.forEach((a) => {
        const world = a.dir.clone().multiplyScalar(R * 0.62).applyMatrix4(model.matrixWorld);
        const nrm = a.dir.clone().applyQuaternion(q).normalize();
        const toCam = camera.position.clone().sub(world).normalize();
        const front = nrm.dot(toCam) > 0.16;

        if (front && a.hidden) {
          a.img.src = drawTag(a.top);
          a.hidden = false;
        }
        if (!front) a.hidden = true;

        a.op += ((front ? 1 : 0) - a.op) * 0.16;

        const s = project(world);
        let dx = s.x - centerS.x, dy = s.y - centerS.y;
        const L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L;
        const off = 132;

        let lx = s.x + dx * off, ly = s.y + dy * off;

        const M = 14;
        const tw = a.el.offsetWidth || 0;
        const th = a.el.offsetHeight || 0;
        if (dx < 0) {
          lx = Math.min(lx, W - M);
          lx = Math.max(lx, M + tw);
        } else {
          lx = Math.max(lx, M);
          lx = Math.min(lx, W - M - tw);
        }
        ly = Math.max(ly, M + th / 2);
        ly = Math.min(ly, H - M - th / 2);

        a.dot.setAttribute('x', s.x - 2.5); a.dot.setAttribute('y', s.y - 2.5);
        a.dot.style.opacity = a.op;
        a.line.setAttribute('x1', s.x); a.line.setAttribute('y1', s.y);
        a.line.setAttribute('x2', lx); a.line.setAttribute('y2', ly);
        a.line.style.opacity = a.op * 0.7;
        a.el.style.opacity = a.op;
        a.el.style.transform = `translate(${lx}px, ${ly}px) translate(${dx < 0 ? '-100%' : '0'}, -50%)`;
      });
    }

    function dither() {
      ctx.fillStyle = '#010103'; ctx.fillRect(0, 0, W, H);
      ctx.font = `bold ${RES}px monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      if (!loaded) return;
      offCtx.clearRect(0, 0, W, H);
      offCtx.drawImage(threeCanvas, 0, 0, W, H);
      const px = offCtx.getImageData(0, 0, W, H).data;
      for (let y = 0; y < H; y += RES) {
        for (let x = 0; x < W; x += RES) {
          const i = (y * W + x) * 4;
          if (px[i + 3] < 128) continue;
          let b = px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114;
          b = ((b / 255 - 0.5) * CONTRAST + 0.5) * 255;
          b = b + SHADOW_LIFT * (1 - Math.max(0, Math.min(255, b)) / 255);
          b = b * THRESH + (Math.random() - 0.5) * NOISE;
          b = Math.max(0, Math.min(255, b));
          if (b < 10) continue;
          const lvl = Math.min(TONES - 1, Math.floor((b / 255) * TONES));
          const it = (lvl === TONES - 1) ? HIGHLIGHT : (lvl + 1) / TONES;
          const col = `rgb(${TINT.r * it}, ${TINT.g * it}, ${TINT.b * it})`;
          const cx = x + RES / 2, cy = y + RES / 2;

          if (MODE === 'halftone') {
            const rad = RES * 0.42;
            ctx.lineWidth = Math.max(0.5, it * RES * 0.2);
            ctx.strokeStyle = col;
            ctx.beginPath();
            ctx.arc(cx, cy, rad, 0, Math.PI * 2);
            ctx.stroke();
          } else {
            const ci = Math.floor((1 - it) * (CHARSET.length - 1));
            ctx.fillStyle = col;
            ctx.fillText(CHARSET[ci], cx, cy);
          }
        }
      }
    }

    function frame(now) {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.1, (now - lastT) / 1000); lastT = now;
      if (!isOpen) return;
      if (loaded) {
        if (model) model.rotation.set(TILT.x, TILT.y, TILT.z);
        pivot.rotation.y += ROT_Y * dt;
        camera.position.z = baseDistance * ZOOM * introCam.zoom;
        camera.lookAt(0, 0, 0);
        renderer.render(scene, camera);
      }
      if (now - lastDraw >= 1000 / FPS) { lastDraw = now; dither(); }
      updateLabels();
    }

    function preload() {
      if (!started) { initThree(); started = true; raf = requestAnimationFrame(frame); }
    }
    function open(fly) {
      if (isOpen) return;
      preload();
      isOpen = true;
      overlay.classList.add('inside-brainAscii');
      if (fly) {
        introCam.zoom = 3.4;
        gsap.to(introCam, { zoom: 1, duration: 2.6, ease: 'power4.inOut' });
      }
    }
    function close() {
      if (!isOpen) return;
      isOpen = false;
      overlay.classList.remove('inside-brainAscii');
    }

    const onCloseClick = (e) => { e.stopPropagation(); close(); };
    closeBtn.addEventListener('click', onCloseClick);
    const onKeyDown = (e) => { if (e.key === 'Escape' && isOpen) close(); };
    document.addEventListener('keydown', onKeyDown);

    // === Dither tuning panel wiring (hidden dev panel — preserved for fidelity) ===
    const CHARSETS = {
      ascii: 'Ñ@#W$9876543210?!abc;:+=-,._ ',
      blocks: '█▓▒░ ',
      binary: '10 ',
      minimal: '#*+-. ',
    };
    const hexToRgb = (hex) => {
      const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
      return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) }
        : { r: 255, g: 255, b: 255 };
    };
    const $ = (id) => document.getElementById(id);
    const boundControls = [];
    const bind = (id, valId, fn, fixed) => {
      const el = $(id); if (!el) return;
      const vEl = valId ? $(valId) : null;
      const handler = () => {
        fn(el.value);
        if (vEl) vEl.textContent = (fixed != null) ? (+el.value).toFixed(fixed) : el.value;
      };
      el.addEventListener('input', handler);
      boundControls.push([el, handler]);
    };

    bind('bd-style', null, (v) => {
      if (v === 'halftone') { MODE = 'halftone'; }
      else { MODE = 'ascii'; CHARSET = CHARSETS[v] || CHARSET; }
    });
    bind('bd-tint', null, (v) => { TINT = hexToRgb(v); });
    bind('bd-tones', 'bd-tonesVal', (v) => { TONES = parseInt(v); }, null);
    bind('bd-highlight', 'bd-highlightVal', (v) => { HIGHLIGHT = parseFloat(v); }, 2);
    bind('bd-res', 'bd-resVal', (v) => { RES = parseInt(v); }, null);
    bind('bd-contrast', 'bd-contrastVal', (v) => { CONTRAST = parseFloat(v); }, 1);
    bind('bd-thresh', 'bd-threshVal', (v) => { THRESH = parseFloat(v); }, 1);
    bind('bd-shadow', 'bd-shadowVal', (v) => { SHADOW_LIFT = parseInt(v); }, null);
    bind('bd-noise', 'bd-noiseVal', (v) => { NOISE = parseInt(v); }, null);
    bind('bd-fps', 'bd-fpsVal', (v) => { FPS = parseInt(v); }, null);
    bind('bd-spin', 'bd-spinVal', (v) => { ROT_Y = parseFloat(v); }, 2);
    bind('bd-tiltx', 'bd-tiltxVal', (v) => { TILT.x = parseFloat(v); }, 2);
    bind('bd-tilty', 'bd-tiltyVal', (v) => { TILT.y = parseFloat(v); }, 2);
    bind('bd-tiltz', 'bd-tiltzVal', (v) => { TILT.z = parseFloat(v); }, 2);
    bind('bd-zoom', 'bd-zoomVal', (v) => { ZOOM = parseFloat(v); }, 2);

    const dump = $('bd-dump');
    const onDump = () => {
      const tintHex = '#' + [TINT.r, TINT.g, TINT.b]
        .map((n) => n.toString(16).padStart(2, '0')).join('');
      console.log('[brainAscii] current settings:', {
        MODE, TONES, HIGHLIGHT, RES, NOISE, FPS, THRESH, CONTRAST, SHADOW_LIFT,
        CHARSET, TINT: tintHex,
        ROT_Y, TILT: { ...TILT }, ZOOM,
      });
    };
    if (dump) dump.addEventListener('click', onDump);

    apiRef.current = { open, close, preload, isOpen: () => isOpen };

    return () => {
      cancelAnimationFrame(raf);
      closeBtn.removeEventListener('click', onCloseClick);
      document.removeEventListener('keydown', onKeyDown);
      boundControls.forEach(([el, h]) => el.removeEventListener('input', h));
      if (dump) dump.removeEventListener('click', onDump);
      anchors.forEach((a) => { a.dot.remove(); a.line.remove(); a.el.remove(); });
      anchors.length = 0;
      if (renderer) renderer.dispose();
      apiRef.current = null;
    };
  }, []);

  return (
    <div id="brainAscii-overlay" ref={overlayRef}>
      <canvas id="brainSceneCanvas" ref={displayRef} />
      <svg id="brainLeaders" viewBox="0 0 1440 750" preserveAspectRatio="none" ref={svgRef} />
      <div id="brainLabels" ref={labelsRef} />
      <div className="brain-vignette" />
      <div className="btn-close-brain" ref={closeBtnRef} style={CLOSE_BTN_STYLE}>[ EXIT_BRAIN ]</div>

      {/* TEMPORARY tuning panel — hidden via CSS (display:none !important) */}
      <div id="brainDitherControls">
        <h2>Brain Dither Studio</h2>

        <div className="bd-group">
          <div className="bd-header"><span>Render Mode</span></div>
          <select id="bd-style" defaultValue="minimal">
            <option value="ascii">Standard ASCII (Ñ@#...)</option>
            <option value="blocks">Block Pixels (█ ▓ ▒ ░)</option>
            <option value="binary">Binary (1 0)</option>
            <option value="minimal">Minimal (# * + - .)</option>
            <option value="halftone">Circle Halftone (○ •)</option>
          </select>
        </div>

        <div className="bd-group">
          <div className="bd-header"><span>Tint Color</span></div>
          <input type="color" id="bd-tint" defaultValue="#ffffff" />
        </div>

        <div className="bd-group">
          <div className="bd-header"><span>Tones (posterize)</span><span id="bd-tonesVal" className="bd-val">2</span></div>
          <input type="range" id="bd-tones" min="2" max="8" defaultValue="2" />
        </div>

        <div className="bd-group">
          <div className="bd-header"><span>Highlight Intensity</span><span id="bd-highlightVal" className="bd-val">1.00</span></div>
          <input type="range" id="bd-highlight" min="0.2" max="1.0" step="0.05" defaultValue="1.0" />
        </div>

        <div className="bd-group">
          <div className="bd-header"><span>Grid Resolution</span><span id="bd-resVal" className="bd-val">13</span></div>
          <input type="range" id="bd-res" min="2" max="25" defaultValue="13" />
        </div>

        <div className="bd-group">
          <div className="bd-header"><span>Contrast</span><span id="bd-contrastVal" className="bd-val">2.3</span></div>
          <input type="range" id="bd-contrast" min="0.5" max="3.0" step="0.1" defaultValue="2.3" />
        </div>

        <div className="bd-group">
          <div className="bd-header"><span>Brightness Threshold</span><span id="bd-threshVal" className="bd-val">1.7</span></div>
          <input type="range" id="bd-thresh" min="0.1" max="2.0" step="0.1" defaultValue="1.7" />
        </div>

        <div className="bd-group">
          <div className="bd-header"><span>Shadow Brightness</span><span id="bd-shadowVal" className="bd-val">28</span></div>
          <input type="range" id="bd-shadow" min="0" max="200" defaultValue="28" />
        </div>

        <div className="bd-group">
          <div className="bd-header"><span>Animated Noise</span><span id="bd-noiseVal" className="bd-val">47</span></div>
          <input type="range" id="bd-noise" min="0" max="150" defaultValue="47" />
        </div>

        <div className="bd-group">
          <div className="bd-header"><span>Animation Speed (FPS)</span><span id="bd-fpsVal" className="bd-val">36</span></div>
          <input type="range" id="bd-fps" min="1" max="60" defaultValue="36" />
        </div>

        <div className="bd-group">
          <div className="bd-header"><span>Spin Speed</span><span id="bd-spinVal" className="bd-val">0.42</span></div>
          <input type="range" id="bd-spin" min="0" max="2" step="0.01" defaultValue="0.42" />
        </div>

        <div className="bd-group">
          <div className="bd-header"><span>Tilt X</span><span id="bd-tiltxVal" className="bd-val">0.00</span></div>
          <input type="range" id="bd-tiltx" min="-3.2" max="3.2" step="0.05" defaultValue="0" />
        </div>

        <div className="bd-group">
          <div className="bd-header"><span>Tilt Y</span><span id="bd-tiltyVal" className="bd-val">-1.20</span></div>
          <input type="range" id="bd-tilty" min="-3.2" max="3.2" step="0.05" defaultValue="-1.2" />
        </div>

        <div className="bd-group">
          <div className="bd-header"><span>Tilt Z</span><span id="bd-tiltzVal" className="bd-val">0.00</span></div>
          <input type="range" id="bd-tiltz" min="-3.2" max="3.2" step="0.05" defaultValue="0" />
        </div>

        <div className="bd-group">
          <div className="bd-header"><span>Zoom</span><span id="bd-zoomVal" className="bd-val">1.00</span></div>
          <input type="range" id="bd-zoom" min="0.5" max="3" step="0.05" defaultValue="1.0" />
        </div>

        <button className="bd-dump" id="bd-dump">Log current values to console</button>
      </div>
    </div>
  );
});

export default BrainAsciiOverlay;
