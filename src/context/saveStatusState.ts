/**
 * The nav's save tag, as pure logic.
 *
 * Two words, two states. `saving` while any save is in flight, `saved` for a beat after the
 * last one lands, `idle` the rest of the time, and idle renders nothing at all, so the tag
 * only ever exists when it has something to say.
 *
 * A failed save drops straight back to idle. The tag does not report failure: the screen that
 * owns the save already shows "Save failed / Retry" where the retry lives, and a nav tag that
 * says something is wrong but can't be tapped is worse than no tag.
 */

export type SaveStatus = 'idle' | 'saving' | 'saved';

export type SaveStatusState = Readonly<{
  status: SaveStatus;
  /** In-flight saves. Two screens (or a screen and its platform-overrides flush) can overlap. */
  pending: number;
  /** When the last save landed; 0 while none has. Drives the fade-out timer. */
  settledAt: number;
}>;

export type SaveStatusEvent =
  | { type: 'start' }
  | { type: 'settle'; ok: boolean; now: number }
  | { type: 'clear' }
  | { type: 'reset' };

/**
 * How long "Saved" stays up. Measured against the three hand-rolled pills this replaces:
 * SyncRules held 1600ms, GenerateDetails 2500ms, ProductDetail 5000ms + a 400ms fade. 1600ms
 * read as a blink and 5000ms outlived the glance it answers, so the tag takes the middle one
 * and fades rather than cutting.
 */
export const SAVED_HOLD_MS = 2500;

export const initialSaveStatusState: SaveStatusState = {
  status: 'idle',
  pending: 0,
  settledAt: 0,
};

export function saveStatusReducer(
  state: SaveStatusState,
  event: SaveStatusEvent,
): SaveStatusState {
  if (event.type === 'start') {
    // A fresh save supersedes the previous "Saved": one tag, latest truth.
    return { status: 'saving', pending: state.pending + 1, settledAt: 0 };
  }

  if (event.type === 'settle') {
    // An unbalanced settle (double-called, or arriving after a reset) must not push pending
    // negative and strand the tag on "Saving" forever.
    if (state.pending === 0) return state;
    const pending = state.pending - 1;
    if (pending > 0) return { ...state, pending };
    return event.ok
      ? { status: 'saved', pending: 0, settledAt: event.now }
      : { status: 'idle', pending: 0, settledAt: 0 };
  }

  if (event.type === 'clear') {
    if (state.status !== 'saved') return state;
    return { status: 'idle', pending: 0, settledAt: 0 };
  }

  return state.status === 'idle' && state.pending === 0 ? state : initialSaveStatusState;
}
