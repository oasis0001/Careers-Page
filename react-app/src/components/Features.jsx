/**
 * The three always-on feature label groups (head / eye / mouth). Default grey +
 * slightly shrunk; the one whose id matches `hot` lights white + scales to full
 * size (driven by the .hot class, exactly like the original). All coordinates are
 * the original absolute design-space values.
 */
const FEATURES = [
  {
    id: 'head',
    box: { left: 583.32, top: 104.4, width: 298.81, height: 79.31 },
    dots: [
      { left: 579.73, top: 98.94 }, { left: 878.55, top: 98.94 },
      { left: 579.73, top: 180.13 }, { left: 878.55, top: 180.13 },
    ],
    markers: [
      { left: 575.2, top: 89.26 }, { left: 870.89, top: 89.26 },
      { left: 575.2, top: 196.98 }, { left: 870.89, top: 196.98 },
    ],
    polyline: '882.16,154.52 1020.65,166.68 1295.06,166.68',
    text: { left: 1089, top: 180, width: 206, label: 'Makes AI their thinking partner' },
  },
  {
    id: 'eye',
    box: { left: 665.45, top: 267.59, width: 92.73, height: 81.61 },
    dots: [
      { left: 662.95, top: 264.27 }, { left: 752.87, top: 263.96 },
      { left: 663.26, top: 343.89 }, { left: 752.87, top: 344.2 },
    ],
    markers: [
      { left: 657.95, top: 258.5 }, { left: 750.99, top: 258.5 },
      { left: 656.39, top: 359.34 }, { left: 750.99, top: 359.34 },
    ],
    polyline: '757.85,306.27 924.61,391.43 1275.8,391.43',
    text: { left: 1041, top: 403, width: 235, label: 'Decodes the world through an AI lens' },
  },
  {
    id: 'mouth',
    box: { left: 596.75, top: 424.45, width: 113.03, height: 45.59 },
    dots: [
      { left: 593, top: 420.7 }, { left: 704.78, top: 420.7 },
      { left: 593, top: 467.84 }, { left: 705.72, top: 467.84 },
    ],
    markers: [
      { left: 584.26, top: 413.99 }, { left: 698.54, top: 414.61 },
      { left: 584.26, top: 481.74 }, { left: 698.54, top: 481.74 },
    ],
    polyline: '123.27,350.38 508.48,350.38 600.5,454.25',
    text: { left: 123, top: 288, width: 309, label: 'Translates objectives into perfect prompts' },
  },
];

const px = (v) => `${v}px`;

export default function Features({ hot }) {
  return (
    <>
      {FEATURES.map((f) => (
        <div
          key={f.id}
          className={`feature${hot === f.id ? ' hot' : ''}`}
          id={`feat-${f.id}`}
        >
          <div
            className="box"
            style={{ left: px(f.box.left), top: px(f.box.top), width: px(f.box.width), height: px(f.box.height) }}
          />
          {f.dots.map((d, i) => (
            <div key={`d${i}`} className="dot" style={{ left: px(d.left), top: px(d.top) }} />
          ))}
          {f.markers.map((m, i) => (
            <div key={`m${i}`} className="marker" style={{ left: px(m.left), top: px(m.top) }}>x100</div>
          ))}
          <svg className="line" viewBox="0 0 1440 750" preserveAspectRatio="none">
            <polyline points={f.polyline} />
          </svg>
          <div className="text" style={{ left: px(f.text.left), top: px(f.text.top), width: px(f.text.width) }}>
            {f.text.label}
          </div>
        </div>
      ))}
    </>
  );
}
