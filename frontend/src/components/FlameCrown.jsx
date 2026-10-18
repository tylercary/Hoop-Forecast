import { useEffect, useId, useState } from 'react';

// Crisp SVG flames rising off the top edge of a trending card. Three layers
// (red outer, orange middle, yellow-white core) with sharp pointed tongues.
// They flicker by morphing between two flame shapes (SMIL <animate> on the
// path), so edges stay crisp instead of relying on blur.

const WIDTH = 280;

// Tongue layout across the card top: center (0-1), relative height, lean
const LAYOUTS = [
  [
    { x: 0.08, h: 0.55, lean: -4 }, { x: 0.22, h: 0.85, lean: 3 }, { x: 0.36, h: 0.65, lean: -2 },
    { x: 0.5, h: 1.0, lean: 2 }, { x: 0.64, h: 0.7, lean: -3 }, { x: 0.78, h: 0.9, lean: 4 },
    { x: 0.92, h: 0.5, lean: -2 }
  ],
  [
    { x: 0.08, h: 0.65, lean: 3 }, { x: 0.22, h: 0.7, lean: -3 }, { x: 0.36, h: 0.9, lean: 4 },
    { x: 0.5, h: 0.75, lean: -2 }, { x: 0.64, h: 1.0, lean: 3 }, { x: 0.78, h: 0.6, lean: -4 },
    { x: 0.92, h: 0.6, lean: 2 }
  ],
  [
    { x: 0.08, h: 0.5, lean: -2 }, { x: 0.22, h: 0.95, lean: -3 }, { x: 0.36, h: 0.6, lean: 3 },
    { x: 0.5, h: 0.85, lean: -4 }, { x: 0.64, h: 0.75, lean: 2 }, { x: 0.78, h: 1.0, lean: -2 },
    { x: 0.92, h: 0.55, lean: 3 }
  ]
];

/**
 * Build one flame silhouette: plump tongues that curve in to a flicking tip,
 * packed edge to edge on a solid band of fire (no flat gaps between them).
 * Every variant uses the same commands, so SMIL can morph between them.
 */
function flamePath(tongues, height, scale) {
  const base = height;
  // Valleys sit well above the base so the fire reads as one body with tongues
  const valleyY = base - height * 0.22 * scale;
  const step = WIDTH / tongues.length;
  const fmt = (n) => n.toFixed(1);

  let d = `M0,${base} L0,${fmt(valleyY)}`;
  tongues.forEach((tongue, i) => {
    const left = i * step;
    const right = (i + 1) * step;
    const tipX = tongue.x * WIDTH + tongue.lean * 2 * scale;
    const tipY = base - height * tongue.h * scale;
    const rise = valleyY - tipY;
    // Rising side: swell out at the body, then narrow to a sharp tip
    d += ` C${fmt(left + step * 0.08)},${fmt(valleyY - rise * 0.38)} ${fmt(tipX - step * 0.14)},${fmt(tipY + rise * 0.48)} ${fmt(tipX)},${fmt(tipY)}`;
    // Falling side: mirror it back down into a pointed valley
    d += ` C${fmt(tipX + step * 0.12)},${fmt(tipY + rise * 0.5)} ${fmt(right - step * 0.08)},${fmt(valleyY - rise * 0.36)} ${fmt(right)},${fmt(valleyY)}`;
  });
  d += ` L${WIDTH},${base} Z`;
  return d;
}

// Second shape for the flicker: heights wobble and tongues lean the other way
function flickerVariant(tongues) {
  return tongues.map((tongue, i) => ({
    ...tongue,
    h: tongue.h * (i % 2 === 0 ? 1.12 : 0.86),
    lean: -tongue.lean
  }));
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(query.matches);
    const onChange = (e) => setReduced(e.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

const LAYERS = [
  { scale: 1, duration: 1.3, gradient: [['0%', '#b91c1c'], ['55%', '#ea580c'], ['100%', '#f97316']] },
  { scale: 0.68, duration: 0.95, gradient: [['0%', '#f97316'], ['60%', '#fb923c'], ['100%', '#fbbf24']] },
  { scale: 0.4, duration: 0.75, gradient: [['0%', '#fde047'], ['100%', '#fef9c3']] }
];

function FlameCrown({ variant = 0, height = 40 }) {
  const id = useId().replace(/:/g, '');
  const reducedMotion = usePrefersReducedMotion();
  const tongues = LAYOUTS[variant % LAYOUTS.length];
  const flicker = flickerVariant(tongues);

  return (
    <svg
      className="flame-crown"
      viewBox={`0 0 ${WIDTH} ${height}`}
      preserveAspectRatio="none"
      style={{ height }}
      aria-hidden="true"
    >
      <defs>
        {LAYERS.map((layer, i) => (
          <linearGradient key={i} id={`${id}-g${i}`} x1="0" y1="0" x2="0" y2="1">
            {layer.gradient.map(([offset, color]) => (
              <stop key={offset} offset={offset} stopColor={color} />
            ))}
          </linearGradient>
        ))}
      </defs>
      {LAYERS.map((layer, i) => {
        const shapeA = flamePath(tongues, height, layer.scale);
        const shapeB = flamePath(flicker, height, layer.scale);
        return (
          <path key={i} d={shapeA} fill={`url(#${id}-g${i})`}>
            {!reducedMotion && (
              <animate
                attributeName="d"
                values={`${shapeA};${shapeB};${shapeA}`}
                dur={`${layer.duration + variant * 0.07}s`}
                repeatCount="indefinite"
                calcMode="spline"
                keySplines="0.45 0 0.55 1; 0.45 0 0.55 1"
              />
            )}
          </path>
        );
      })}
    </svg>
  );
}

export default FlameCrown;
