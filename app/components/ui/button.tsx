/**
 * Button — three variants per UI_DESIGN.md §4.2:
 *   primary   = cipher-cyan solid, glows on hover
 *   secondary = ghost with obsidian-700 border
 *   danger    = ghost in danger-red
 *
 * Always rounded-md (6px) — institutional, not consumer.
 */
import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const button = cva(
  // base
  'inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium ' +
    'transition-all duration-200 ease-snappy disabled:pointer-events-none disabled:opacity-50 ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cipher-cyan focus-visible:ring-offset-2 focus-visible:ring-offset-obsidian-950',
  {
    variants: {
      variant: {
        primary:
          'bg-cipher-cyan text-obsidian-950 hover:bg-cipher-cyan-dim hover:shadow-cipher',
        secondary:
          'border border-obsidian-700 bg-transparent text-foreground hover:bg-obsidian-800',
        ghost:
          'bg-transparent text-foreground hover:bg-obsidian-800',
        danger:
          'border border-transparent bg-transparent text-danger-red hover:bg-danger-red/10',
      },
      size: {
        sm: 'h-8 px-3 text-xs',
        md: 'h-10 px-4',
        lg: 'h-12 px-6 text-base',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof button> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(button({ variant, size }), className)}
      {...props}
    />
  ),
);
Button.displayName = 'Button';
