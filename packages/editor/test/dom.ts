// What jsdom leaves out of the DOM that CodeMirror measures with.
//
// jsdom has no layout, so `Range` carries neither `getClientRects` nor
// `getBoundingClientRect`. CodeMirror calls them from its measure cycle, which
// runs in an animation frame: when that frame lands while a test is still
// running — which is a matter of timing, and happens on a loaded machine — the
// missing method throws inside the frame, vitest reports an unhandled error,
// and a test that asserted nothing about layout fails. Seen as a one-in-many
// failure of an Enter-key test in the release gate.
//
// Empty answers are the honest ones: there is no layout, so there are no
// rectangles. Nothing here pretends to measure.
const empty = () => [] as unknown as DOMRectList
const zero = () => new DOMRect(0, 0, 0, 0)

if (typeof Range !== 'undefined') {
  Range.prototype.getClientRects ??= empty
  Range.prototype.getBoundingClientRect ??= zero
}
