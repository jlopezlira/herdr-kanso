const primes = (n) => {
  const found = [];
  for (let k = 2; found.length < n; k++) if (found.every((p) => k % p)) found.push(k);
  return found;
};
const fraction = (x) => ((x - Math.floor(x)) * 2 ** 32) >>> 0;
const PRIMES = primes(64);
const K = PRIMES.map((p) => fraction(Math.cbrt(p)));
const H0 = PRIMES.slice(0, 8).map((p) => fraction(Math.sqrt(p)));
const rotr = (x, n) => (x >>> n) | (x << (32 - n));
const word = (w) => [w >>> 24, (w >>> 16) & 255, (w >>> 8) & 255, w & 255];

const utf8 = (text) => [...String(text)].flatMap((ch) => {
  const point = ch.codePointAt(0);
  const c = point >= 0xd800 && point <= 0xdfff ? 0xfffd : point;
  if (c < 0x80) return [c];
  if (c < 0x800) return [0xc0 | (c >> 6), 0x80 | (c & 63)];
  if (c < 0x10000) return [0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63)];
  return [0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63)];
});

export function sha256(text) {
  const bytes = utf8(text);
  const bits = bytes.length * 8;
  const data = [...bytes, 0x80, ...new Array((((55 - bytes.length) % 64) + 64) % 64).fill(0), ...word(Math.floor(bits / 2 ** 32)), ...word(bits >>> 0)];
  const h = [...H0];
  for (let at = 0; at < data.length; at += 64) {
    const w = [];
    for (let i = 0; i < 64; i++) {
      if (i < 16) w[i] = ((data[at + 4 * i] << 24) | (data[at + 4 * i + 1] << 16) | (data[at + 4 * i + 2] << 8) | data[at + 4 * i + 3]) >>> 0;
      else {
        const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
        const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }
    }
    let [a, b, c, d, e, f, g, k] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = (k + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      [k, g, f, e, d, c, b, a] = [g, f, e, (d + t1) >>> 0, c, b, a, (t1 + t2) >>> 0];
    }
    [a, b, c, d, e, f, g, k].forEach((v, i) => { h[i] = (h[i] + v) >>> 0; });
  }
  return h.map((v) => v.toString(16).padStart(8, "0")).join("");
}
