// MindPortal — Framer code component
//
// User request: "Transfer the 3D shatter-dive transition logic to a framework.
// Make one Framer component with a button. When I hit that button, the framework
// component activates, the warp/shatter transition takes place, and then I get
// inside the 3D wireframe world. Make this a .tsx, place it in Framer via MCP,
// and wire the button so clicking it takes me into the 3D trans world."
//
// Implementation notes:
// - Framer code components may only import react / react-dom / framer. Three.js
//   and GSAP are therefore loaded at RUNTIME by injecting the same CDN <script>
//   tags used by the original vanilla page (UMD r128 + examples/js postprocessing
//   + gsap), then read off the window globals. This reuses the proven engine and
//   avoids any disallowed package imports.
// - The component root stays position:relative (a button, lives in Framer layout).
//   The fullscreen 3D overlay is rendered through createPortal(document.body) so
//   it can be position:fixed without breaking Framer's layout rules.
// - All window/document access is guarded for SSR; the heavy WebGL only runs in
//   preview / on the published site (not on the static design canvas).

import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    startTransition,
} from "react"
import { createPortal } from "react-dom"
import { addPropertyControls, ControlType } from "framer"

// ---------------------------------------------------------------------------
// Runtime library loader (CDN <script> injection, deduped & order-preserving)
// ---------------------------------------------------------------------------
// NOTE: three.min.js (core, r128) already ships FontLoader / TextGeometry /
// WireframeGeometry, so we do NOT load separate loader/geometry scripts (those
// paths 404 on the CDN for this version). We only inject core + the
// postprocessing addons + gsap.
const LIB_URLS = [
    "https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js",
    "https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/shaders/CopyShader.js",
    "https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/postprocessing/EffectComposer.js",
    "https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/postprocessing/RenderPass.js",
    "https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/postprocessing/ShaderPass.js",
    "https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.2/gsap.min.js",
]

let libsPromise: Promise<void> | null = null

// Resolves even on error so a single flaky CDN file can't abort the whole
// chain. Critical libs (three, gsap) are checked for presence before use; the
// postprocessing addons gracefully degrade (no blur) if one fails to load.
function loadScript(src: string): Promise<void> {
    return new Promise((resolve) => {
        if (typeof document === "undefined") {
            resolve()
            return
        }
        const found = document.querySelector(
            `script[data-mindportal="${src}"]`
        ) as (HTMLScriptElement & { _done?: boolean }) | null
        if (found) {
            if (found._done) resolve()
            else {
                found.addEventListener("load", () => resolve())
                found.addEventListener("error", () => resolve())
            }
            return
        }
        const s = document.createElement("script") as HTMLScriptElement & {
            _done?: boolean
        }
        s.src = src
        s.async = false // preserve execution order across the list
        s.setAttribute("data-mindportal", src)
        s.onload = () => {
            s._done = true
            resolve()
        }
        s.onerror = () => {
            // eslint-disable-next-line no-console
            console.warn("[MindPortal] script failed to load:", src)
            resolve()
        }
        document.head.appendChild(s)
    })
}

function ensureLibs(): Promise<void> {
    if (!libsPromise) {
        libsPromise = (async () => {
            for (const url of LIB_URLS) await loadScript(url) // sequential
        })()
    }
    return libsPromise
}

// ---------------------------------------------------------------------------
// Engine config + factory — the ported shatter-dive + wireframe void
// ---------------------------------------------------------------------------
type EngineConfig = {
    accent: number
    coverTitle: string
    tagline: string
}

type EngineHandle = {
    open: () => void
    close: (onReassembled?: () => void) => void
    dispose: () => void
}

function hexToInt(hex: string): number {
    const clean = (hex || "#1a56ff").replace("#", "").slice(0, 6)
    const n = parseInt(clean, 16)
    return Number.isFinite(n) ? n : 0x1a56ff
}

function createEngine(
    canvas: HTMLCanvasElement,
    THREE: any,
    gsap: any,
    cfg: EngineConfig
): EngineHandle {
    let W = Math.max(2, window.innerWidth)
    let H = Math.max(2, window.innerHeight)

    const CAM_HOME_Z = 600
    const CAM_INSIDE_Z = -1800
    const FOV_HOME = 60
    const FOV_DIVE = 92
    const ACCENT = cfg.accent
    const ACCENT_SUB = 0x16265a

    const renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        alpha: false,
    })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75))
    renderer.setSize(W, H, false)
    renderer.setClearColor(0x010103, 1)

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x010103)
    scene.fog = new THREE.Fog(0x010103, 1400, 5200)

    const camera = new THREE.PerspectiveCamera(FOV_HOME, W / H, 0.1, 10000)
    camera.position.set(0, 0, CAM_HOME_Z)

    // ---- Post: radial zoom-blur + chromatic aberration (uStrength-driven) ----
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
                    float w = 1.0 - t * 0.55;
                    col += vec4(r, g, b, 1.0) * w;
                    total += w;
                }
                gl_FragColor = col / total;
            }
        `,
    }

    let composer: any = null
    let blurPass: any = null
    if (THREE.EffectComposer && THREE.RenderPass && THREE.ShaderPass) {
        composer = new THREE.EffectComposer(renderer)
        composer.setSize(W, H)
        composer.addPass(new THREE.RenderPass(scene, camera))
        blurPass = new THREE.ShaderPass(RadialBlurCAShader)
        blurPass.renderToScreen = true
        composer.addPass(blurPass)
    }
    const setBlur = (v: number) => {
        if (blurPass) blurPass.uniforms.uStrength.value = v
    }

    // ---- The void: architectural grids ----
    const disposables: any[] = []
    function gridLayer(
        size: number,
        div: number,
        opacity: number,
        pos: any,
        rot?: any
    ) {
        const g = new THREE.GridHelper(size, div, ACCENT, ACCENT_SUB)
        g.material.transparent = true
        g.material.opacity = opacity
        g.material.depthWrite = false
        if (pos) g.position.copy(pos)
        if (rot) g.rotation.copy(rot)
        disposables.push(g.geometry, g.material)
        return g
    }
    scene.add(gridLayer(10000, 100, 0.3, new THREE.Vector3(0, -500, -1500)))
    scene.add(gridLayer(10000, 100, 0.18, new THREE.Vector3(0, 500, -1500)))
    scene.add(
        gridLayer(
            10000,
            60,
            0.22,
            new THREE.Vector3(0, 0, -4500),
            new THREE.Euler(Math.PI / 2, 0, 0)
        )
    )

    // ---- Giant wireframe typography (async font) ----
    const textGroup = new THREE.Group()
    scene.add(textGroup)
    const WORDS = [
        { text: "AI", size: 240, pos: [-460, 220, -900], color: 0xffffff, ry: 0.18 },
        { text: "NEURAL", size: 160, pos: [540, -130, -1500], color: ACCENT, ry: -0.22 },
        { text: "MIND", size: 380, pos: [0, 20, -3000], color: ACCENT, ry: 0 },
        { text: "DEEP", size: 200, pos: [-680, -380, -1900], color: 0xffffff, ry: 0.28 },
        { text: "PROCESS", size: 130, pos: [-800, 380, -2100], color: ACCENT, ry: 0.32 },
        { text: "THINK", size: 170, pos: [760, -340, -2400], color: 0xffffff, ry: -0.42 },
        { text: "LEARN", size: 220, pos: [380, 460, -2800], color: 0xffffff, ry: -0.18 },
        { text: "COGNITION", size: 140, pos: [-1100, 60, -3700], color: ACCENT, ry: 0.45 },
    ]
    const FONT_URL =
        "https://cdn.jsdelivr.net/npm/three@0.128.0/examples/fonts/helvetiker_regular.typeface.json"
    if (THREE.FontLoader && THREE.TextGeometry) {
        try {
            new THREE.FontLoader().load(FONT_URL, (font: any) => {
                WORDS.forEach((w) => {
                    const tg = new THREE.TextGeometry(w.text, {
                        font,
                        size: w.size,
                        height: Math.max(4, w.size * 0.04),
                        curveSegments: 4,
                        bevelEnabled: false,
                    })
                    tg.center()
                    const wire = new THREE.WireframeGeometry(tg)
                    const mat = new THREE.LineBasicMaterial({
                        color: w.color,
                        transparent: true,
                        opacity: 0.55,
                        depthWrite: false,
                    })
                    const lines = new THREE.LineSegments(wire, mat)
                    lines.position.set(w.pos[0], w.pos[1], w.pos[2])
                    lines.rotation.y = w.ry
                    textGroup.add(lines)
                    disposables.push(tg, wire, mat)
                })
            })
        } catch (e) {
            // font optional
        }
    }

    // ---- Floating tagline (CanvasTexture plane, deep in the void) ----
    if (cfg.tagline) {
        const tc = document.createElement("canvas")
        tc.width = 2048
        tc.height = 256
        const tx = tc.getContext("2d")!
        tx.clearRect(0, 0, tc.width, tc.height)
        tx.fillStyle = "#ffffff"
        tx.font = "500 92px Helvetica, Arial, sans-serif"
        tx.textAlign = "center"
        tx.textBaseline = "middle"
        tx.fillText(cfg.tagline, tc.width / 2, tc.height / 2)
        const tagTex = new THREE.CanvasTexture(tc)
        tagTex.minFilter = THREE.LinearFilter
        const tagMat = new THREE.MeshBasicMaterial({
            map: tagTex,
            transparent: true,
            opacity: 0.85,
            depthWrite: false,
        })
        const tagGeo = new THREE.PlaneGeometry(1600, 200)
        const tagMesh = new THREE.Mesh(tagGeo, tagMat)
        tagMesh.position.set(0, -260, -1250)
        scene.add(tagMesh)
        disposables.push(tagGeo, tagMat, tagTex)
    }

    // ---- Shatter wall: snapshot of "the screen" → grid of textured planes ----
    const SHATTER_COLS = 12
    const SHATTER_ROWS = 8
    let shatterGroup: any = null

    function buildSnapshot(): HTMLCanvasElement {
        const aspect = W / H
        const sw = 1600
        const sh = Math.round(sw / aspect)
        const s = document.createElement("canvas")
        s.width = sw
        s.height = sh
        const x = s.getContext("2d")!
        x.fillStyle = "#010103"
        x.fillRect(0, 0, sw, sh)
        // faint grid texture
        x.strokeStyle = "rgba(26,86,255,0.12)"
        x.lineWidth = 1
        const step = sw / 16
        for (let gx = 0; gx <= sw; gx += step) {
            x.beginPath()
            x.moveTo(gx, 0)
            x.lineTo(gx, sh)
            x.stroke()
        }
        for (let gy = 0; gy <= sh; gy += step) {
            x.beginPath()
            x.moveTo(0, gy)
            x.lineTo(sw, gy)
            x.stroke()
        }
        // title
        x.fillStyle = "#ffffff"
        x.textAlign = "center"
        x.textBaseline = "middle"
        x.font = "600 120px Helvetica, Arial, sans-serif"
        x.fillText(cfg.coverTitle || "THE IDEAL CANDIDATE", sw / 2, sh / 2)
        return s
    }

    function wallDims() {
        const vFov = (FOV_HOME * Math.PI) / 180
        const wallH = 2 * Math.tan(vFov / 2) * CAM_HOME_Z
        const wallW = wallH * camera.aspect
        return { wallW, wallH }
    }

    function buildShatterWall() {
        const tex = new THREE.CanvasTexture(buildSnapshot())
        tex.minFilter = THREE.LinearFilter
        tex.magFilter = THREE.LinearFilter
        const { wallW, wallH } = wallDims()
        const fw = wallW / SHATTER_COLS
        const fh = wallH / SHATTER_ROWS
        const group = new THREE.Group()
        for (let r = 0; r < SHATTER_ROWS; r++) {
            for (let c = 0; c < SHATTER_COLS; c++) {
                const geo = new THREE.PlaneGeometry(fw, fh, 1, 1)
                const uv = geo.attributes.uv
                const u0 = c / SHATTER_COLS
                const u1 = (c + 1) / SHATTER_COLS
                const v0 = 1 - (r + 1) / SHATTER_ROWS
                const v1 = 1 - r / SHATTER_ROWS
                uv.setXY(0, u0, v1)
                uv.setXY(1, u1, v1)
                uv.setXY(2, u0, v0)
                uv.setXY(3, u1, v0)
                uv.needsUpdate = true
                const mat = new THREE.MeshBasicMaterial({
                    map: tex,
                    transparent: true,
                    side: THREE.DoubleSide,
                    depthWrite: false,
                })
                const mesh = new THREE.Mesh(geo, mat)
                const ox = (c - SHATTER_COLS / 2 + 0.5) * fw
                const oy = (SHATTER_ROWS / 2 - r - 0.5) * fh
                mesh.position.set(ox, oy, 0)
                mesh.userData.origin = { x: ox, y: oy, z: 0 }
                const angle = Math.atan2(oy, ox)
                const radius = Math.hypot(ox, oy)
                const blast = 3.2 + Math.random() * 1.8
                mesh.userData.scatter = {
                    x: Math.cos(angle) * (radius * blast + 500 + Math.random() * 450),
                    y: Math.sin(angle) * (radius * blast + 500 + Math.random() * 450),
                    z: 900 + Math.random() * 700,
                    rx: (Math.random() - 0.5) * Math.PI * 3,
                    ry: (Math.random() - 0.5) * Math.PI * 3,
                    rz: (Math.random() - 0.5) * Math.PI * 3,
                }
                group.add(mesh)
            }
        }
        group.userData.texture = tex
        return group
    }

    function disposeShatter(group: any) {
        if (!group) return
        scene.remove(group)
        group.children.forEach((m: any) => {
            m.geometry.dispose()
            m.material.dispose()
        })
        if (group.userData.texture) group.userData.texture.dispose()
    }

    // ---- State ----
    let isOpen = false
    let isAnimating = false
    let mouseX = 0
    let mouseY = 0
    let camX = 0
    let camY = 0
    const shake = { amt: 0 }
    let rafId = 0

    function open() {
        if (isOpen || isAnimating) return
        isAnimating = true
        camera.position.set(0, 0, CAM_HOME_Z)
        camera.rotation.set(0, 0, 0)
        camera.fov = FOV_HOME
        camera.updateProjectionMatrix()
        camX = 0
        camY = 0
        shake.amt = 0
        setBlur(0)

        shatterGroup = buildShatterWall()
        shatterGroup.position.z = 0
        scene.add(shatterGroup)

        const DUR = 2.6
        const tl = gsap.timeline({
            onComplete: () => {
                disposeShatter(shatterGroup)
                shatterGroup = null
                setBlur(0)
                shake.amt = 0
                camera.fov = FOV_HOME
                camera.updateProjectionMatrix()
                isAnimating = false
                isOpen = true
            },
        })
        tl.to(camera.position, { z: CAM_INSIDE_Z, duration: DUR, ease: "power4.inOut" }, 0)
        const fov = { v: FOV_HOME }
        const applyFov = () => {
            camera.fov = fov.v
            camera.updateProjectionMatrix()
        }
        tl.to(fov, { v: FOV_DIVE, duration: DUR * 0.45, ease: "power2.in", onUpdate: applyFov }, 0)
        tl.to(fov, { v: FOV_HOME, duration: DUR * 0.55, ease: "power3.out", onUpdate: applyFov }, DUR * 0.45)
        if (blurPass) {
            tl.fromTo(blurPass.uniforms.uStrength, { value: 0 }, { value: 1.15, duration: DUR * 0.42, ease: "power2.in" }, 0)
            tl.to(blurPass.uniforms.uStrength, { value: 0, duration: DUR * 0.5, ease: "power2.out" }, DUR * 0.45)
        }
        tl.fromTo(shake, { amt: 0 }, { amt: 15, duration: DUR * 0.42, ease: "power2.in" }, 0)
        tl.to(shake, { amt: 0, duration: DUR * 0.5, ease: "power2.out" }, DUR * 0.45)
        tl.to(camera.rotation, { z: 0.1, duration: DUR * 0.5, ease: "power2.inOut", yoyo: true, repeat: 1 }, 0.2)
        shatterGroup.children.forEach((frag: any) => {
            const s = frag.userData.scatter
            tl.to(frag.position, { x: s.x, y: s.y, z: s.z, duration: DUR, ease: "power4.inOut" }, 0)
            tl.to(frag.rotation, { x: s.rx, y: s.ry, z: s.rz, duration: DUR, ease: "power3.inOut" }, 0)
            tl.to(frag.material, { opacity: 0, duration: 0.7, ease: "power2.in" }, DUR * 0.5)
        })
    }

    function close(onReassembled?: () => void) {
        if (!isOpen || isAnimating) {
            if (onReassembled) onReassembled()
            return
        }
        isAnimating = true
        shatterGroup = buildShatterWall()
        const FRONT_DIST = 820
        shatterGroup.position.set(0, 0, camera.position.z - FRONT_DIST)
        scene.add(shatterGroup)
        shatterGroup.children.forEach((frag: any) => {
            const s = frag.userData.scatter
            frag.position.set(s.x, s.y, s.z)
            frag.rotation.set(s.rx, s.ry, s.rz)
            frag.material.opacity = 0
        })

        const DUR = 1.8
        const startZ = camera.position.z
        const tl = gsap.timeline({
            onComplete: () => {
                disposeShatter(shatterGroup)
                shatterGroup = null
                camera.position.set(0, 0, CAM_HOME_Z)
                camera.rotation.set(0, 0, 0)
                camera.fov = FOV_HOME
                camera.updateProjectionMatrix()
                camX = 0
                camY = 0
                setBlur(0)
                shake.amt = 0
                isAnimating = false
                isOpen = false
                if (onReassembled) onReassembled()
            },
        })
        tl.to(camera.position, { x: 0, y: 0, z: startZ + 320, duration: DUR, ease: "power3.inOut" }, 0)
        tl.to(camera.rotation, { x: 0, y: 0, z: 0, duration: DUR * 0.85, ease: "power2.inOut" }, 0)
        if (blurPass) {
            tl.fromTo(blurPass.uniforms.uStrength, { value: 0 }, { value: 0.8, duration: DUR * 0.4, ease: "power2.in" }, 0)
            tl.to(blurPass.uniforms.uStrength, { value: 0, duration: DUR * 0.55, ease: "power2.out" }, DUR * 0.4)
        }
        shatterGroup.children.forEach((frag: any) => {
            const o = frag.userData.origin
            tl.to(frag.position, { x: o.x, y: o.y, z: o.z, duration: DUR, ease: "power3.inOut" }, 0)
            tl.to(frag.rotation, { x: 0, y: 0, z: 0, duration: DUR, ease: "power3.inOut" }, 0)
            tl.to(frag.material, { opacity: 1, duration: 0.7, ease: "power2.out" }, 0.35)
        })
    }

    const onMouse = (e: MouseEvent) => {
        mouseX = (e.clientX / window.innerWidth) * 2 - 1
        mouseY = (e.clientY / window.innerHeight) * 2 - 1
    }
    window.addEventListener("mousemove", onMouse, { passive: true })

    const onResize = () => {
        W = Math.max(2, window.innerWidth)
        H = Math.max(2, window.innerHeight)
        renderer.setSize(W, H, false)
        if (composer) composer.setSize(W, H)
        camera.aspect = W / H
        camera.updateProjectionMatrix()
    }
    window.addEventListener("resize", onResize)

    function loop() {
        rafId = requestAnimationFrame(loop)
        if (!isOpen && !isAnimating) {
            // idle: still render the void faintly so the world exists behind the dive
            if (composer) composer.render()
            else renderer.render(scene, camera)
            return
        }
        if (isAnimating && shake.amt > 0.01) {
            camera.position.x = (Math.random() - 0.5) * shake.amt
            camera.position.y = (Math.random() - 0.5) * shake.amt
        }
        if (isOpen && !isAnimating) {
            const tx = mouseX * 140
            const ty = -mouseY * 80
            camX += (tx - camX) * 0.045
            camY += (ty - camY) * 0.045
            camera.position.x = camX
            camera.position.y = camY
            camera.rotation.y = -mouseX * 0.18
            camera.rotation.x = mouseY * 0.1
        }
        textGroup.rotation.y = Math.sin(performance.now() * 0.00018) * 0.04
        if (composer) composer.render()
        else renderer.render(scene, camera)
    }
    loop()

    function dispose() {
        cancelAnimationFrame(rafId)
        window.removeEventListener("mousemove", onMouse)
        window.removeEventListener("resize", onResize)
        if (shatterGroup) disposeShatter(shatterGroup)
        textGroup.children.forEach((c: any) => {
            if (c.geometry) c.geometry.dispose()
            if (c.material) c.material.dispose()
        })
        disposables.forEach((d) => d && d.dispose && d.dispose())
        renderer.dispose()
    }

    return { open, close, dispose }
}

// ---------------------------------------------------------------------------
// Framer component
// ---------------------------------------------------------------------------
type MindPortalProps = {
    buttonLabel: string
    coverTitle: string
    tagline: string
    accentColor: string
    style?: any
}

/**
 * @framerSupportedLayoutWidth auto
 * @framerSupportedLayoutHeight auto
 */
export default function MindPortal(props: MindPortalProps) {
    const {
        buttonLabel = "ENTER THE MIND",
        coverTitle = "THE IDEAL CANDIDATE",
        tagline = "How we work is changing shape.",
        accentColor = "#1a56ff",
    } = props

    const [active, setActive] = useState(false)
    const canvasRef = useRef<HTMLCanvasElement | null>(null)
    const overlayRef = useRef<HTMLDivElement | null>(null)
    const engineRef = useRef<EngineHandle | null>(null)

    const accentInt = useMemo(() => hexToInt(accentColor), [accentColor])

    // Set up the engine whenever the overlay becomes active.
    useEffect(() => {
        if (!active) return
        if (typeof window === "undefined") return
        let cancelled = false
        ensureLibs()
            .then(() => {
                if (cancelled) return
                const THREE = (window as any).THREE
                const gsap = (window as any).gsap
                const canvas = canvasRef.current
                if (!THREE || !gsap || !canvas) return
                const engine = createEngine(canvas, THREE, gsap, {
                    accent: accentInt,
                    coverTitle,
                    tagline,
                })
                engineRef.current = engine
                engine.open()
            })
            .catch(() => {
                // if libs fail to load, just drop back out
                startTransition(() => setActive(false))
            })
        return () => {
            cancelled = true
            if (engineRef.current) {
                engineRef.current.dispose()
                engineRef.current = null
            }
        }
    }, [active, accentInt, coverTitle, tagline])

    const handleOpen = useCallback(() => {
        if (typeof window === "undefined") return
        startTransition(() => setActive(true))
    }, [])

    const handleClose = useCallback(() => {
        const eng = engineRef.current
        if (!eng) {
            startTransition(() => setActive(false))
            return
        }
        eng.close(() => {
            if (overlayRef.current) overlayRef.current.style.opacity = "0"
            window.setTimeout(() => {
                startTransition(() => setActive(false))
            }, 480)
        })
    }, [])

    const overlay =
        active && typeof document !== "undefined"
            ? createPortal(
                  <div
                      ref={overlayRef}
                      style={{
                          position: "fixed",
                          inset: 0,
                          zIndex: 2147483000,
                          background: "#010103",
                          opacity: 1,
                          transition: "opacity 460ms cubic-bezier(0.2,0.7,0.2,1)",
                          overflow: "hidden",
                      }}
                  >
                      <canvas
                          ref={canvasRef}
                          style={{ display: "block", width: "100%", height: "100%" }}
                      />
                      {/* dark vignette */}
                      <div
                          style={{
                              position: "absolute",
                              inset: 0,
                              pointerEvents: "none",
                              background:
                                  "radial-gradient(ellipse 78% 76% at 50% 50%, transparent 48%, rgba(1,1,3,0.45) 74%, rgba(1,1,3,0.92) 100%)",
                          }}
                      />
                      {/* blurry edges */}
                      <div
                          style={{
                              position: "absolute",
                              inset: 0,
                              pointerEvents: "none",
                              backdropFilter: "blur(7px)",
                              WebkitBackdropFilter: "blur(7px)",
                              WebkitMaskImage:
                                  "radial-gradient(ellipse 70% 68% at 50% 50%, transparent 54%, #000 86%)",
                              maskImage:
                                  "radial-gradient(ellipse 70% 68% at 50% 50%, transparent 54%, #000 86%)",
                          }}
                      />
                      {/* escape button */}
                      <div
                          onClick={handleClose}
                          style={{
                              position: "absolute",
                              top: 30,
                              right: 40,
                              fontFamily:
                                  "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
                              fontSize: 11,
                              letterSpacing: 1,
                              textTransform: "uppercase",
                              color: "#aeaeae",
                              cursor: "pointer",
                              border: "1px solid rgba(255,255,255,0.15)",
                              padding: "8px 16px",
                              background: "rgba(1,1,3,0.4)",
                              userSelect: "none",
                          }}
                      >
                          [ ESCAPE_MIND ]
                      </div>
                  </div>,
                  document.body
              )
            : null

    return (
        <div style={{ position: "relative", display: "inline-block", ...props.style }}>
            <button
                onClick={handleOpen}
                style={{
                    appearance: "none",
                    cursor: "pointer",
                    fontFamily:
                        "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
                    fontSize: 13,
                    letterSpacing: 2,
                    textTransform: "uppercase",
                    color: "#ffffff",
                    background: "rgba(26,86,255,0.10)",
                    border: `1px solid ${accentColor}`,
                    borderRadius: 0,
                    padding: "14px 26px",
                    transition: "background 200ms ease, transform 200ms ease",
                }}
                onMouseEnter={(e) => {
                    e.currentTarget.style.background = "rgba(26,86,255,0.22)"
                }}
                onMouseLeave={(e) => {
                    e.currentTarget.style.background = "rgba(26,86,255,0.10)"
                }}
            >
                {buttonLabel}
            </button>
            {overlay}
        </div>
    )
}

addPropertyControls(MindPortal, {
    buttonLabel: {
        type: ControlType.String,
        title: "Button",
        defaultValue: "ENTER THE MIND",
    },
    coverTitle: {
        type: ControlType.String,
        title: "Cover Title",
        defaultValue: "THE IDEAL CANDIDATE",
    },
    tagline: {
        type: ControlType.String,
        title: "Tagline",
        defaultValue: "How we work is changing shape.",
    },
    accentColor: {
        type: ControlType.Color,
        title: "Accent",
        defaultValue: "#1a56ff",
    },
})
