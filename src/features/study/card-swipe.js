/**
 * Horizontal swipe gesture for the flashcard.
 *
 * - Swipe left  -> next card (matches keyboard ArrowRight semantics:
 *   the card slides off to the left, the next card comes in from the right).
 * - Swipe right -> previous card.
 * - Vertical drags and short horizontal drags are treated as taps and let
 *   the normal click handler fire (flipCard).
 */

const SWIPE_MIN_DX = 50;       // px — minimum horizontal travel to count as swipe
const SWIPE_MAX_DY = 40;       // px — maximum vertical drift before the gesture is rejected
const POINTER_CANCEL_AGE = 600; // ms — drag older than this is ignored

export function bindCardSwipe(element, { onSwipeLeft, onSwipeRight } = {}) {
  if (!element || typeof element.addEventListener !== "function") return;

  let startX = 0;
  let startY = 0;
  let startedAt = 0;
  let activePointerId = null;
  let lastSwipeAt = Number.NEGATIVE_INFINITY;

  const reset = () => {
    activePointerId = null;
  };

  element.addEventListener("pointerdown", (event) => {
    // Only react to primary button for mouse; touch and pen always have button 0.
    if (event.pointerType === "mouse" && event.button !== 0) return;
    activePointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    startedAt = event.timeStamp || Date.now();
  });

  element.addEventListener("pointerup", (event) => {
    if (activePointerId !== event.pointerId) return;
    activePointerId = null;

    const now = event.timeStamp || Date.now();
    if (now - startedAt > POINTER_CANCEL_AGE) return;

    const dx = event.clientX - startX;
    const dy = event.clientY - startY;

    if (Math.abs(dy) > SWIPE_MAX_DY) return;
    if (Math.abs(dx) < SWIPE_MIN_DX) return;

    lastSwipeAt = now;
    if (dx < 0) onSwipeLeft?.();
    else onSwipeRight?.();
  });

  element.addEventListener("pointercancel", reset);
  element.addEventListener("pointerleave", (event) => {
    if (activePointerId === event.pointerId) reset();
  });

  // Suppress the synthetic click that follows a swipe so flipCard doesn't fire.
  // Use the capture phase to intercept before the existing click handler.
  // lastSwipeAt starts at -Infinity so the very first click (no prior swipe)
  // never trips the suppressor, even if event.timeStamp is small.
  element.addEventListener(
    "click",
    (event) => {
      if (!Number.isFinite(lastSwipeAt)) return;
      const now = event.timeStamp || Date.now();
      if (now - lastSwipeAt < 350) {
        event.stopImmediatePropagation();
        event.preventDefault();
      }
    },
    true,
  );
}
