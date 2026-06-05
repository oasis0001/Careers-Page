import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

const CLOSE_BTN_STYLE = {
  position: 'absolute', top: '30px', right: '40px',
  fontFamily: "'JetBrains Mono', monospace", fontSize: '11px',
  color: 'var(--text-muted)', cursor: 'pointer',
  border: '1px solid rgba(255,255,255,0.15)', padding: '8px 16px', letterSpacing: '1px',
};

/**
 * Three.js "Inside the Brain" — shatter-dive into a wireframe typography void.
 * Ported verbatim from the original page's `brain` IIFE. Exposes { open, close,
 * isOpen } via ref. open(dest) with a `dest.reveal()` callback performs a
 * pass-through dive that lands in another section's scene (head / mouth) instead
 * of resting in the void (eye). Needs the homepage canvases (bg + statue) to
 * build the shatter-wall snapshot.
 */
const BrainOverlay = forwardRef(function BrainOverlay({ bgCanvasRef, statueCanvasRef }, ref) {
  const overlayRef = useRef(null);
  const canvasRef = useRef(null);
  const closeBtnRef = useRef(null);
  const apiRef = useRef(null);

  useImperativeHandle(ref, () => ({
    open: (dest) => apiRef.current?.open(dest),
    close: () => apiRef.current?.close(),
    isOpen: () => apiRef.current?.isOpen() ?? false,
  }), []);

  useEffect(() => {
    const THREE = window.THREE;
    const gsap = window.gsap;
    if (typeof THREE === 'undefined' || typeof gsap === 'undefined') {
      console.warn('[brain] missing THREE or gsap dependency');
      apiRef.current = { open: () => {}, close: () => {}, isOpen: () => false };
      return;
    }

    const overlay = overlayRef.current;
    const canvas = canvasRef.current;
    const closeBtn = closeBtnRef.current;
    const statueCanvas = statueCanvasRef.current;

    const W = 1440, H = 750;
    const CAM_HOME_Z = 600;
    const CAM_INSIDE_Z = -1800;
    const WALL_Z = 0;

    const FOV_HOME = 60;
    const FOV_DIVE = 92;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    renderer.setSize(W, H, false);
    renderer.setClearColor(0x010103, 1);

    const scene = new THREE.Scene();
    const VOID_BG = new THREE.Color(0x010103);
    scene.background = VOID_BG;
    scene.fog = new THREE.Fog(0x010103, 1400, 5200);

    const camera = new THREE.PerspectiveCamera(FOV_HOME, W / H, 0.1, 10000);
    camera.position.set(0, 0, CAM_HOME_Z);

    const RadialBlurCAShader = {
      uniforms: {
        tDiffuse: { value: null },
        uStrength: { value: 0.0 },
        uCenter: { value: new THREE.Vector2(0.5, 0.5) },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float uStrength;
        uniform vec2 uCenter;
        varying vec2 vUv;
        void main() {
          vec2 toCenter = uCenter - vUv;
          vec2 fromCenter = vUv - uCenter;
          vec4 col = vec4(0.0);
          float total = 0.0;
          float ca = uStrength * 0.018;
          const int N = 18;
          for (int i = 0; i < N; i++) {
            float t = float(i) / float(N - 1);
            float scale = t * uStrength * 0.55;
            vec2 base = vUv + toCenter * scale;
            float r = texture2D(tDiffuse, base + fromCenter * ca).r;
            float g = texture2D(tDiffuse, base).g;
            float b = texture2D(tDiffuse, base - fromCenter * ca).b;
            float a = texture2D(tDiffuse, base).a;
            float w = 1.0 - t * 0.55;
            col += vec4(r, g, b, a) * w;
            total += w;
          }
          gl_FragColor = col / total;
        }
      `,
    };

    let composer = null, blurPass = null;
    if (THREE.EffectComposer && THREE.RenderPass && THREE.ShaderPass) {
      composer = new THREE.EffectComposer(renderer);
      composer.setPixelRatio(renderer.getPixelRatio());
      composer.setSize(W, H);
      composer.addPass(new THREE.RenderPass(scene, camera));
      blurPass = new THREE.ShaderPass(RadialBlurCAShader);
      blurPass.renderToScreen = true;
      composer.addPass(blurPass);
    }
    function setBlur(v) { if (blurPass) blurPass.uniforms.uStrength.value = v; }

    const GRID_MAIN = new THREE.Color(0x5a5a5a);
    const GRID_GLOW = new THREE.Color(0xffffff);
    const GRID_GLOW_BLUE = new THREE.Color(0x3d7bff);
    const GRID_BLUE_PORTION = 1 / 11;

    const GRID_SWEEP_SPEED = 0.12;

    const gridFlow = {
      uTime: { value: 0 },
      uSpeed: { value: GRID_SWEEP_SPEED },
      uCellZ: { value: 500 },
      uCZ: { value: 0 },
      uPeriod: { value: 14 },
    };
    const gridMats = [];
    let gridCellZ = 500;
    let gridPeriodZ = 7000;

    function buildLattice(W, H, D, divX, divY, divZ, cz) {
      const hx = W / 2, hy = H / 2, hz = D / 2;
      const sx = W / divX, sy = H / divY, sz = D / divZ;
      const pos = [], rnd = [], type = [], flow = [];
      const seed3 = () => [Math.random(), Math.random(), Math.random()];
      const vertSeed = Array.from({ length: divX + 1 }, seed3);
      const rungSeed = Array.from({ length: divY + 1 }, seed3);
      const pushLine = (ax, ay, az, bx, by, bz, t, s) => {
        pos.push(ax, ay, az, bx, by, bz);
        type.push(t, t);
        flow.push(0, 1);
        rnd.push(s[0], s[1], s[2], s[0], s[1], s[2]);
      };
      for (let i = 0; i <= divX; i++) {
        for (let j = 0; j <= divY; j++) {
          pushLine(-hx + sx * i, -hy + sy * j, -hz + cz,
            -hx + sx * i, -hy + sy * j, hz + cz, 1.0, seed3());
        }
      }
      for (let k = 0; k <= divZ; k++) {
        const z = -hz + sz * k + cz;
        for (let j = 0; j <= divY; j++)
          pushLine(-hx, -hy + sy * j, z, hx, -hy + sy * j, z, 0.0, rungSeed[j]);
        for (let i = 0; i <= divX; i++)
          pushLine(-hx + sx * i, -hy, z, -hx + sx * i, hy, z, 0.0, vertSeed[i]);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('aType', new THREE.Float32BufferAttribute(type, 1));
      geo.setAttribute('aFlow', new THREE.Float32BufferAttribute(flow, 1));
      geo.setAttribute('aRnd', new THREE.Float32BufferAttribute(rnd, 3));
      return geo;
    }

    const GRID_VERT = `
      #include <common>
      #include <fog_pars_vertex>
      attribute float aType;
      attribute float aFlow;
      attribute vec3  aRnd;
      varying vec3  vWorld;
      varying float vType;
      varying float vFlow;
      varying vec3  vRnd;
      void main() {
        vType = aType;
        vFlow = aFlow;
        vRnd  = aRnd;
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorld = worldPosition.xyz;
        vec4 mvPosition = viewMatrix * worldPosition;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `;
    const GRID_FRAG = `
      #include <common>
      #include <fog_pars_fragment>
      uniform float uOpacity;
      uniform float uRailBase;
      uniform float uTime;
      uniform float uSpeed;
      uniform float uCellZ;
      uniform float uCZ;
      uniform float uPeriod;
      uniform vec3  uColor;
      uniform vec3  uGlow;
      uniform vec3  uGlowAlt;
      uniform float uBluePortion;
      varying vec3  vWorld;
      varying float vType;
      varying float vFlow;
      varying vec3  vRnd;

      void main() {
        bool  isRail = vType > 0.5;
        float base   = isRail ? uRailBase : uOpacity;
        float pulse  = 0.0;
        float blue   = 0.0;
        if (isRail) {
          float p  = vWorld.z / uCellZ - uTime * uSpeed + vRnd.x;
          float f  = fract(p);
          float dd = min(f, 1.0 - f);
          float head = exp(-(dd * dd) / 0.0016);
          float tail = exp(-(dd * dd) / 0.05) * 0.30;
          pulse = clamp(head + tail, 0.0, 1.0);
          float ch = fract(sin(vRnd.x * 127.1 + vRnd.y * 311.7 + vRnd.z * 74.7) * 43758.5453);
          blue = step(ch, uBluePortion);
        } else {
          float layer = floor((vWorld.z - uCZ) / uCellZ + 0.5);
          float lh    = fract(sin(mod(layer, uPeriod) * 91.37 + vRnd.y * 53.17) * 43758.5453);
          float dir   = fract(vRnd.z + lh) > 0.5 ? 1.0 : -1.0;
          float speed = (0.5 + fract(vRnd.y + lh) * 1.1) * uSpeed * 1.6;
          float head  = fract(uTime * speed * dir + vRnd.x + lh);
          float d     = vFlow - head;
          d           = d - floor(d + 0.5);
          float headG = exp(-(d * d) / 0.0016);
          float tail  = exp(-(d * d) / 0.05) * 0.32;
          pulse = clamp(headG + tail, 0.0, 1.0);
          float ch = fract(sin(mod(layer, uPeriod) * 57.31 + vRnd.x * 73.13 + lh * 19.7) * 43758.5453);
          blue = step(ch, uBluePortion);
        }
        vec3  glow = mix(uGlow, uGlowAlt, blue);
        float a   = clamp(base + pulse * 0.95, 0.0, 1.0);
        vec3  col = mix(uColor, glow, pulse) + glow * pulse * 0.55;
        gl_FragColor = vec4(col, a);
        #include <fog_fragment>
      }
    `;

    function gridMaterial(frameOpacity, railBase) {
      const mat = new THREE.ShaderMaterial({
        uniforms: Object.assign(
          THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
          {
            uOpacity: { value: frameOpacity },
            uRailBase: { value: railBase },
            uColor: { value: GRID_MAIN },
            uGlow: { value: GRID_GLOW },
            uGlowAlt: { value: GRID_GLOW_BLUE },
            uBluePortion: { value: GRID_BLUE_PORTION },
          },
          gridFlow
        ),
        vertexShader: GRID_VERT,
        fragmentShader: GRID_FRAG,
        transparent: true,
        depthWrite: false,
        fog: true,
      });
      gridMats.push(mat);
      return mat;
    }

    const COR_W = 5200;
    const COR_H = 2800;
    const COR_DEPTH = 26000;
    const COR_CELL = 520;
    const COR_PERIOD = 14;
    const COR_CZ = CAM_INSIDE_Z;
    const corDivX = Math.round(COR_W / COR_CELL);
    const corDivY = Math.round(COR_H / COR_CELL);
    const corDivZ = Math.round(COR_DEPTH / COR_CELL);
    gridCellZ = COR_DEPTH / corDivZ;
    gridPeriodZ = COR_PERIOD * gridCellZ;
    gridFlow.uCellZ.value = gridCellZ;
    gridFlow.uCZ.value = COR_CZ;
    gridFlow.uPeriod.value = COR_PERIOD;

    const gridMesh = new THREE.LineSegments(
      buildLattice(COR_W, COR_H, COR_DEPTH, corDivX, corDivY, corDivZ, COR_CZ),
      gridMaterial(0.16, 0.10)
    );
    gridMesh.renderOrder = -1;
    scene.add(gridMesh);

    const SCREEN_SCALE = 0.65;
    const SCREEN_SIDE_X = 1050;
    const SCREEN_TILT = 0.5;

    const SCREEN_LAYOUT = [
      { src: '3DSpaceScreens/Frame 2147240429.png', side: -1, z: 0.08, y: 240 },
      { src: '3DSpaceScreens/Frame 2147240438.png', side: 1, z: 0.26, y: -140 },
      { src: '3DSpaceScreens/Frame 2147240439.png', side: -1, z: 0.46, y: -260 },
      { src: '3DSpaceScreens/Frame 2147240442.png', side: 1, z: 0.66, y: 200, scale: 0.6 },
      { src: '3DSpaceScreens/Frame 2147240441.png', side: -1, z: 0.84, y: 40, sx: 0.83 },
    ];

    const screenGroup = new THREE.Group();
    scene.add(screenGroup);
    const screenTexLoader = new THREE.TextureLoader();

    const SCREEN_TILES = [-2, -1, 0, 1, 2];
    SCREEN_LAYOUT.forEach((cfg) => {
      const meshes = [];
      const tex = screenTexLoader.load(cfg.src, (t) => {
        t.minFilter = THREE.LinearFilter;
        t.magFilter = THREE.LinearFilter;
        const s = SCREEN_SCALE * (cfg.scale || 1);
        const w = t.image.width * s * (cfg.sx || 1);
        const h = t.image.height * s;
        meshes.forEach((m) => { m.scale.set(w, h, 1); m.visible = true; });
      });
      SCREEN_TILES.forEach((p) => {
        const mat = new THREE.MeshBasicMaterial({
          map: tex, transparent: true, side: THREE.DoubleSide, depthWrite: false,
        });
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
        mesh.position.set(
          cfg.side * SCREEN_SIDE_X,
          cfg.y,
          CAM_INSIDE_Z + (cfg.z + p) * gridPeriodZ
        );
        mesh.rotation.y = -cfg.side * SCREEN_TILT;
        mesh.renderOrder = 1;
        mesh.visible = false;
        screenGroup.add(mesh);
        meshes.push(mesh);
      });
    });

    const textGroup = new THREE.Group();
    scene.add(textGroup);

    const SHATTER_COLS = 12;
    const SHATTER_ROWS = 8;
    const WALL_W = 1340;
    const WALL_H = 698;
    let shatterGroup = null;

    function buildSnapshot() {
      const s = document.createElement('canvas');
      s.width = 1440; s.height = 750;
      const x = s.getContext('2d');
      x.fillStyle = '#010103';
      x.fillRect(0, 0, 1440, 750);
      try { const a = bgCanvasRef.current; if (a) x.drawImage(a, 0, 0, 1440, 750); } catch (e) {}
      try { x.drawImage(statueCanvas, 411, 16, 618, 670); } catch (e) {}
      const baseY = 716;
      const theFont = 'italic 400 161px "Instrument Serif", serif';
      const restFont = '300 145px "Inter Tight", system-ui, sans-serif';
      try { x.letterSpacing = '-7px'; } catch (e) {}
      x.fillStyle = 'rgba(255,255,255,0.82)';
      x.textBaseline = 'alphabetic';
      x.textAlign = 'left';
      x.font = theFont; const w1 = x.measureText('the ').width;
      x.font = restFont; const w2 = x.measureText('Ideal Candidate').width;
      const sx = (1440 - (w1 + w2)) / 2;
      x.font = theFont; x.fillText('the ', sx, baseY);
      x.font = restFont; x.fillText('Ideal Candidate', sx + w1, baseY);
      try { x.letterSpacing = '0px'; } catch (e) {}
      return s;
    }
    function buildShatterWall() {
      const tex = new THREE.CanvasTexture(buildSnapshot());
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;

      const fw = WALL_W / SHATTER_COLS;
      const fh = WALL_H / SHATTER_ROWS;
      const group = new THREE.Group();

      for (let r = 0; r < SHATTER_ROWS; r++) {
        for (let c = 0; c < SHATTER_COLS; c++) {
          const geo = new THREE.PlaneGeometry(fw, fh, 1, 1);
          const uv = geo.attributes.uv;
          const u0 = c / SHATTER_COLS;
          const u1 = (c + 1) / SHATTER_COLS;
          const v0 = 1 - (r + 1) / SHATTER_ROWS;
          const v1 = 1 - r / SHATTER_ROWS;
          uv.setXY(0, u0, v1);
          uv.setXY(1, u1, v1);
          uv.setXY(2, u0, v0);
          uv.setXY(3, u1, v0);
          uv.needsUpdate = true;

          const mat = new THREE.MeshBasicMaterial({
            map: tex,
            transparent: true,
            side: THREE.DoubleSide,
            depthWrite: false,
          });
          const mesh = new THREE.Mesh(geo, mat);

          const ox = (c - SHATTER_COLS / 2 + 0.5) * fw;
          const oy = (SHATTER_ROWS / 2 - r - 0.5) * fh;
          mesh.position.set(ox, oy, 0);
          mesh.userData.origin = { x: ox, y: oy, z: 0 };

          const angle = Math.atan2(oy, ox);
          const radius = Math.hypot(ox, oy);
          const blast = 3.2 + Math.random() * 1.8;
          mesh.userData.scatter = {
            x: Math.cos(angle) * (radius * blast + 500 + Math.random() * 450),
            y: Math.sin(angle) * (radius * blast + 500 + Math.random() * 450),
            z: 900 + Math.random() * 700,
            rx: (Math.random() - 0.5) * Math.PI * 3,
            ry: (Math.random() - 0.5) * Math.PI * 3,
            rz: (Math.random() - 0.5) * Math.PI * 3,
          };
          group.add(mesh);
        }
      }
      group.userData.texture = tex;
      return group;
    }
    function disposeShatter(group) {
      if (!group) return;
      scene.remove(group);
      group.children.forEach((m) => {
        m.geometry.dispose();
        m.material.dispose();
      });
      if (group.userData.texture) group.userData.texture.dispose();
    }

    let isOpen = false;
    let isAnimating = false;
    let mouseX = 0, mouseY = 0;
    let camX = 0, camY = 0;
    let rotX = 0, rotY = 0;
    const shake = { amt: 0 };
    const CAM_OFF_X = 260, CAM_OFF_Y = 120;

    const SCROLL_PUSH = 0.9;
    const SCROLL_FRICTION = 0.93;
    const SCROLL_MAXVEL = 340;
    let scrollZ = CAM_INSIDE_Z;
    let scrollVel = 0;

    function open(dest) {
      if (isOpen || isAnimating) return;
      isAnimating = true;

      const transitioning = !!dest;
      gridMesh.visible = !transitioning;
      scene.background = transitioning ? null : VOID_BG;
      renderer.setClearColor(0x010103, transitioning ? 0 : 1);
      if (transitioning) {
        overlay.style.background = 'transparent';
        overlay.style.zIndex = '40';
        closeBtn.style.display = 'none';
        dest.reveal();
      }

      camera.position.set(0, 0, CAM_HOME_Z);
      camera.rotation.set(0, 0, 0);
      camera.fov = FOV_HOME; camera.updateProjectionMatrix();
      camX = 0; camY = 0;
      rotX = 0; rotY = 0;
      shake.amt = 0;
      setBlur(0);

      shatterGroup = buildShatterWall();
      shatterGroup.position.z = WALL_Z;
      scene.add(shatterGroup);

      overlay.classList.add('inside-brain');

      const DUR = 2.6;
      const tl = gsap.timeline({
        onComplete: () => {
          disposeShatter(shatterGroup);
          shatterGroup = null;
          setBlur(0);
          shake.amt = 0;
          camera.fov = FOV_HOME; camera.updateProjectionMatrix();
          if (transitioning) {
            camera.position.set(0, 0, CAM_HOME_Z);
            camera.rotation.set(0, 0, 0);
            camX = 0; camY = 0; rotX = 0; rotY = 0;
            overlay.classList.remove('inside-brain');
            overlay.style.opacity = '';
            overlay.style.zIndex = '';
            overlay.style.background = '';
            closeBtn.style.display = '';
            gridMesh.visible = true;
            scene.background = VOID_BG;
            renderer.setClearColor(0x010103, 1);
            isAnimating = false;
            isOpen = false;
          } else {
            scrollZ = camera.position.z; scrollVel = 0;
            isAnimating = false;
            isOpen = true;
          }
        },
      });

      tl.to(camera.position, { z: CAM_INSIDE_Z, duration: DUR, ease: 'power4.inOut' }, 0);
      tl.to(camera.position, { x: CAM_OFF_X, y: CAM_OFF_Y, duration: DUR, ease: 'power2.inOut' }, 0);

      const fov = { v: FOV_HOME };
      const applyFov = () => { camera.fov = fov.v; camera.updateProjectionMatrix(); };
      tl.to(fov, { v: FOV_DIVE, duration: DUR * 0.45, ease: 'power2.in', onUpdate: applyFov }, 0);
      tl.to(fov, { v: FOV_HOME, duration: DUR * 0.55, ease: 'power3.out', onUpdate: applyFov }, DUR * 0.45);

      if (blurPass) {
        tl.fromTo(blurPass.uniforms.uStrength, { value: 0 },
          { value: 1.15, duration: DUR * 0.42, ease: 'power2.in' }, 0);
        tl.to(blurPass.uniforms.uStrength,
          { value: 0, duration: DUR * 0.5, ease: 'power2.out' }, DUR * 0.45);
      }

      tl.fromTo(shake, { amt: 0 }, { amt: 15, duration: DUR * 0.42, ease: 'power2.in' }, 0);
      tl.to(shake, { amt: 0, duration: DUR * 0.5, ease: 'power2.out' }, DUR * 0.45);

      tl.to(camera.rotation, { z: 0.1, duration: DUR * 0.5, ease: 'power2.inOut', yoyo: true, repeat: 1 }, 0.2);

      shatterGroup.children.forEach((frag) => {
        const s = frag.userData.scatter;
        tl.to(frag.position, { x: s.x, y: s.y, z: s.z, duration: DUR, ease: 'power4.inOut' }, 0);
        tl.to(frag.rotation, { x: s.rx, y: s.ry, z: s.rz, duration: DUR, ease: 'power3.inOut' }, 0);
        tl.to(frag.material, { opacity: 0, duration: 0.7, ease: 'power2.in' }, DUR * 0.5);
      });
    }

    function close() {
      if (!isOpen || isAnimating) return;
      isAnimating = true;

      const DUR = 1.0;
      const startZ = camera.position.z;
      const tl = gsap.timeline({
        onComplete: () => {
          overlay.classList.remove('inside-brain');
          overlay.style.opacity = '';
          camera.position.set(0, 0, CAM_HOME_Z);
          camera.rotation.set(0, 0, 0);
          camera.fov = FOV_HOME; camera.updateProjectionMatrix();
          camX = 0; camY = 0;
          setBlur(0); shake.amt = 0;
          isAnimating = false;
          isOpen = false;
        },
      });

      tl.to(camera.position, { x: 0, y: 0, z: startZ + 220, duration: DUR, ease: 'power2.inOut' }, 0);
      tl.to(camera.rotation, { x: 0, y: 0, z: 0, duration: DUR, ease: 'power2.inOut' }, 0);
      tl.to(overlay, { opacity: 0, duration: DUR * 0.85, ease: 'power2.inOut' }, DUR * 0.15);
    }

    const onMouseMove = (e) => {
      mouseX = (e.clientX / window.innerWidth) * 2 - 1;
      mouseY = (e.clientY / window.innerHeight) * 2 - 1;
    };
    window.addEventListener('mousemove', onMouseMove, { passive: true });

    const onWheel = (e) => {
      if (!isOpen || isAnimating) return;
      e.preventDefault();
      scrollVel -= e.deltaY * SCROLL_PUSH * 0.1;
      scrollVel = Math.max(-SCROLL_MAXVEL, Math.min(SCROLL_MAXVEL, scrollVel));
    };
    overlay.addEventListener('wheel', onWheel, { passive: false });

    let raf = 0;
    function loop() {
      raf = requestAnimationFrame(loop);
      if (!isOpen && !isAnimating) return;

      if (isAnimating && shake.amt > 0.01) {
        camera.position.x += (Math.random() - 0.5) * shake.amt;
        camera.position.y += (Math.random() - 0.5) * shake.amt;
      }

      if (isOpen && !isAnimating) {
        const tx = mouseX * 140;
        const ty = -mouseY * 80;
        camX += (tx - camX) * 0.045;
        camY += (ty - camY) * 0.045;
        camera.position.x = camX + CAM_OFF_X;
        camera.position.y = camY + CAM_OFF_Y;
        scrollVel *= SCROLL_FRICTION;
        if (Math.abs(scrollVel) < 0.02) scrollVel = 0;
        scrollZ += scrollVel;
        scrollZ = CAM_INSIDE_Z + ((((scrollZ - CAM_INSIDE_Z) % gridPeriodZ) + gridPeriodZ) % gridPeriodZ);
        camera.position.z = scrollZ;
        rotY += (-mouseX * 0.18 - rotY) * 0.045;
        rotX += (mouseY * 0.10 - rotX) * 0.045;
        camera.rotation.y = rotY;
        camera.rotation.x = rotX;
      }

      screenGroup.visible = isOpen && !isAnimating;

      textGroup.rotation.y = Math.sin(performance.now() * 0.00018) * 0.04;

      gridFlow.uTime.value = performance.now() * 0.001;

      if (composer) composer.render();
      else renderer.render(scene, camera);
    }
    loop();

    const onCloseClick = (e) => { e.stopPropagation(); close(); };
    closeBtn.addEventListener('click', onCloseClick);
    const onKeyDown = (e) => { if (e.key === 'Escape' && isOpen && !isAnimating) close(); };
    document.addEventListener('keydown', onKeyDown);

    apiRef.current = { open, close, isOpen: () => isOpen };

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('mousemove', onMouseMove);
      overlay.removeEventListener('wheel', onWheel);
      closeBtn.removeEventListener('click', onCloseClick);
      document.removeEventListener('keydown', onKeyDown);
      disposeShatter(shatterGroup);
      renderer.dispose();
      apiRef.current = null;
    };
  }, [bgCanvasRef, statueCanvasRef]);

  return (
    <div id="brain-overlay" ref={overlayRef}>
      <canvas id="brain3DCanvas" ref={canvasRef} />
      <div className="brain-vignette" />
      <div className="btn-close-brain" ref={closeBtnRef} style={CLOSE_BTN_STYLE}>[ ESCAPE_MIND ]</div>
    </div>
  );
});

export default BrainOverlay;
