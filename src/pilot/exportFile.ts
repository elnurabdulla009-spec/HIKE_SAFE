// Export helpers for the pilot screen. Web only; on a phone they return false
// and the screen shows the text so it can be copied by hand.

/** Starts a file download in the browser. Returns false where that is not possible. */
export function downloadText(filename: string, text: string, mime: string): boolean {
  try {
    if (typeof document === 'undefined' || typeof URL === 'undefined' || typeof Blob === 'undefined') return false;
    const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  } catch {
    return false;
  }
}

/** Copies to the clipboard. Returns false if the browser does not allow it. */
export async function copyText(text: string): Promise<boolean> {
  try {
    const clip = (globalThis as { navigator?: { clipboard?: { writeText(t: string): Promise<void> } } }).navigator?.clipboard;
    if (!clip) return false;
    await clip.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function stamp(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}`;
}
