/**
 * A taxon's popup text. Port of the API's `/taxon/{name}` route.
 *
 * `rank` and `common_name` come from the tree and are merged in on read, never
 * stored beside the text: a second copy is free to disagree with the tree it
 * describes. See CLAUDE.md, "Taxon info covers species too".
 */
import type { TaxonInfo } from '../api'
import { commonNameOf, perTree, rankOf, type RawNode } from './taxonomy'

/** One entry of a dataset's `taxon_info.json`: everything but what the tree holds. */
export type StoredTaxonInfo = Omit<TaxonInfo, 'rank' | 'common_name'>

const namesOf = perTree((tree) => ({ ranks: rankOf(tree), commons: commonNameOf(tree) }))

export function taxonInfo(
  tree: RawNode, info: Record<string, StoredTaxonInfo>, name: string,
): TaxonInfo | null {
  // Own properties only: `info.constructor` is not a taxon.
  if (!Object.prototype.hasOwnProperty.call(info, name)) return null
  const { ranks, commons } = namesOf(tree)
  return { ...info[name], rank: ranks.get(name) ?? '', common_name: commons.get(name) ?? '' }
}
