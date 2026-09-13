/**
 * The tree as a dataset stores it, and the handful of walks every other engine
 * module shares. Port of `taxoquiz/game/tree.py`.
 *
 * Lookups keyed by a taxon name are `Map`s throughout, never plain objects: a
 * plain object answers `constructor` and `toString` from its prototype, and a
 * rank or name that happens to be one of those would read as present.
 */

/** A node in a dataset's `tree.json`. Leaves are species and carry `common_name`. */
export interface RawNode {
  name: string
  rank?: string
  common_name?: string
  scientific_name?: string
  qid?: string
  children?: RawNode[]
}

/** Python's `node.get("children") or []` — a missing list and an empty one are
 *  the same thing, and both mean a leaf. */
export function childrenOf(node: RawNode): RawNode[] {
  return node.children ?? []
}

export function isLeaf(node: RawNode): boolean {
  return childrenOf(node).length === 0
}

/** Every leaf, in tree order. The order is load-bearing: seeds index into it. */
export function getSpecies(node: RawNode): RawNode[] {
  const out: RawNode[] = []
  const walk = (n: RawNode) => {
    if (isLeaf(n)) out.push(n)
    else childrenOf(n).forEach(walk)
  }
  walk(node)
  return out
}

export function rankOf(tree: RawNode): Map<string, string> {
  const out = new Map<string, string>()
  const walk = (n: RawNode) => {
    out.set(n.name, n.rank ?? '')
    childrenOf(n).forEach(walk)
  }
  walk(tree)
  return out
}

export function commonNameOf(tree: RawNode): Map<string, string> {
  const out = new Map<string, string>()
  const walk = (n: RawNode) => {
    if (n.common_name) out.set(n.name, n.common_name)
    childrenOf(n).forEach(walk)
  }
  walk(tree)
  return out
}

/** Python's `repr()` of a string, so an error reads the same from either engine.
 *  Covers what a taxon name can contain; not a general implementation. */
export function pyRepr(s: string): string {
  const quote = s.includes("'") && !s.includes('"') ? '"' : "'"
  const body = s
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')
    .split(quote).join(`\\${quote}`)
  return `${quote}${body}${quote}`
}

/** Memoise a per-tree index on the tree object itself. Trees are never mutated,
 *  so the object is a sound key, and a WeakMap lets a dropped dataset go. */
export function perTree<T>(build: (tree: RawNode) => T): (tree: RawNode) => T {
  const cache = new WeakMap<RawNode, T>()
  return (tree) => {
    let value = cache.get(tree)
    if (value === undefined) {
      value = build(tree)
      cache.set(tree, value)
    }
    return value
  }
}
