/**
 * Mission ordering rules.
 *
 * The stored order of a day is one list, and a move is one swap inside it. These
 * functions are pure so the boundary cases — first item, last item, an id that is
 * no longer in the list — are tested instead of discovered in production.
 *
 * Only open (planned/active) missions get move controls, but a swapped entry keeps
 * its place among the resolved ones: a completed mission that sits between two open
 * ones stays exactly where it is.
 */

export type MoveDirection = "up" | "down";

/**
 * Where a mission should trade places with its neighbour.
 *
 * Returns `null` when nothing can move: the id is absent, or it is already at the
 * top (up) or the bottom (down) of the list. A caller must treat `null` as "no
 * change", never as an error to shout about.
 */
export function reorderTargets(
  ids: readonly string[],
  id: string,
  direction: MoveDirection,
): { currentIndex: number; targetIndex: number } | null {
  const currentIndex = ids.indexOf(id);
  if (currentIndex < 0) return null;
  const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
  if (targetIndex < 0 || targetIndex >= ids.length) return null;
  return { currentIndex, targetIndex };
}

/**
 * The order with two entries exchanged. Missing or identical ids return the order
 * unchanged, so a stale form can never reorder anything by accident.
 */
export function moveInOrder(order: readonly string[], currentId: string, targetId: string): string[] {
  const next = [...order];
  const from = next.indexOf(currentId);
  const to = next.indexOf(targetId);
  if (from < 0 || to < 0 || from === to) return next;
  next[from] = targetId;
  next[to] = currentId;
  return next;
}
