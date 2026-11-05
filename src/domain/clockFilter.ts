/**
 * The main process relays video clocks and timing-bar seek requests to every window. Each message
 * carries the contentId of the session it belongs to so that two sessions open at once (two
 * multiviews, or a multiview plus a popout for another race) never drive each other.
 * A message or a receiver without a contentId (older window, unknown session) is not filtered.
 */
export function sessionMatches(mine: number | null | undefined, incoming: number | null | undefined): boolean {
  if (mine == null || incoming == null) return true;
  return Number(mine) === Number(incoming);
}
