/**
 * Default ObsidianDesk Anchor program id.
 *
 * Mirrors `declare_id!` in `programs/obsidian-core/src/lib.rs` and
 * `[programs.devnet]` in `Anchor.toml`. Consumers should resolve via
 * `process.env['NEXT_PUBLIC_OBSIDIAN_PROGRAM_ID'] ?? DEFAULT_OBSIDIAN_PROGRAM_ID`
 * (or `OBSIDIAN_PROGRAM_ID` for server-side / Node consumers) so a fresh
 * deploy can override without rebuilding.
 */

export const DEFAULT_OBSIDIAN_PROGRAM_ID =
  'H25yY5o4emorZ9qMHAUvJhdtrFjDSeYy2MVYurpQbeLp';
