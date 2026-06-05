import { useEffect, useRef, useState } from 'react';
import { useStageFit } from './hooks/useStageFit.js';
import AsciiBackground from './components/AsciiBackground.jsx';
import Statue from './components/Statue.jsx';
import Features from './components/Features.jsx';
import HoverZones from './components/HoverZones.jsx';
import BrainOverlay from './components/BrainOverlay.jsx';
import BrainAsciiOverlay from './components/BrainAsciiOverlay.jsx';
import AudioVizOverlay from './components/AudioVizOverlay.jsx';

export default function App() {
  const stageRef = useRef(null);
  const bgCanvasRef = useRef(null);
  const statueCanvasRef = useRef(null);

  const brainRef = useRef(null);       // EYE — shatter-dive void (also the shared dive)
  const brainAsciiRef = useRef(null);  // HEAD — dithered brain
  const audioVizRef = useRef(null);    // MOUTH — particle wave

  const [hot, setHot] = useState(null);

  useStageFit(stageRef);

  // Warm up the brain model in the background so its fly-in is ready on entry.
  useEffect(() => {
    const preloadBrain = () => { try { brainAsciiRef.current?.preload(); } catch (e) {} };
    if ('requestIdleCallback' in window) {
      const id = requestIdleCallback(preloadBrain, { timeout: 2500 });
      return () => cancelIdleCallback(id);
    }
    const id = setTimeout(preloadBrain, 1200);
    return () => clearTimeout(id);
  }, []);

  // All three features use the SAME shatter+dive entrance; EYE lands in the void,
  // HEAD lands in the ASCII brain, MOUTH lands in the audio particle wave.
  const activate = (target) => {
    if (target === 'eye') { brainRef.current?.open(); return; }
    if (target === 'head') { brainRef.current?.open({ reveal: () => brainAsciiRef.current?.open(true) }); return; }
    if (target === 'mouth') { brainRef.current?.open({ reveal: () => audioVizRef.current?.open(true) }); return; }
  };

  return (
    <div className="scale-wrap">
      <div className="stage" id="stage" ref={stageRef}>
        <AsciiBackground canvasRef={bgCanvasRef} />
        <div className="bg-vignette" />

        <Statue canvasRef={statueCanvasRef} />

        <div className="title-main"><span className="t-the">the</span>Ideal Candidate</div>

        <Features hot={hot} />

        <HoverZones onHover={setHot} onActivate={activate} />

        <BrainOverlay ref={brainRef} bgCanvasRef={bgCanvasRef} statueCanvasRef={statueCanvasRef} />
        <BrainAsciiOverlay ref={brainAsciiRef} />
        <AudioVizOverlay ref={audioVizRef} />
      </div>
    </div>
  );
}
