/**
 * StepShell — full-width card for a wizard step. States:
 *   - active:  cipher-cyan accent border, full opacity
 *   - completed: collapsed to a checkmark + summary line
 *   - pending: muted/disabled
 */

import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export interface StepShellProps {
  index: number;
  title: string;
  state: 'pending' | 'active' | 'completed';
  /** Shown on the right of the title row when completed (e.g. truncated address). */
  summary?: string;
  children?: React.ReactNode;
}

export function StepShell({
  index,
  title,
  state,
  summary,
  children,
}: StepShellProps): JSX.Element {
  return (
    <Card
      className={cn(
        'transition-colors duration-200 ease-snappy',
        state === 'active' && 'border-cipher-cyan/40',
        state === 'completed' && 'border-obsidian-700',
        state === 'pending' && 'opacity-60',
      )}
    >
      <div className="flex items-center justify-between gap-3 px-6 py-5">
        <div className="flex items-center gap-3">
          <span
            className={cn(
              'flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold',
              state === 'completed'
                ? 'border-cipher-cyan bg-cipher-cyan/15 text-cipher-cyan'
                : state === 'active'
                  ? 'border-cipher-cyan bg-cipher-cyan text-obsidian-950'
                  : 'border-obsidian-700 text-muted',
            )}
          >
            {state === 'completed' ? '✓' : index}
          </span>
          <h2 className="text-lg font-semibold tracking-tightest">{title}</h2>
        </div>
        {state === 'completed' && summary && (
          <span className="font-mono text-xs text-muted">{summary}</span>
        )}
      </div>
      {state !== 'completed' && children && (
        <div className="border-t border-obsidian-700 px-6 py-6">{children}</div>
      )}
    </Card>
  );
}
