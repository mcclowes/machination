const PRESENCE_INTERVAL_MS = 60_000;

export function presenceDue({ now, lastActivity, active, eligible, foregroundEvent = false }: {
  now: number; lastActivity: number; active: boolean; eligible: boolean; foregroundEvent?: boolean;
}): boolean {
  return active && eligible && (foregroundEvent || now - lastActivity >= PRESENCE_INTERVAL_MS);
}
