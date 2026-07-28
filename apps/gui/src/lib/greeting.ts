// Time-of-day salutation for the Overview header. Takes a Date rather than
// reading the clock so it is testable at a fixed hour.
export function greeting(date: Date): string {
  const h = date.getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}
