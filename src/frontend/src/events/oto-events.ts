/**
 * Event helpers for oto.ini entry changes.
 *
 * Provides a lightweight, typed event mechanism using CustomEvent on `window`.
 * When oto entries are created, updated, or deleted via the API, the
 * `oto-entries-changed` event is dispatched so that caches (e.g., SampleLoader)
 * can automatically invalidate stale data.
 *
 * @example
 * ```typescript
 * // Dispatch (done automatically by ApiClient after oto mutations)
 * dispatchOtoEntriesChanged('my-voicebank');
 *
 * // Listen
 * const handler = onOtoEntriesChanged((voicebankId) => {
 *   console.log('Oto entries changed for:', voicebankId);
 * });
 *
 * // Stop listening
 * offOtoEntriesChanged(handler);
 * ```
 */

/** Name of the custom event dispatched on `window`. */
export const OTO_ENTRIES_CHANGED_EVENT = 'oto-entries-changed';

/**
 * Detail payload for the oto-entries-changed event.
 */
export interface OtoEntriesChangedDetail {
  /** The voicebank whose oto entries were modified. */
  voicebankId: string;
  /** The type of mutation that occurred. */
  action: 'create' | 'update' | 'delete' | 'batch';
}

/**
 * Typed CustomEvent for oto entry changes.
 */
export type OtoEntriesChangedEvent = CustomEvent<OtoEntriesChangedDetail>;

/**
 * Dispatch an oto-entries-changed event on `window`.
 *
 * Call this after any successful oto mutation (create, update, delete, batch).
 *
 * @param voicebankId - The voicebank whose entries changed
 * @param action - The type of mutation
 */
export function dispatchOtoEntriesChanged(
  voicebankId: string,
  action: OtoEntriesChangedDetail['action'],
): void {
  window.dispatchEvent(
    new CustomEvent<OtoEntriesChangedDetail>(OTO_ENTRIES_CHANGED_EVENT, {
      detail: { voicebankId, action },
    }),
  );
}

/**
 * Callback type for oto-entries-changed listeners.
 */
export type OtoEntriesChangedCallback = (
  voicebankId: string,
  action: OtoEntriesChangedDetail['action'],
) => void;

/**
 * Subscribe to oto-entries-changed events on `window`.
 *
 * Returns the raw event listener function so it can be removed later
 * with {@link offOtoEntriesChanged}.
 *
 * @param callback - Invoked with the voicebank ID and action on each change
 * @returns The event listener (pass to offOtoEntriesChanged to unsubscribe)
 */
export function onOtoEntriesChanged(
  callback: OtoEntriesChangedCallback,
): EventListener {
  const listener = (e: Event): void => {
    const detail = (e as OtoEntriesChangedEvent).detail;
    callback(detail.voicebankId, detail.action);
  };
  window.addEventListener(OTO_ENTRIES_CHANGED_EVENT, listener);
  return listener;
}

/**
 * Unsubscribe a listener previously registered with {@link onOtoEntriesChanged}.
 *
 * @param listener - The listener returned by onOtoEntriesChanged
 */
export function offOtoEntriesChanged(listener: EventListener): void {
  window.removeEventListener(OTO_ENTRIES_CHANGED_EVENT, listener);
}
