/**
 * Transparent hover trigger zones sitting over each feature box. Hovering sets the
 * feature "hot" (white + full scale); clicking dives into that feature's scene via
 * the shared shatter-dive (handled by the parent through onActivate).
 */
const ZONES = [
  { target: 'head', left: 580, top: 100, width: 305, height: 88 },
  { target: 'eye', left: 662, top: 263, width: 99, height: 90 },
  { target: 'mouth', left: 593, top: 420, width: 120, height: 54 },
];

const px = (v) => `${v}px`;

export default function HoverZones({ onHover, onActivate }) {
  return (
    <>
      {ZONES.map((z) => (
        <div
          key={z.target}
          className="hover-zone"
          data-target={z.target}
          style={{ left: px(z.left), top: px(z.top), width: px(z.width), height: px(z.height) }}
          onMouseEnter={() => onHover(z.target)}
          onMouseLeave={() => onHover(null)}
          onClick={(e) => { e.stopPropagation(); onActivate(z.target); }}
        />
      ))}
    </>
  );
}
