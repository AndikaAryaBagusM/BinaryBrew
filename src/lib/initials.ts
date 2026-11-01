// Avatar letters for staff tiles (Figma "Staff tile" 6:262): the first
// letters of the first two words, or the first two letters of one word.
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters =
    words.length >= 2
      ? words[0]![0]! + words[1]![0]!
      : (words[0] ?? "").slice(0, 2);
  return letters.toLocaleUpperCase("id-ID");
}
