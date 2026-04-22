'use client';

/**
 * KeyShards — two halves of a key SVG drift in from outside the frame
 * and snap together via a framer-motion spring when the parent flips
 * `joined` to true. Used in step 1 ("Create dWallet") to visualize the
 * 2PC-MPC concept (you + the network jointly hold the key).
 */

import { motion } from 'framer-motion';

export function KeyShards({ joined }: { joined: boolean }): JSX.Element {
  return (
    <div className="relative flex h-32 w-full items-center justify-center">
      {/* Left shard */}
      <motion.div
        className="absolute"
        animate={{ x: joined ? -12 : -100, opacity: joined ? 1 : 0.5 }}
        transition={{ type: 'spring', stiffness: 220, damping: 22 }}
      >
        <KeyHalf side="left" lit={joined} />
      </motion.div>

      {/* Right shard */}
      <motion.div
        className="absolute"
        animate={{ x: joined ? 12 : 100, opacity: joined ? 1 : 0.5 }}
        transition={{ type: 'spring', stiffness: 220, damping: 22, delay: joined ? 0.05 : 0 }}
      >
        <KeyHalf side="right" lit={joined} />
      </motion.div>

      {/* Center pulse when joined */}
      {joined && (
        <motion.div
          className="absolute size-3 rounded-full bg-cipher-cyan"
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: [0, 1.6, 1], opacity: [0, 1, 0.7] }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
          style={{ boxShadow: '0 0 24px rgba(0,245,212,0.7)' }}
        />
      )}
    </div>
  );
}

function KeyHalf({ side, lit }: { side: 'left' | 'right'; lit: boolean }): JSX.Element {
  const stroke = lit ? '#00F5D4' : '#71717A';
  // Left half is the bow (loop); right half is the bit (teeth).
  if (side === 'left') {
    return (
      <svg width="60" height="60" viewBox="0 0 60 60" fill="none" aria-hidden="true">
        <circle cx="22" cy="30" r="14" stroke={stroke} strokeWidth="2.4" />
        <circle cx="22" cy="30" r="5" stroke={stroke} strokeWidth="1.8" />
        <line
          x1="36"
          y1="30"
          x2="58"
          y2="30"
          stroke={stroke}
          strokeWidth="2.4"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  return (
    <svg width="60" height="60" viewBox="0 0 60 60" fill="none" aria-hidden="true">
      <line
        x1="2"
        y1="30"
        x2="42"
        y2="30"
        stroke={stroke}
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <line x1="14" y1="30" x2="14" y2="40" stroke={stroke} strokeWidth="2.4" />
      <line x1="22" y1="30" x2="22" y2="38" stroke={stroke} strokeWidth="2.4" />
      <line x1="30" y1="30" x2="30" y2="42" stroke={stroke} strokeWidth="2.4" />
    </svg>
  );
}
