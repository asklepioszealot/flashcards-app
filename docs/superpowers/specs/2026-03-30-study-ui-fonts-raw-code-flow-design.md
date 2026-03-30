# Study UI Font, Raw Code, and Card Transition Design

## Scope

This design covers three related changes in the flashcards app:

1. Extend card content font controls so normal and fullscreen study modes can be configured independently.
2. Update the raw code editor view so it opens at full content height and becomes scroll-only instead of manually resizable.
3. Remove the perceived delay when navigating to the next or previous card while the back face is visible.

## Approved Direction

The approved approach is the lightweight, backward-compatible option:

- Keep the current manager-side card content settings panel.
- Preserve the existing normal-mode front/back font controls.
- Add a second pair of inputs for fullscreen front/back font sizes.
- Add a reset action that restores only font-size preferences.
- Keep raw code visually expanded to the full content height, but do not allow manual resize.
- Make card navigation reset the flipped state immediately instead of waiting on the flip transition.

## User-Facing Outcome

### 1. Card Content Settings

The settings panel will show four number inputs:

- Normal mode front content font size
- Normal mode back content font size
- Fullscreen front content font size
- Fullscreen back content font size

The panel will also include a `Varsayılan fontlara dön` action.

This reset action will affect only card font-size preferences. It will not change theme, analytics visibility, auto-advance, review preferences, or any other study state.

### 2. Default Font Values

Reset will restore these defaults:

- Normal front: `24`
- Normal back: `18`
- Fullscreen front: `28`
- Fullscreen back: `20`

These values intentionally preserve the current visual baseline:

- Normal mode stays aligned with the existing stored defaults.
- Fullscreen mode stays aligned with the current hardcoded fullscreen typography.

### 3. Raw Code Behavior

When the editor switches to raw mode:

- The raw textarea height will expand to fit the full content.
- The raw area will no longer be user-resizable.
- If the content exceeds viewport space, the page will scroll naturally.
- The raw textarea itself will remain scrollable for keyboard and browser compatibility, but the intended interaction is no longer “drag to resize.”

This keeps the full source visible by default while avoiding a second height-management control in the editor.

### 4. Study Navigation Behavior

When the user moves to the previous or next card while the current card is showing the back face:

- The app will clear the flipped state immediately.
- The new card content will render without waiting for the visible flip-back transition.

This applies to:

- Previous button
- Next button
- Keyboard arrow navigation
- Jump-to-card
- Auto-advance callback after assessment
- Any study-screen path that reuses the shared card-display flow

## Technical Design

### 1. Preference Model

The current study-state preference object is:

```js
{
  frontFontSize: 24,
  backFontSize: 18
}
```

It will be extended in a backward-compatible way:

```js
{
  frontFontSize: 24,
  backFontSize: 18,
  fullscreenFrontFontSize: 28,
  fullscreenBackFontSize: 20
}
```

Backward compatibility rules:

- Old snapshots containing only `frontFontSize` and `backFontSize` must still load cleanly.
- Missing fullscreen keys must fall back to `28` and `20`.
- Local and synced study-state normalization must clamp all four values to the existing allowed font range.

### 2. CSS Variable Strategy

The study module currently writes root variables for normal mode only. That will expand to four variables:

- `--card-content-font-front`
- `--card-content-font-back`
- `--card-content-font-front-fullscreen`
- `--card-content-font-back-fullscreen`

Normal card content will continue using the normal variables.

Fullscreen-specific study selectors will stop using hardcoded `28px` and `20px` values and will instead read from the fullscreen variables.

### 3. Settings Panel Structure

The current settings card will remain in place and be expanded rather than redesigned.

Layout rules:

- Keep the existing panel header and close affordance.
- Present normal and fullscreen controls in the same visual group.
- Make the fullscreen labels explicit so there is no ambiguity about which context each input affects.
- Place the reset action inside the same card so the relationship to font settings is obvious.

### 4. Raw Editor Height Handling

The raw editor state currently persists manual height. That behavior will be simplified:

- The rendered raw textarea height will be derived from its scroll height on render and after content updates.
- The raw textarea CSS will no longer use `resize: vertical`.
- The persisted raw editor state will keep focus, selection, and scroll restoration, but height will no longer be treated as a user-controlled dimension.

This means the raw view becomes deterministic: it always opens fully expanded to content height.

### 5. Instant Flip Reset

The perceived delay comes from removing the `flipped` class inside the normal display flow, which allows the front/back transition to animate before the new card feels visible.

The fix will introduce an internal “instant reset” path for study navigation:

- Temporarily suppress flip transition styles on the flashcard root.
- Clear the flipped state synchronously.
- Render the next card content.
- Restore transition styling for future intentional flip interactions.

This preserves the flip animation when the user explicitly flips a card, while removing the unwanted animation during navigation.

## Files Expected To Change

- `index.html`
- `src/features/study/study.js`
- `src/shared/constants.js`
- `src/shared/utils.js`
- `src/app/state.js`
- `src/features/study-state/study-state.js`
- `src/core/platform-adapter.js`
- `src/features/auth/auth.js`
- `src/features/editor/editor-render.js`
- `src/features/editor/editor-events.js`
- `src/features/editor/editor-state.js`
- `tests/smoke/app-smoke.spec.js`
- `tests/unit/study-state-sync.test.js`

## Testing Plan

### Smoke Coverage

Add or update smoke assertions for:

- Opening the card settings panel and seeing four font inputs
- Resetting font preferences to the approved defaults
- Applying separate fullscreen values and observing them in fullscreen study mode
- Raw code opening at content height without resize affordance
- Navigating from a flipped card and observing immediate card change without waiting on transition timing

### Unit Coverage

Add or update unit coverage for:

- Study-state normalization with the two new fullscreen font keys
- Backward-compatible loading of legacy font preference snapshots

## Out Of Scope

These are explicitly not part of this change:

- Theme redesign
- Study card layout redesign
- New editor toolbars or editor split controls
- Any non-font setting reset behavior
- Release/version bump/deployment work

## Self-Review

This design has been checked for:

- No placeholder values
- No contradictory defaults
- Backward-compatible state migration
- Clear raw-editor behavior after the user requested scroll-only interaction
- Shared navigation fix scope instead of patching only one button path
