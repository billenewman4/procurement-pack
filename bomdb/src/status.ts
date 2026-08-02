export const STATUSES = ['needed', 'researching', 'ordered', 'shipped', 'delivered', 'issue'] as const;
export type Status = (typeof STATUSES)[number];

const FORWARD_ORDER: readonly string[] = ['needed', 'researching', 'ordered', 'shipped', 'delivered'];

/** True only for a strictly-forward move along the lifecycle. `issue` (either
 *  direction) is never forward — it always requires user confirmation. */
export function isForwardMove(from: string, to: string): boolean {
  const a = FORWARD_ORDER.indexOf(from);
  const b = FORWARD_ORDER.indexOf(to);
  return a >= 0 && b >= 0 && b > a;
}

/** Map an order_events.event to the line-item status it implies, or null if
 *  it must never auto-apply (backordered/issue → flag, don't move). */
export function eventToStatus(event: string): Status | null {
  switch (event) {
    case 'confirmed': return 'ordered';
    case 'shipped': return 'shipped';
    case 'delivered': return 'delivered';
    default: return null;
  }
}
