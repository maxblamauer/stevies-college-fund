import type { ReactNode } from 'react';

/** Cloud + dot trail (cartoon thought bubble) behind Stevie’s popover text. */
export function StevieThoughtBubble({ children }: { children: ReactNode }) {
  return (
    <div className="stevie-mood-popover stevie-mood-popover--thought" role="dialog" aria-label="Stevie says">
      <svg
        className="stevie-thought-svg"
        viewBox="0 0 320 168"
        aria-hidden
      >
        <circle
          className="stevie-thought-dot"
          cx={34}
          cy={10}
          r={3.2}
          fill="var(--bg-card)"
          stroke="currentColor"
          strokeWidth={2.4}
        />
        <circle
          className="stevie-thought-dot"
          cx={46}
          cy={24}
          r={4.6}
          fill="var(--bg-card)"
          stroke="currentColor"
          strokeWidth={2.4}
        />
        <circle
          className="stevie-thought-dot"
          cx={58}
          cy={42}
          r={6.4}
          fill="var(--bg-card)"
          stroke="currentColor"
          strokeWidth={2.4}
        />
        <path
          fill="var(--bg-card)"
          stroke="currentColor"
          strokeWidth={2.75}
          strokeLinejoin="round"
          strokeLinecap="round"
          d="M 62 54
            C 44 52 28 64 30 82
            C 22 94 26 114 44 120
            C 48 138 78 148 104 138
            C 124 152 168 150 192 132
            C 218 144 262 130 272 100
            C 292 88 288 58 262 48
            C 252 30 218 28 192 38
            C 172 26 138 30 118 42
            C 96 36 72 42 62 54 Z"
        />
      </svg>
      <div className="stevie-mood-popover-content">{children}</div>
    </div>
  );
}
