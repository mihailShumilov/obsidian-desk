/**
 * ProgressRail — sticky vertical 3-dot indicator for the wizard.
 * Active dot pulses; completed dots show a checkmark; pending dots are dim.
 */

import { cn } from '@/lib/utils';

export type StepKey = 'create' | 'fund' | 'lock';

const STEPS: ReadonlyArray<{ key: StepKey; label: string }> = [
  { key: 'create', label: 'Create' },
  { key: 'fund', label: 'Fund' },
  { key: 'lock', label: 'Lock' },
];

export function ProgressRail({ current }: { current: StepKey | 'done' }): JSX.Element {
  const currentIdx =
    current === 'done' ? STEPS.length : STEPS.findIndex((s) => s.key === current);

  return (
    <ol className="sticky top-24 hidden flex-col gap-5 lg:flex">
      {STEPS.map((step, i) => {
        const done = i < currentIdx;
        const active = i === currentIdx;
        return (
          <li key={step.key} className="flex items-center gap-3">
            <span
              className={cn(
                'flex size-7 items-center justify-center rounded-full border text-xs font-semibold',
                done && 'border-cipher-cyan bg-cipher-cyan/15 text-cipher-cyan',
                active &&
                  'border-cipher-cyan bg-cipher-cyan text-obsidian-950 animate-pulse-cipher',
                !done && !active && 'border-obsidian-700 text-muted',
              )}
            >
              {done ? '✓' : i + 1}
            </span>
            <span
              className={cn(
                'text-xs uppercase tracking-widest',
                active ? 'text-foreground' : 'text-muted',
              )}
            >
              {step.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
