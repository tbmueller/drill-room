function countWords(text: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const w of text.toLowerCase().match(/[a-z']+/g) || []) out[w] = (out[w] || 0) + 1;
  return out;
}

function topWords(text: string, k: number): [string, number][] {
  return Object.entries(countWords(text))
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, k);
}
