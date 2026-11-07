// Persistent maps and lists: a change answers a new value and leaves the old
// one as it was. A scan threads the store and each file's parser state
// through a fold over the lines, so nothing is changed in place; a plain
// copy per line would make that quadratic, so these share what did not
// change instead. A change copies only the path to one key in a hash trie
// of 32-way nodes (at most seven, five for any real store), and a map
// opened over a stored object or Map keeps reading it as its base: only
// what changed is held in the trie, and the whole is made into a plain
// object once, at the end.
//
// Keys keep the order a plain object gives them: a key already there keeps
// its place when its value changes, a new key goes after all the others,
// and a key removed and added again goes to the end.

const BITS = 5;
const MASK = 31;
const LEAF = 0;
const BRANCH = 1;
const COLLISION = 2;

// The number of bits set in a 32-bit word.
function popcount(word) {
  const pairs = word - ((word >>> 1) & 0x55555555);
  const nibbles = (pairs & 0x33333333) + ((pairs >>> 2) & 0x33333333);
  return Math.imul((nibbles + (nibbles >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24;
}

const step = (hash, code) => Math.imul(hash ^ code, 16777619);

// FNV-1a over the UTF-16 units from `at` to `end`, four to a call: the
// recursion stays shallow and runs ten times faster than a reduce.
function hashRange(key, at, end, hash) {
  if (at + 4 <= end) {
    return hashRange(key, at + 4, end, step(step(step(step(hash, key.charCodeAt(at)), key.charCodeAt(at + 1)), key.charCodeAt(at + 2)), key.charCodeAt(at + 3)));
  }
  return at < end ? hashRange(key, at + 1, end, step(hash, key.charCodeAt(at))) : hash;
}

// Numbers (list indexes, file ids) are their own hash, which keeps a list's
// trie dense. A very long key is hashed by its two ends and its length; a
// collision only costs a compare.
function hashOf(key) {
  if (typeof key === "number") return key | 0;
  if (key.length <= 4096) return hashRange(key, 0, key.length, 0x811c9dc5);
  return step(hashRange(key, key.length - 2048, key.length, hashRange(key, 0, 2048, 0x811c9dc5)), key.length);
}

// A leaf is one key. `fresh` marks a key added after the base was read (it
// goes after the base keys, in `seq` order); `gone` marks a base key taken
// out.
function leaf(key, value, hash, seq, fresh, gone) {
  return { t: LEAF, k: key, v: value, h: hash, s: seq, f: fresh, g: gone };
}

function lookup(node, hash, key, shift) {
  if (node === null) return null;
  if (node.t === LEAF) return node.k === key ? node : null;
  if (node.t === COLLISION) return node.h === hash ? (node.leaves.find((one) => one.k === key) ?? null) : null;
  const bit = 1 << ((hash >>> shift) & MASK);
  if ((node.bitmap & bit) === 0) return null;
  return lookup(node.nodes[popcount(node.bitmap & (bit - 1))], hash, key, shift + BITS);
}

// Two nodes whose hashes differ, under the branch they share from `shift`.
function join(a, b, shift) {
  const ia = (a.h >>> shift) & MASK;
  const ib = (b.h >>> shift) & MASK;
  if (ia === ib) return { t: BRANCH, bitmap: 1 << ia, nodes: [join(a, b, shift + BITS)] };
  return { t: BRANCH, bitmap: (1 << ia) | (1 << ib), nodes: ia < ib ? [a, b] : [b, a] };
}

function insert(node, one, shift) {
  if (node === null) return one;
  if (node.t === LEAF) {
    if (node.k === one.k) return one;
    if (node.h === one.h) return { t: COLLISION, h: one.h, leaves: [node, one] };
    return join(node, one, shift);
  }
  if (node.t === COLLISION) {
    if (node.h !== one.h) return join(node, one, shift);
    const at = node.leaves.findIndex((other) => other.k === one.k);
    return { t: COLLISION, h: node.h, leaves: at < 0 ? [...node.leaves, one] : node.leaves.with(at, one) };
  }
  const bit = 1 << ((one.h >>> shift) & MASK);
  const at = popcount(node.bitmap & (bit - 1));
  if ((node.bitmap & bit) === 0) {
    return { t: BRANCH, bitmap: node.bitmap | bit, nodes: node.nodes.toSpliced(at, 0, one) };
  }
  return { t: BRANCH, bitmap: node.bitmap, nodes: node.nodes.with(at, insert(node.nodes[at], one, shift + BITS)) };
}

// A branch left with one leaf (or one collision) is replaced by it: a leaf
// is found by its key at any depth.
function remove(node, hash, key, shift) {
  if (node === null) return null;
  if (node.t === LEAF) return node.k === key ? null : node;
  if (node.t === COLLISION) {
    if (node.h !== hash) return node;
    const leaves = node.leaves.filter((one) => one.k !== key);
    if (leaves.length === node.leaves.length) return node;
    return leaves.length === 1 ? leaves[0] : { t: COLLISION, h: node.h, leaves };
  }
  const bit = 1 << ((hash >>> shift) & MASK);
  if ((node.bitmap & bit) === 0) return node;
  const at = popcount(node.bitmap & (bit - 1));
  const child = remove(node.nodes[at], hash, key, shift + BITS);
  if (child === node.nodes[at]) return node;
  const nodes = child === null ? node.nodes.toSpliced(at, 1) : node.nodes.with(at, child);
  if (nodes.length === 0) return null;
  if (nodes.length === 1 && nodes[0].t !== BRANCH) return nodes[0];
  return { t: BRANCH, bitmap: child === null ? node.bitmap & ~bit : node.bitmap, nodes };
}

function leavesOf(node) {
  if (node === null) return [];
  if (node.t === LEAF) return [node];
  if (node.t === COLLISION) return node.leaves;
  return node.nodes.flatMap(leavesOf);
}

// The base is read, never changed: a plain object, a Map, or nothing.
function baseHas(base, key) {
  if (base === null) return false;
  return base instanceof Map ? base.has(key) : Object.hasOwn(base, key);
}

function baseGet(base, key) {
  if (base === null) return undefined;
  return base instanceof Map ? base.get(key) : (Object.hasOwn(base, key) ? base[key] : undefined);
}

// A key a plain object lists before the others: an array index.
function isIndex(key) {
  return typeof key === "string" && /^(?:0|[1-9]\d*)$/.test(key) && Number(key) < 4294967295;
}

function baseEntries(base) {
  if (base === null) return [];
  return base instanceof Map ? [...base] : Object.entries(base);
}

export class PMap {
  constructor(base, root, seq) {
    this.base = base;
    this.root = root;
    this.seq = seq;
  }

  // A map that reads `base` (an object or a Map) until a key changes.
  static over(base = null) {
    return new PMap(base, null, 0);
  }

  // Whether anything changed since the base.
  get changed() {
    return this.root !== null;
  }

  get(key) {
    const one = lookup(this.root, hashOf(key), key, 0);
    if (one) return one.g ? undefined : one.v;
    return baseGet(this.base, key);
  }

  has(key) {
    const one = lookup(this.root, hashOf(key), key, 0);
    return one ? !one.g : baseHas(this.base, key);
  }

  // The map with `key` set to `value`.
  with(key, value) {
    const hash = hashOf(key);
    const one = lookup(this.root, hash, key, 0);
    const live = one ? !one.g : baseHas(this.base, key);
    if (live && (one ? one.v : baseGet(this.base, key)) === value) return this;
    const fresh = live ? Boolean(one?.f) : true;
    const seq = live ? (one?.s ?? 0) : this.seq;
    return new PMap(this.base, insert(this.root, leaf(key, value, hash, seq, fresh, false), 0), live ? this.seq : this.seq + 1);
  }

  // The map without `key`.
  without(key) {
    const hash = hashOf(key);
    const one = lookup(this.root, hash, key, 0);
    if (one ? one.g : !baseHas(this.base, key)) return this;
    const root = baseHas(this.base, key)
      ? insert(this.root, leaf(key, undefined, hash, 0, false, true), 0)
      : remove(this.root, hash, key, 0);
    return new PMap(this.base, root, this.seq);
  }

  // Every [key, value], in the base's order: a plain object's (array-index
  // keys first, in numeric order) unless the base is a Map.
  entries() {
    if (this.root === null) return baseEntries(this.base);
    const kept = baseEntries(this.base).flatMap(([key, value]) => {
      const one = lookup(this.root, hashOf(key), key, 0);
      if (!one) return [[key, value]];
      return one.g || one.f ? [] : [[key, one.v]];
    });
    const added = leavesOf(this.root)
      .filter((one) => one.f && !one.g)
      .toSorted((a, b) => a.s - b.s)
      .map((one) => [one.k, one.v]);
    const all = kept.concat(added);
    if (this.base instanceof Map || !added.some(([key]) => isIndex(key))) return all;
    return [
      ...all.filter(([key]) => isIndex(key)).toSorted((a, b) => Number(a[0]) - Number(b[0])),
      ...all.filter(([key]) => !isIndex(key)),
    ];
  }

  // The map as a plain object; the base itself when nothing changed.
  toObject() {
    if (this.root === null && this.base !== null && !(this.base instanceof Map)) return this.base;
    return Object.fromEntries(this.entries());
  }
}

// A list over a stored array: `at` reads it, `with` and `plus` answer a new
// list, `less` drops the last item.
export class PList {
  constructor(base, over, length) {
    this.base = base;
    this.over = over;
    this.length = length;
  }

  static of(array) {
    return new PList(array, PMap.over(), array.length);
  }

  at(index) {
    if (index < 0 || index >= this.length) return undefined;
    return this.over.get(index) ?? this.base[index];
  }

  // `index` up to the length: at the length it adds one.
  with(index, value) {
    return new PList(this.base, this.over.with(index, value), Math.max(this.length, index + 1));
  }

  plus(value) {
    return this.with(this.length, value);
  }

  less() {
    return new PList(this.base, this.over, Math.max(0, this.length - 1));
  }

  toArray() {
    if (!this.over.changed && this.length === this.base.length) return this.base;
    return Array.from({ length: this.length }, (_, index) => this.at(index));
  }
}
