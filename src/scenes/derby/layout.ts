// Shared geometry for the derby overlay's left dashboard column.
//
// The column stacks, top to bottom, on the 1920×1080 canvas:
//
//   y=24    All-Star Weekend lockup (watermark)
//   y=140   DerbyTurnClock          — fixed height, the hitter's turn clock
//   y=346   DerbyMiniBoardScene     — the rail; fills whatever is left
//   y=866   DerbyPlayerScene        — hitter card, anchored to bottom: 84
//   y=1016  DerbyTickerScene        — bottom crawl, 64 tall
//
// Every piece reads its x/width from here so the column stays flush, and the
// rail sizes itself to the gap rather than guessing. If you move or resize any
// of them, change it HERE — the rail's height is derived from these numbers and
// will silently overlap its neighbours otherwise.

export const DERBY_COL_X = 32
export const DERBY_COL_W = 300

/** Turn clock: top edge and the height it occupies at its tallest (with a hitter name). */
export const DERBY_CLOCK_TOP = 140
export const DERBY_CLOCK_H = 190

/** Breathing room between stacked cards in the column. */
export const DERBY_COL_GAP = 16

/**
 * Top edge of the hitter card. `DerbyPlayerScene` is anchored `bottom: 84` and
 * runs ~130px tall, so it starts here — the rail must stop above it.
 */
export const DERBY_PLAYER_CARD_TOP = 866

/** The band the rail gets: below the clock (or below the watermark without it). */
export function derbyRailBand(clockVisible: boolean) {
  const top = clockVisible ? DERBY_CLOCK_TOP + DERBY_CLOCK_H + DERBY_COL_GAP : DERBY_CLOCK_TOP
  return { top, maxHeight: DERBY_PLAYER_CARD_TOP - DERBY_COL_GAP - top }
}
