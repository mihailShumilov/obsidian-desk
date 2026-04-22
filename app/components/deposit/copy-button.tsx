'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';

export function CopyButton({ value }: { value: string }): JSX.Element {
  const [copied, setCopied] = useState(false);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard API can fail under non-secure contexts; ignore quietly.
    }
  }

  return (
    <Button size="sm" variant="secondary" onClick={copy} type="button">
      {copied ? 'Copied' : 'Copy'}
    </Button>
  );
}
