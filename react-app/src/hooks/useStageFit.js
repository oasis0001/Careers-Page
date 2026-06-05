import { useEffect } from 'react';

/**
 * Fit the fixed 1440×750 stage proportionally inside the viewport via transform:scale().
 * Mirrors the original page's fit() routine — only scaling, never reflowing the design.
 */
export function useStageFit(stageRef) {
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const fit = () => {
      const sx = window.innerWidth / 1440;
      const sy = window.innerHeight / 750;
      const s = Math.min(sx, sy);
      stage.style.transform = `scale(${s})`;
    };
    window.addEventListener('resize', fit);
    fit();
    return () => window.removeEventListener('resize', fit);
  }, [stageRef]);
}
