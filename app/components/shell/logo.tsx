/**
 * ObsidianDesk logo — an isometric obsidian cube with cipher-cyan top edge.
 * Pure SVG so no extra request, scales cleanly at any size.
 */
export function ObsidianLogo({ size = 28 }: { size?: number }): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {/* Top face — the only lit face, in cipher-cyan */}
      <path
        d="M16 3 L28 9 L16 15 L4 9 Z"
        fill="#00F5D4"
        fillOpacity="0.85"
      />
      {/* Left face — obsidian-800 */}
      <path
        d="M4 9 L16 15 L16 29 L4 23 Z"
        fill="#12121C"
        stroke="#1E1E2C"
        strokeWidth="0.5"
      />
      {/* Right face — obsidian-700, slightly lighter */}
      <path
        d="M28 9 L16 15 L16 29 L28 23 Z"
        fill="#1E1E2C"
        stroke="#2A2A3C"
        strokeWidth="0.5"
      />
    </svg>
  );
}
