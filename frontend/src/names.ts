// How a name is written when it is shown to someone.
//
// The datasets store vernacular names in lower case — "blue whale", "african
// wild dog", "lynx" — because that is how Wikidata labels them, and a scraped
// dataset should record what the source says. Taxon names arrive already
// capitalised ("Felidae", "Lynx"), so this leaves them exactly as they are.
//
// **Display only, and that is load-bearing.** The API matches a guess exactly:
// `/game/state` answers "Unknown animal: 'Lion'" for a name it holds as "lion".
// Autocomplete happens to be case-insensitive, so a capitalised name reaches the
// list and then fails at the guess — which is a worse bug than never showing it
// capitalised at all. So the raw name stays the value everywhere it is a key: in
// `data-node`, in what is submitted, in the win comparison, in the taxon cache.
// This is applied at the last moment, where the text is drawn.
//
// Sentence case rather than title case: the zoological convention is "blue
// whale", not "Blue Whale", and `text-transform: capitalize` would give the
// second — as well as mangling "lions mane jellyfish" into something worse.
export function displayName(name: string): string {
  if (!name) return name
  return name[0].toUpperCase() + name.slice(1)
}

// The Wikipedia article a popup's text came from, when it is not obviously the
// node's own: `null` when the title is the taxon name or the common name.
//
// About 15% of popups on the Full dataset are some other page. Many are
// harmless (Cervidae is "Deer"), but an obsolete genus that redirects to its
// one species, or a species filed under an old name, reads as if the popup had
// the wrong animal: "Lissonycteris" opening with "The Angolan fruit bat
// (Myonycteris angolensis) is a species…". Naming the article says where the
// text is from without claiming anything about why.
//
// Compared on letters and digits alone, ignoring case and the " (Binomial)" /
// " #2" the extractor adds, so "Rothschild's rock-wallaby" is the same name as
// "Rothschild’s Rock Wallaby".
export function otherArticle(name: string, commonName: string | null | undefined,
                             title: string | null | undefined): string | null {
  if (!title) return null
  const norm = (s: string) =>
    s.toLowerCase().replace(/ \(.*\)$| #\d+$/, '').replace(/[^a-z0-9]/g, '')
  const t = norm(title.replace(/_/g, ' '))
  if (t === norm(name) || (commonName && t === norm(commonName))) return null
  return title.replace(/_/g, ' ')
}
