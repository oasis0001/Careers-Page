import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

const CLOSE_BTN_STYLE = {
  position: 'absolute', top: '30px', right: '40px',
  fontFamily: "'JetBrains Mono', monospace", fontSize: '11px',
  color: 'var(--text-muted)', cursor: 'pointer',
  border: '1px solid rgba(255,255,255,0.15)', padding: '8px 16px', letterSpacing: '1px',
};

/**
 * Audio Visualiser — audio-reactive particle wave field. Ported verbatim from the
 * original `audioViz` IIFE. Exposes { open, close, isOpen } via ref. open(true)
 * plays the fly-in. Lazily builds the scene on first open; the render loop is gated
 * by isOpen so it costs nothing while closed.
 */
const AudioVizOverlay = forwardRef(function AudioVizOverlay(_props, ref) {
  const overlayRef = useRef(null);
  const canvasRef = useRef(null);
  const closeBtnRef = useRef(null);
  const audioRef = useRef(null);
  const dropRef = useRef(null);
  const fileRef = useRef(null);
  const playRef = useRef(null);
  const iconPlayRef = useRef(null);
  const iconPauseRef = useRef(null);
  const trackRef = useRef(null);
  const seekRef = useRef(null);
  const curRef = useRef(null);
  const durRef = useRef(null);
  const volRef = useRef(null);
  const apiRef = useRef(null);

  useImperativeHandle(ref, () => ({
    open: (fly) => apiRef.current?.open(fly),
    close: () => apiRef.current?.close(),
    isOpen: () => apiRef.current?.isOpen() ?? false,
  }), []);

  useEffect(() => {
    const THREE = window.THREE;
    const gsap = window.gsap;
    if (typeof THREE === 'undefined') {
      apiRef.current = { open() {}, close() {}, isOpen: () => false };
      return;
    }

    const overlay = overlayRef.current;
    const canvas = canvasRef.current;
    const closeBtn = closeBtnRef.current;

    const W = 1440, H = 750;

    let renderer, scene, camera, points, uniforms, audioTex;
    let clock, started = false, isOpen = false, raf = 0;

    const camTarget = new THREE.Vector3(0, -2, -55);
    const camBase = new THREE.Vector3(0, 24, 176);

    const GRID_X = 300, GRID_Z = 340;
    const SPAN_X = 320, SPAN_Z = 340;
    const COUNT = GRID_X * GRID_Z;

    const FREQ_BINS = 256;
    const freqData = new Uint8Array(FREQ_BINS);
    const freqSmooth = new Float32Array(FREQ_BINS);

    const audioEl = audioRef.current;
    let audioCtx, analyser, srcNode, gainNode, audioReady = false;
    let levelSmooth = 0, bassSmooth = 0;

    const drop = dropRef.current;
    const fileInput = fileRef.current;
    const playBtn = playRef.current;
    const iconPlay = iconPlayRef.current;
    const iconPause = iconPauseRef.current;
    const trackEl = trackRef.current;
    const seek = seekRef.current;
    const curEl = curRef.current;
    const durEl = durRef.current;
    const volEl = volRef.current;

    const vertexShader = `
      uniform float uTime;
      uniform sampler2D uAudioTex;
      uniform float uLevel;
      uniform float uBass;
      uniform float uSpanZ;
      uniform float uSpanX;
      uniform float uFocus;
      uniform float uAperture;
      uniform float uSize;
      uniform float uPixelRatio;

      attribute vec2 aGrid;
      attribute float aRand;

      varying float vBright;
      varying float vAlpha;

      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
      float noise(vec2 p){
        vec2 i = floor(p); vec2 f = fract(p);
        vec2 u = f*f*(3.0-2.0*f);
        return mix(mix(hash(i+vec2(0,0)), hash(i+vec2(1,0)), u.x),
                   mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), u.x), u.y);
      }

      void main() {
        vec3 p = position;
        float t = uTime;

        float zN = clamp((position.z + uSpanZ * 0.5) / uSpanZ, 0.0, 1.0);
        float frontFlat = smoothstep(1.0, 0.78, zN);
        float midBand = smoothstep(0.30, 0.48, zN) * smoothstep(0.80, 0.60, zN);
        float centerX = smoothstep(0.40, 0.12, abs(position.x) / uSpanX);
        midBand *= centerX;

        float h = 0.0;
        h += sin(p.x * 0.045 + t * 0.45) * cos(p.z * 0.05 - t * 0.30) * 3.4;
        h += sin(p.x * 0.11  - t * 0.25) * 1.7;
        h += cos(p.z * 0.09  + t * 0.40) * 1.9;
        h += noise(p.xz * 0.06 + vec2(t * 0.06, -t * 0.04)) * 5.5;
        h += noise(p.xz * 0.22) * 1.1;

        h *= frontFlat;

        float radial = length(vec2(p.x / uSpanX, (p.z) / uSpanZ));
        float fi = fract(radial * 1.6 + aRand * 0.04);
        float freq = texture2D(uAudioTex, vec2(fi, 0.5)).r;

        float audioRipple = freq * (8.0 + uLevel * 10.0);
        audioRipple *= 0.6 + 0.4 * sin(radial * 28.0 - t * 3.0);
        float audio = (uBass * 5.0 + audioRipple) * midBand;

        h += audio;
        h *= (1.0 + uLevel * 0.35 * midBand);

        p.y = h;

        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float depth = -mv.z;

        float persp = uSize * (230.0 / depth);
        float coc   = abs(depth - uFocus) * uAperture;
        float shrink = mix(0.35, 1.0, smoothstep(6.0, 90.0, depth));
        float sizePx = (persp + coc) * shrink;
        gl_PointSize = clamp(sizePx * uPixelRatio, 0.0, 8.0 * uPixelRatio);

        float optical = persp + coc;
        float focusBright = (persp * persp) / (optical * optical);

        float crest = smoothstep(-3.0, 8.0, h);

        vBright = focusBright * (0.30 + 0.60 * crest);
        vBright += freq * crest * 0.40;

        float far  = smoothstep(360.0, 190.0, depth);
        float near = smoothstep(2.0, 16.0, depth);
        vAlpha = clamp(far * near, 0.0, 1.0);

        gl_Position = projectionMatrix * mv;
      }
    `;

    const fragmentShader = `
      precision highp float;
      varying float vBright;
      varying float vAlpha;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float dist = length(c);
        float a = 1.0 - smoothstep(0.40, 0.50, dist);
        float b = vBright;
        vec3 col = vec3(0.92, 0.94, 0.97) * b;
        gl_FragColor = vec4(col, a * vAlpha * clamp(b, 0.0, 1.0));
      }
    `;

    function buildScene() {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(W, H, false);
      renderer.setClearColor(0x000000, 1);

      scene = new THREE.Scene();
      camera = new THREE.PerspectiveCamera(50, W / H, 0.1, 1200);
      camera.position.copy(camBase);
      camera.lookAt(camTarget);

      const positions = new Float32Array(COUNT * 3);
      const aGrid = new Float32Array(COUNT * 2);
      const aRand = new Float32Array(COUNT);
      let i3 = 0, i2 = 0, i1 = 0;
      for (let z = 0; z < GRID_Z; z++) {
        for (let x = 0; x < GRID_X; x++) {
          const u = x / (GRID_X - 1);
          const v = z / (GRID_Z - 1);
          const jx = (Math.random() - 0.5) * (SPAN_X / GRID_X) * 0.9;
          const jz = (Math.random() - 0.5) * (SPAN_Z / GRID_Z) * 0.9;
          positions[i3 + 0] = (u - 0.5) * SPAN_X + jx;
          positions[i3 + 1] = 0;
          positions[i3 + 2] = (v - 0.5) * SPAN_Z + jz;
          aGrid[i2 + 0] = u; aGrid[i2 + 1] = v;
          aRand[i1] = Math.random();
          i3 += 3; i2 += 2; i1 += 1;
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.setAttribute('aGrid', new THREE.BufferAttribute(aGrid, 2));
      geo.setAttribute('aRand', new THREE.BufferAttribute(aRand, 1));

      audioTex = new THREE.DataTexture(freqData, FREQ_BINS, 1, THREE.RedFormat, THREE.UnsignedByteType);
      audioTex.magFilter = THREE.LinearFilter;
      audioTex.minFilter = THREE.LinearFilter;
      audioTex.needsUpdate = true;

      uniforms = {
        uTime: { value: 0 },
        uAudioTex: { value: audioTex },
        uLevel: { value: 0 },
        uBass: { value: 0 },
        uSpanZ: { value: SPAN_Z },
        uSpanX: { value: SPAN_X },
        uFocus: { value: 95 },
        uAperture: { value: 0.015 },
        uSize: { value: 1.2 },
        uPixelRatio: { value: renderer.getPixelRatio() },
      };

      const material = new THREE.ShaderMaterial({
        uniforms, vertexShader, fragmentShader,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      });
      points = new THREE.Points(geo, material);
      scene.add(points);

      clock = new THREE.Clock();
    }

    function initAudio() {
      if (audioReady) return;
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      srcNode = audioCtx.createMediaElementSource(audioEl);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.20;
      gainNode = audioCtx.createGain();
      gainNode.gain.value = parseFloat(volEl.value) / 100;
      srcNode.connect(analyser);
      analyser.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      audioReady = true;
    }

    function sampleAudio() {
      if (!audioReady || audioEl.paused) {
        for (let i = 0; i < FREQ_BINS; i++) freqSmooth[i] += (0 - freqSmooth[i]) * 0.05;
        levelSmooth += (0 - levelSmooth) * 0.04;
        bassSmooth += (0 - bassSmooth) * 0.04;
      } else {
        analyser.getByteFrequencyData(freqData);
        let sum = 0, bass = 0;
        for (let i = 0; i < FREQ_BINS; i++) {
          const v = freqData[i] / 255;
          freqSmooth[i] += (v - freqSmooth[i]) * 0.22;
          sum += freqSmooth[i];
          if (i < 24) bass += freqSmooth[i];
        }
        levelSmooth += (sum / FREQ_BINS - levelSmooth) * 0.78;
        bassSmooth += (bass / 24 - bassSmooth) * 0.92;
      }
      for (let i = 0; i < FREQ_BINS; i++) freqData[i] = Math.min(255, freqSmooth[i] * 255);
      audioTex.needsUpdate = true;
      uniforms.uLevel.value = levelSmooth;
      uniforms.uBass.value = bassSmooth;
    }

    let dragging = false, pxv = 0, pyv = 0;
    let yaw = 0, pitch = 0, zoom = 0;
    let yawT = 0, pitchT = 0, zoomT = 0;
    const introCam = { z: 0 };

    const onPointerDown = (e) => { dragging = true; pxv = e.clientX; pyv = e.clientY; };
    const onPointerUp = () => { dragging = false; };
    const onPointerMove = (e) => {
      if (!isOpen || !dragging) return;
      yawT += (e.clientX - pxv) * 0.0016;
      pitchT += (e.clientY - pyv) * 0.0012;
      pitchT = Math.max(-0.35, Math.min(0.5, pitchT));
      pxv = e.clientX; pyv = e.clientY;
    };
    const onWheel = (e) => {
      if (!isOpen) return;
      e.preventDefault();
      zoomT = Math.max(-2, Math.min(60, zoomT + e.deltaY * 0.03));
    };
    function wireInteraction() {
      canvas.addEventListener('pointerdown', onPointerDown);
      window.addEventListener('pointerup', onPointerUp);
      window.addEventListener('pointermove', onPointerMove);
      canvas.addEventListener('wheel', onWheel, { passive: false });
    }

    const fmt = (s) => {
      if (!isFinite(s)) return '0:00';
      const m = Math.floor(s / 60), ss = Math.floor(s % 60);
      return m + ':' + String(ss).padStart(2, '0');
    };
    const loadFile = (file) => {
      if (!file) return;
      audioEl.src = URL.createObjectURL(file);
      trackEl.textContent = file.name;
      playBtn.disabled = false;
      seek.disabled = false;
      audioEl.load();
    };
    const onDropClick = () => fileInput.click();
    const onFileChange = (e) => loadFile(e.target.files[0]);
    const onDragEnterOver = (e) => { e.preventDefault(); drop.classList.add('hover'); };
    const onDragLeaveDrop = (e) => { e.preventDefault(); drop.classList.remove('hover'); };
    const onDrop = (e) => {
      const f = e.dataTransfer.files[0];
      if (f && f.type.startsWith('audio')) loadFile(f);
    };
    const onPlayClick = async () => {
      initAudio();
      if (audioCtx.state === 'suspended') await audioCtx.resume();
      if (audioEl.paused) audioEl.play(); else audioEl.pause();
    };
    const onPlay = () => { iconPlay.style.display = 'none'; iconPause.style.display = ''; };
    const onPause = () => { iconPlay.style.display = ''; iconPause.style.display = 'none'; };
    const onLoadedMeta = () => { durEl.textContent = fmt(audioEl.duration); };
    const onTimeUpdate = () => {
      if (!seek.matches(':active')) seek.value = (audioEl.currentTime / audioEl.duration) * 1000 || 0;
      curEl.textContent = fmt(audioEl.currentTime);
    };
    const onEnded = () => { iconPlay.style.display = ''; iconPause.style.display = 'none'; };
    const onSeekInput = () => {
      if (audioEl.duration) audioEl.currentTime = (seek.value / 1000) * audioEl.duration;
    };
    const onVolInput = () => {
      if (gainNode) gainNode.gain.value = volEl.value / 100;
      audioEl.volume = volEl.value / 100;
    };

    function wireUI() {
      drop.addEventListener('click', onDropClick);
      fileInput.addEventListener('change', onFileChange);
      ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, onDragEnterOver));
      ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, onDragLeaveDrop));
      drop.addEventListener('drop', onDrop);
      playBtn.addEventListener('click', onPlayClick);
      audioEl.addEventListener('play', onPlay);
      audioEl.addEventListener('pause', onPause);
      audioEl.addEventListener('loadedmetadata', onLoadedMeta);
      audioEl.addEventListener('timeupdate', onTimeUpdate);
      audioEl.addEventListener('ended', onEnded);
      seek.addEventListener('input', onSeekInput);
      volEl.addEventListener('input', onVolInput);
    }

    function animate() {
      raf = requestAnimationFrame(animate);
      if (!isOpen) return;

      const t = clock.getElapsedTime();
      uniforms.uTime.value = t;
      sampleAudio();

      yaw += (yawT - yaw) * 0.06;
      pitch += (pitchT - pitch) * 0.06;
      zoom += (zoomT - zoom) * 0.06;

      const driftX = Math.sin(t * 0.10) * 3.0;
      const driftY = Math.cos(t * 0.13) * 1.0;
      camera.position.x = camBase.x + driftX + Math.sin(yaw) * 24;
      camera.position.y = camBase.y + driftY + pitch * 16;
      camera.position.z = Math.max(172, camBase.z + zoom + introCam.z);
      camera.lookAt(camTarget.x + Math.sin(yaw) * 10, camTarget.y + pitch * 6, camTarget.z);

      renderer.render(scene, camera);
    }

    function open(fly) {
      if (isOpen) return;
      if (!started) {
        buildScene(); wireUI(); wireInteraction(); started = true;
        renderer.compile(scene, camera);
        renderer.render(scene, camera);
        raf = requestAnimationFrame(animate);
      }
      isOpen = true;
      if (fly) {
        introCam.z = 720;
        gsap.to(introCam, { z: 0, duration: 2.6, ease: 'power4.inOut' });
      }
      requestAnimationFrame(() => overlay.classList.add('inside-audioViz'));
    }
    function close() {
      if (!isOpen) return;
      isOpen = false;
      overlay.classList.remove('inside-audioViz');
      if (!audioEl.paused) audioEl.pause();
    }

    const onCloseClick = (e) => { e.stopPropagation(); close(); };
    closeBtn.addEventListener('click', onCloseClick);
    const onKeyDown = (e) => { if (e.key === 'Escape' && isOpen) close(); };
    document.addEventListener('keydown', onKeyDown);

    apiRef.current = { open, close, isOpen: () => isOpen };

    return () => {
      cancelAnimationFrame(raf);
      closeBtn.removeEventListener('click', onCloseClick);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointermove', onPointerMove);
      if (started) {
        canvas.removeEventListener('pointerdown', onPointerDown);
        canvas.removeEventListener('wheel', onWheel);
        drop.removeEventListener('click', onDropClick);
        fileInput.removeEventListener('change', onFileChange);
        ['dragenter', 'dragover'].forEach((ev) => drop.removeEventListener(ev, onDragEnterOver));
        ['dragleave', 'drop'].forEach((ev) => drop.removeEventListener(ev, onDragLeaveDrop));
        drop.removeEventListener('drop', onDrop);
        playBtn.removeEventListener('click', onPlayClick);
        audioEl.removeEventListener('play', onPlay);
        audioEl.removeEventListener('pause', onPause);
        audioEl.removeEventListener('loadedmetadata', onLoadedMeta);
        audioEl.removeEventListener('timeupdate', onTimeUpdate);
        audioEl.removeEventListener('ended', onEnded);
        seek.removeEventListener('input', onSeekInput);
        volEl.removeEventListener('input', onVolInput);
      }
      if (!audioEl.paused) audioEl.pause();
      if (renderer) renderer.dispose();
      apiRef.current = null;
    };
  }, []);

  return (
    <div id="audioViz-overlay" ref={overlayRef}>
      <canvas id="audioVizCanvas" ref={canvasRef} />
      <div className="brain-vignette" />

      <div id="audioVizPanel">
        <h1>Particle Wave</h1>
        <p className="av-sub">Audio-reactive field</p>

        <div className="av-drop" id="av-drop" ref={dropRef}>
          <strong>Drop an audio file</strong> or click to browse<br />
          <span style={{ fontSize: '10.5px' }}>mp3 · wav · ogg · m4a</span>
        </div>
        <input type="file" id="av-file" accept="audio/*" hidden ref={fileRef} />

        <div className="av-row">
          <button className="av-play" id="av-play" disabled aria-label="Play" ref={playRef}>
            <svg id="av-icon-play" viewBox="0 0 24 24" fill="currentColor" ref={iconPlayRef}><path d="M8 5v14l11-7z" /></svg>
            <svg id="av-icon-pause" viewBox="0 0 24 24" fill="currentColor" style={{ display: 'none' }} ref={iconPauseRef}><path d="M6 5h4v14H6zM14 5h4v14h-4z" /></svg>
          </button>
          <div className="av-track" id="av-track" ref={trackRef}>No file loaded</div>
        </div>

        <div className="av-seek">
          <span className="av-time" id="av-cur" ref={curRef}>0:00</span>
          <input type="range" id="av-seek" min="0" max="1000" defaultValue="0" disabled ref={seekRef} />
          <span className="av-time" id="av-dur" ref={durRef}>0:00</span>
        </div>

        <div className="av-vol">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4z" /></svg>
          <input type="range" id="av-vol" min="0" max="100" defaultValue="85" ref={volRef} />
        </div>
      </div>

      <audio id="av-audio" crossOrigin="anonymous" ref={audioRef} />
      <div className="btn-close-brain" ref={closeBtnRef} style={CLOSE_BTN_STYLE}>[ EXIT_VOICE ]</div>
    </div>
  );
});

export default AudioVizOverlay;
