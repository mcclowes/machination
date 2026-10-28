const PRESENCE_INTERVAL_MS = 60_000;

export function presenceDue({ now, lastActivity, active, eligible, foregroundEvent = false }: {
  now: number; lastActivity: number; active: boolean; eligible: boolean; foregroundEvent?: boolean;
}): boolean {
  return active && eligible && (foregroundEvent || now - lastActivity >= PRESENCE_INTERVAL_MS);
}

export function inactivityRemaining(expiresAt: number, serverTime: number): string {
  const minutes = Math.max(0, Math.ceil((expiresAt - serverTime) / 60_000));
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
