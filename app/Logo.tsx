/**
 * SnipAi mark: a play triangle with a cut taken out of it.
 *
 * The idea is the product in one shape -- video, sliced. The slash is the
 * edit, and the offset lower half is the piece that got moved up tight
 * against the one before it, which is literally what the app does. Cyan on
 * the kept side, magenta on the cut side.
 *
 * Built from simple geometry so it survives at 16px in a browser tab.
 */
export function Logo({ size = 26, glow = true }: { size?: number; glow?: boolean }) {
  const id = "snipai-logo";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      role="img"
      aria-label="SnipAi"
      style={glow ? { filter: "drop-shadow(0 0 6px rgba(0,229,255,.55))" } : undefined}
    >
      <defs>
        <linearGradient id={`${id}-a`} x1="0" y1="0" x2="40" y2="40">
          <stop offset="0%" stopColor="#00e5ff" />
          <stop offset="100%" stopColor="#4df0ff" />
        </linearGradient>
        <linearGradient id={`${id}-b`} x1="0" y1="40" x2="40" y2="0">
          <stop offset="0%" stopColor="#ff2d95" />
          <stop offset="100%" stopColor="#ff7ac0" />
        </linearGradient>
      </defs>

      {/* upper half of the play triangle -- the take that got kept */}
      <path d="M9 5.5 L31.5 17.2 L9 17.2 Z" fill={`url(#${id}-a)`} />

      {/* lower half, shifted left: the cut closed the gap */}
      <path d="M5.5 21.4 L28 21.4 L5.5 34.5 Z" fill={`url(#${id}-b)`} />

      {/* the cut itself */}
      <path d="M2.5 19.3 L37.5 19.3" stroke="#eef1ff" strokeWidth="2" strokeLinecap="round" opacity=".92" />
    </svg>
  );
}
