// Fire glow and rising sparks that sit behind the trending cards. Purely
// decorative: it's a separate layer under the (solid) cards, so the blur on the
// flames never touches card text. Styles live in index.css (.fire-backdrop).

// Spark positions/timings are fixed so the effect looks the same on every render
const SPARKS = [
  { left: 4, delay: 0, duration: 4.2, size: 3 },
  { left: 11, delay: 2.1, duration: 5.0, size: 2 },
  { left: 18, delay: 0.9, duration: 3.8, size: 4 },
  { left: 26, delay: 3.0, duration: 4.6, size: 2 },
  { left: 33, delay: 1.4, duration: 5.2, size: 3 },
  { left: 41, delay: 0.3, duration: 4.0, size: 2 },
  { left: 48, delay: 2.6, duration: 4.8, size: 4 },
  { left: 56, delay: 1.1, duration: 3.6, size: 3 },
  { left: 63, delay: 3.4, duration: 5.4, size: 2 },
  { left: 70, delay: 0.6, duration: 4.4, size: 3 },
  { left: 77, delay: 2.3, duration: 3.9, size: 2 },
  { left: 84, delay: 1.7, duration: 5.1, size: 4 },
  { left: 91, delay: 0.2, duration: 4.3, size: 2 },
  { left: 97, delay: 2.9, duration: 4.7, size: 3 }
];

function FireBackdrop() {
  return (
    <div className="fire-backdrop" aria-hidden="true">
      <div className="fire-glow" />
      <div className="fire-flames">
        <span className="flame" style={{ left: '8%', animationDelay: '0s' }} />
        <span className="flame" style={{ left: '30%', animationDelay: '0.7s' }} />
        <span className="flame" style={{ left: '52%', animationDelay: '0.3s' }} />
        <span className="flame" style={{ left: '74%', animationDelay: '1.1s' }} />
        <span className="flame" style={{ left: '94%', animationDelay: '0.5s' }} />
      </div>
      {SPARKS.map((spark, i) => (
        <span
          key={i}
          className="spark"
          style={{
            left: `${spark.left}%`,
            width: spark.size,
            height: spark.size,
            animationDelay: `${spark.delay}s`,
            animationDuration: `${spark.duration}s`
          }}
        />
      ))}
    </div>
  );
}

export default FireBackdrop;
