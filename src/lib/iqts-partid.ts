// Shared Part ID formatter.
// Format: <PartRef>T<ddmmyyyy>_<hhmmss>  (e.g. "PR-12345T05052026_143055")

export function formatPartId(partRef: string, date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const dd = pad(date.getDate());
  const mm = pad(date.getMonth() + 1);
  const yyyy = String(date.getFullYear());
  const hh = pad(date.getHours());
  const mi = pad(date.getMinutes());
  const ss = pad(date.getSeconds());
  return `${partRef}T${dd}${mm}${yyyy}_${hh}${mi}${ss}`;
}
