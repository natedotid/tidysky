/**
 * The fixed height of a follow row, in px. One source of truth: the virtual
 * list's `rowHeight` and FollowRow's `.row` height must agree, or the
 * virtualization math drifts from the rendered rows. FollowRow's CSS reads
 * it through the `--row-h` custom property it sets inline.
 *
 * 72 px: the three lines (name at the body font, stats and "You:" at the
 * smaller secondary size) are about 68 px. The pre-round-2 80 px paired
 * the secondary lines with the body size, which made the rows feel heavy;
 * with them smaller, 72 px fits them with room to spare.
 */
export const ROW_HEIGHT = 72;
