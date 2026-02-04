/**
 * Shared AudioContext singleton for the UTAU Voicebank Manager.
 *
 * Browsers limit the number of concurrent AudioContext instances (typically ~6).
 * By sharing a single context across all components, we avoid hitting this limit
 * and reduce resource overhead.
 *
 * The singleton is lazily created on first access and automatically recreated
 * if the previous context was closed (e.g., after a page-level cleanup).
 *
 * Components should call `getSharedAudioContext()` instead of `new AudioContext()`.
 * The returned context may be in a 'suspended' state due to browser autoplay
 * policy -- callers should still check and resume as needed.
 *
 * @example
 * ```typescript
 * import { getSharedAudioContext } from '../services/audio-context.js';
 *
 * const ctx = getSharedAudioContext();
 * if (ctx.state === 'suspended') {
 *   await ctx.resume();
 * }
 * const buffer = await ctx.decodeAudioData(arrayBuffer);
 * ```
 */

let _sharedContext: AudioContext | null = null;

/**
 * Get the shared AudioContext singleton.
 *
 * Creates a new AudioContext on first call, or if the previous one was closed.
 * The returned context is shared across all components -- do NOT close it.
 */
export function getSharedAudioContext(): AudioContext {
  if (!_sharedContext || _sharedContext.state === 'closed') {
    _sharedContext = new AudioContext();
  }
  return _sharedContext;
}
