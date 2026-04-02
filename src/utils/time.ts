export const nowIso = (): string => new Date().toISOString();

export const daysFrom = (isoTime: string, days: number): string => {
  const base = new Date(isoTime);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString();
};

export const isPast = (timestamp: string | null, now: string): boolean => {
  if (!timestamp) return false;
  return new Date(timestamp).getTime() < new Date(now).getTime();
};
