// A short two-tone chime made with Web Audio, so no sound file is needed
// (Design §8). Browsers allow sound only after the first user interaction;
// callers check that. Never throws: sound is a bonus, the visual state is not.
export function playChime(): void {
  try {
    const context = new AudioContext();
    [880, 1320].forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      const start = context.currentTime + index * 0.18;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.3, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.16);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.17);
    });
    setTimeout(() => void context.close(), 600);
  } catch {
    // No audio support.
  }
}
