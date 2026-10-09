#!/usr/bin/env python3
"""
Confirm audit leads against live Wikidata, and remember them.

`audit_dataset.py` reads our own copy of the data and guesses. This asks live
Wikidata whether each guess still holds, gathers the evidence a reviewer would
want, and records the result in `datagen/upstream_leads.json`, the ledger that
outlives any one run. It never edits Wikidata: every edit is made by a person,
by hand, one at a time. See `datagen/UPSTREAM.md` for why we go slowly.

The ledger is keyed `<kind>:<qid>` and each lead carries a status:

    confirmed   the error holds on live Wikidata; the item itself proves the fix
    review      it holds, but the evidence is an outside authority's word, so a
                person must check before anything is touched
    edited      a person has made the fix (set with --mark)
    dismissed   a person judged it not an error (set with --mark); never re-raised
    resolved    no longer reproduces on Wikidata — fixed by us or by anyone

A run refreshes the evidence on every open lead, adds new ones, and moves a lead
that no longer reproduces to `resolved`, with the date. Human statuses and notes
are never overwritten. `scraper.py --refresh-ledger` then refetches the items
whose leads were edited or resolved, so a fix made upstream reaches the game.

Kinds of lead, each a single-statement fix the item itself proves:

* **binomial-on-higher-taxon**: a genus or broader whose taxon name (P225) is a
  binomial — Hippocamelus (Q386536) was renamed "Hippocamelus bisilcus". The
  right value must come from the item: its label or article title, or every
  species filed under it.
* **genus-unlike-its-species**: a genus whose taxon name differs from the word
  every species under it starts with, while its own label or enwiki title is
  that word — Sepia (Q286026) was renamed "Sapia" in May 2026, over 34
  cuttlefish. A new genus whose species still carry old binomials is labelled
  with its new name, so it never qualifies.
* **bad-species-name**: a species whose P225 is not a binomial at all —
  Oreochromis lidole (Q1956228) is "something about fish", the emperor newt's
  has a non-breaking space in it. The right value must again be on the item,
  as its label or enwiki title, or be the same name with plain spaces.

And one kind at `review` strength:

* **disputed-synonym-link**: Wikidata says species A's synonym (or original
  combination, basionym) is species B, both in our tree, and the group's
  authority via the Catalogue of Life holds A and B as distinct species. Most
  are wrong links — a vesper mouse claiming a woodrat as its original
  combination — but the authority can be the one that is behind, so these
  are for checking, not for fixing on sight. Read from the build's
  `synonym-report.json` (see `scraper.drop_synonyms`).

And one *pattern*, recorded as a summary rather than as leads, because the fix
is a conversation and not an edit:

* **group-noun-common-name**: a bare group word as a species' English common
  name (P1843) — Etheridgeum pulchrum is "Snake". Measured Oct 2026: of 271,
  180 cite the IUCN Red List and 62 ARKive, both bulk imports. The ledger keeps
  the count per source, so the conversation can start from numbers.

Usage:
    python3 datagen/upstream_check.py --dataset wikidata-parents-fixed
    python3 datagen/upstream_check.py --mark binomial-on-higher-taxon:Q386536 edited \\
        --note "https://www.wikidata.org/w/index.php?diff=..."
"""
from __future__ import annotations

import argparse
import collections
import datetime
import json
import re
import sys
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from audit_dataset import SPECIES_NAME, audit, shown        # noqa: E402
from taxoquiz.game.tree import load_tree                                 # noqa: E402
from taxoquiz.jsonio import write_json_atomic                            # noqa: E402
from taxoquiz.paths import cache_dir, taxon_info_read_path, tree_path    # noqa: E402

API = "https://www.wikidata.org/w/api.php"
HEADERS = {"User-Agent": "TaxoQuiz-audit/0.1 (https://github.com/markharley12/TaxoQuiz)"}
BATCH = 50
SPECIES_RANK = "Q7432"
LEDGER = Path(__file__).resolve().parent / "upstream_leads.json"
HUMAN = {"edited", "dismissed"}
BINOMIAL = re.compile(r"[A-Z][a-z]+ [a-z]+")


@dataclass
class Lead:
    kind: str
    qid: str
    subject: str
    edit: str
    evidence: list[str]
    status: str = "confirmed"
    first_seen: str = ""
    last_checked: str = ""
    resolved: str = ""
    note: str = ""
    extra: dict = field(default_factory=dict)

    @property
    def key(self) -> str:
        # One item can make several disputed links, so those carry their target.
        target = self.extra.get("target")
        return f"{self.kind}:{self.qid}" + (f">{target}" if target else "")


# --------------------------------------------------------------------------
# Wikidata
# --------------------------------------------------------------------------

def _get(params: dict, retries: int = 4) -> dict:
    """One API call, retried with backoff on timeouts and 5xx; raises when spent."""
    for attempt in range(retries):
        try:
            r = requests.get(API, headers=HEADERS, timeout=60, params={**params, "format": "json"})
            if r.status_code < 500:
                break
        except (requests.ConnectionError, requests.Timeout):
            if attempt == retries - 1:
                raise
        time.sleep(5 * 2 ** attempt)
    r.raise_for_status()
    body = r.json()
    # An error answers 200 with no entities; read as empty, it would say
    # "no errors found" — the silent empty result this repo keeps meeting.
    if "error" in body:
        raise RuntimeError(f"Wikidata API error: {body['error'].get('info')}")
    return body


def fetch_entities(qids: list[str]) -> dict[str, dict]:
    """Labels, claims and enwiki sitelinks, 50 per request, politely."""
    out: dict[str, dict] = {}
    for i in range(0, len(qids), BATCH):
        body = _get({"action": "wbgetentities", "ids": "|".join(qids[i:i + BATCH]),
                     "props": "labels|claims|sitelinks", "languages": "en",
                     "sitefilter": "enwiki"})
        out.update(body["entities"])
        time.sleep(0.5)
    return out


def statements(entity: dict, prop: str) -> list[dict]:
    return [s for s in entity.get("claims", {}).get(prop, []) if s.get("rank") != "deprecated"]


def value(statement: dict):
    return statement["mainsnak"].get("datavalue", {}).get("value")


def label(entity: dict) -> str:
    return entity.get("labels", {}).get("en", {}).get("value", "")


def enwiki(entity: dict) -> str:
    return entity.get("sitelinks", {}).get("enwiki", {}).get("title", "")


def name_history(qid: str) -> str | None:
    """Who set the current taxon name, and what stood before it.

    Edit summaries carry the new value ("[[Property:P225]]: Six seven"), so the
    history alone says whether a bad name is long-standing or a recent change —
    and a recent change by a temporary account is a revert, which is the
    safest edit there is.
    """
    body = _get({"action": "query", "prop": "revisions", "titles": qid, "rvlimit": 500,
                 "rvprop": "timestamp|user|comment"})
    revs = next(iter(body["query"]["pages"].values())).get("revisions", [])
    sets = []
    for v in revs:     # newest first
        m = re.search(r"\[\[Property:P225\]\][:,] (.+)$", v.get("comment", ""))
        if m and "wbremoveclaims" not in v["comment"]:
            sets.append((v["timestamp"][:10], v["user"], m[1].strip()))
    if not sets:
        return None
    when, who, now = sets[0]
    # Skip everything the same account did: a vandal often edits twice in a row
    # ("Six seven", then "Hippocamelus bisilcus"), and the value worth restoring
    # is the one that stood before they arrived.
    before = next(((t, val) for t, u, val in sets[1:] if u != who and val != now), None)
    if not before:
        return f"Set to “{shown(now)}” by {who} on {when}; no earlier value in the history."
    oldest = min(t for t, _, val in sets if val == before[1])
    return (f"Set to “{shown(now)}” by {who} on {when}. Before that it was “{before[1]}”, "
            f"stable from {oldest}. If that is right, this edit is a revert.")


def qualifier_summary(stmt: dict) -> str:
    """Author (P405) and year (P574), with authors named, for a reviewer."""
    q = stmt.get("qualifiers", {})
    authors = [s["datavalue"]["value"]["id"] for s in q.get("P405", []) if "datavalue" in s]
    years = [s["datavalue"]["value"]["time"][1:5] for s in q.get("P574", []) if "datavalue" in s]
    names = fetch_entities(authors) if authors else {}
    who = ", ".join(label(names[a]) or a for a in authors if a in names) or "no author"
    return f"{who}, {', '.join(years) or 'no year'}"


# The specialist databases a reviewer should check a lead against, by the
# Wikidata property that holds each one's ID for an item. Their URL patterns
# are read from Wikidata itself (P1630), not written here.
AUTHORITY_IDS = {
    "P5473": "Reptile Database", "P5354": "Amphibian Species of the World",
    "P850": "WoRMS", "P938": "FishBase", "P2026": "Avibase", "P815": "ITIS",
    "P10585": "Catalogue of Life",
}
_formatters: dict[str, str] = {}


def authority_links(entity: dict) -> str | None:
    """"Check: Reptile Database <url>, Catalogue of Life <url>" for an item."""
    if not any(statements(entity, pid) for pid in AUTHORITY_IDS):
        return None
    if not _formatters:
        props = _get({"action": "wbgetentities", "ids": "|".join(AUTHORITY_IDS), "props": "claims"})
        for pid, prop in props["entities"].items():
            urls = [value(s) for s in statements(prop, "P1630") if value(s)]
            if urls:
                _formatters[pid] = urls[0]
    links = []
    for pid, name in AUTHORITY_IDS.items():
        for s in statements(entity, pid)[:1]:
            if (v := value(s)) and pid in _formatters:
                links.append(f"{name} {_formatters[pid].replace('$1', str(v))}")
    return ("Check against: " + "; ".join(links) + ".") if links else None


def plain_spaces(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


# --------------------------------------------------------------------------
# Kinds of lead
# --------------------------------------------------------------------------

def check_binomial_names(entity: dict, children: list[str]) -> Lead | None:
    ranks = [value(s)["id"] for s in statements(entity, "P105") if value(s)]
    if not ranks or SPECIES_RANK in ranks:
        return None
    names = [value(s) for s in statements(entity, "P225") if value(s)]
    bad = [n for n in names if BINOMIAL.fullmatch(plain_spaces(n))]
    if len(names) != 1 or not bad:
        return None
    stmt = statements(entity, "P225")[0]
    genus = plain_spaces(bad[0]).split()[0]
    # The right value must come from Wikidata itself, not from us: the item's
    # own label or article title, or every species filed under it.
    named = [w for w in (label(entity), enwiki(entity)) if w == genus]
    children = [re.sub(r" \(.*\)$", "", c) for c in children]   # our disambiguation
    binomials = [c for c in children if BINOMIAL.fullmatch(c)]
    agree = binomials and len(binomials) == len(children) \
        and all(c.split()[0] == genus for c in binomials)
    if not named and not agree:
        return None
    return Lead(
        "binomial-on-higher-taxon", entity["id"], label(entity) or genus,
        f"Change taxon name (P225) from “{shown(bad[0])}” to “{genus}”, keeping its qualifiers.",
        [f"The item's rank is not species (P105 = {', '.join(ranks)}).",
         f"Its taxon name is the binomial “{shown(bad[0])}”.",
         f"Its English label is “{label(entity)}” and its enwiki article is "
         f"“{enwiki(entity) or 'none'}”."
         + (f" Both name the genus “{genus}”." if len(named) == 2 else ""),
         *([f"All {len(children)} species under it are “{genus} …”: "
            + ", ".join(children[:4])] if agree else []),
         f"Qualifiers to check are the genus's, not the species': "
         + qualifier_summary(stmt) + ".",
         *([h] if (h := name_history(entity["id"])) else []),
         *([x] if (x := authority_links(entity)) else []),
         f"Statement has {len(stmt.get('references', []))} reference(s); open them. "
         f"History: https://www.wikidata.org/w/index.php?title={entity['id']}&action=history"])


def check_genus_name(entity: dict, children: list[str], word: str) -> Lead | None:
    names = [value(s) for s in statements(entity, "P225") if value(s)]
    if len(names) != 1 or names[0] == word:
        return None
    # The item must name itself `word` somewhere other than P225, or this is a
    # new genus whose species are behind, which is a question for the authority.
    named = [w for w in (label(entity), enwiki(entity))
             if w == word or w.startswith(word + " (")]
    if not named:
        return None
    stmt = statements(entity, "P225")[0]
    return Lead(
        "genus-unlike-its-species", entity["id"], label(entity) or word,
        f"Change taxon name (P225) from “{shown(names[0])}” to “{word}”, keeping its qualifiers.",
        [f"Its taxon name is “{shown(names[0])}”.",
         f"Its English label is “{label(entity)}” and its enwiki article is "
         f"“{enwiki(entity) or 'none'}”.",
         f"All {len(children)} species under it are “{word} …”: " + ", ".join(children[:4]),
         f"Qualifiers: {qualifier_summary(stmt)}.",
         *([h] if (h := name_history(entity["id"])) else []),
         *([x] if (x := authority_links(entity)) else []),
         f"Statement has {len(stmt.get('references', []))} reference(s); open them. "
         f"History: https://www.wikidata.org/w/index.php?title={entity['id']}&action=history"],
        extra={"named": word, "children": children})


def check_species_name(entity: dict) -> Lead | None:
    names = [value(s) for s in statements(entity, "P225") if value(s)]
    if len(names) != 1 or SPECIES_NAME.fullmatch(names[0]):
        return None
    bad = names[0]
    stmt = statements(entity, "P225")[0]
    if SPECIES_NAME.fullmatch(plain_spaces(bad)):
        right, why = plain_spaces(bad), (
            "The name is a valid binomial apart from its whitespace, which is not a "
            "plain space; it looks identical on screen and is a different string.")
    else:
        witnesses = [w for w in (label(entity), enwiki(entity)) if SPECIES_NAME.fullmatch(w)]
        if not witnesses or len(set(witnesses)) != 1:
            return None
        right, why = witnesses[0], (
            f"Its English label is “{label(entity)}” and its enwiki article is "
            f"“{enwiki(entity) or 'none'}”, which give the binomial.")
    return Lead(
        "bad-species-name", entity["id"], label(entity) or right,
        f"Change taxon name (P225) from “{shown(bad)}” to “{right}”, keeping its qualifiers.",
        [f"The species' taxon name “{shown(bad)}” is not a binomial.", why,
         *([h] if (h := name_history(entity["id"])) else []),
         *([x] if (x := authority_links(entity)) else []),
         f"Qualifiers: {qualifier_summary(stmt)}. "
         f"History: https://www.wikidata.org/w/index.php?title={entity['id']}&action=history"])


PROP_NAMES = {"P1420": "taxon synonym", "P1403": "original combination",
              "P566": "basionym", "P694": "replaced synonym"}


def check_synonym_link(entity: dict, row: dict) -> Lead | None:
    """A synonym link the authority disputes, if Wikidata still makes it."""
    prop, target = row["property"], row["links"]
    if not any((value(s) or {}).get("id") == target for s in statements(entity, prop)):
        return None
    a, b = row["a"], row["b"]
    return Lead(
        "disputed-synonym-link", entity["id"], f"{row['name']} → {row['linked_name']}",
        f"Check whether {PROP_NAMES.get(prop, prop)} ({prop}) → {target} "
        f"({row['linked_name']}) is right; if not, remove it or point it at the correct item.",
        [f"{row['name']} ({entity['id']}) lists {row['linked_name']} ({target}) as its "
         f"{PROP_NAMES.get(prop, prop)}.",
         f"The Catalogue of Life, from {row['authority'] or 'an unnamed source'}, holds both "
         f"as accepted, distinct species: {a.get('accepted')} and {b.get('accepted')}.",
         "Usually the link should point at an item for the old name that does not yet "
         "exist, or the epithets merely match. The authority can lag, so check a current "
         "source for the group before editing.",
         *([x] if (x := authority_links(entity)) else [])],
        status="review", extra={"target": target})


def group_noun_candidates(species_cache: dict, in_tree: set[str]) -> dict[str, set[str]]:
    """Species in the tree holding a bare group word among their English names.

    Read from what Wikidata holds, not from what we display: the game now
    avoids showing most of these, and the pattern must not shrink because our
    own fix hid the evidence.
    """
    import scraper
    pool = {q: s for q, s in species_cache.items() if q in in_tree}
    words = scraper.group_words(species_cache)
    out: dict[str, set[str]] = {}
    for q, s in pool.items():
        bare = {n for n in s.get("common_names") or [s["common_name"]]
                if scraper._bare(n) and scraper._head(n) in words
                and n.lower() != (s.get("label") or "").lower()}
        if bare:
            out[q] = bare
    return out


def group_noun_pattern(entities: dict[str, dict], candidates: dict[str, set[str]]) -> dict:
    """How many bare group words each source is responsible for."""
    by_source: collections.Counter = collections.Counter()
    examples: dict[str, list[str]] = collections.defaultdict(list)
    sources: set[str] = set()
    rows = []
    for qid, words in candidates.items():
        for s in statements(entities.get(qid, {}), "P1843"):
            v = value(s)
            if not v or v.get("language") != "en" or v.get("text") not in words:
                continue
            bare = v["text"]
            src = sorted({x["datavalue"]["value"]["id"] for r in s.get("references", [])
                          for x in r["snaks"].get("P248", []) if "datavalue" in x})
            sources.update(src)
            rows.append((qid, bare, src))
    names = fetch_entities(sorted(sources)) if sources else {}
    for qid, bare, src in rows:
        key = " + ".join(label(names.get(s, {})) or s for s in src) or "unsourced"
        by_source[key] += 1
        if len(examples[key]) < 8:
            examples[key].append(f"{bare} ({qid})")
    return {"by_source": dict(by_source.most_common()), "examples": dict(examples)}


# --------------------------------------------------------------------------
# Ledger
# --------------------------------------------------------------------------

def load_ledger(path: Path = LEDGER) -> dict:
    if path.exists():
        return json.loads(path.read_text())
    return {"leads": {}, "patterns": {}}


def merge(ledger: dict, found: list[Lead], checked: set[str], today: str) -> dict[str, int]:
    """Fold one run's results into the ledger; return counts of what changed.

    `checked` is every Q-ID this run asked Wikidata about, so a lead absent
    from `found` is resolved only if its item was actually re-checked — a lead
    the audit no longer raises (say, because our own data changed) stays as it
    was rather than being declared fixed.
    """
    leads = ledger["leads"]
    counts = collections.Counter()
    found_keys = {lead.key for lead in found}
    for lead in found:
        old = leads.get(lead.key)
        if old is None:
            lead.first_seen = lead.last_checked = today
            leads[lead.key] = asdict(lead)
            counts["new"] += 1
            continue
        old.update(edit=lead.edit, evidence=lead.evidence, subject=lead.subject,
                   last_checked=today)
        if old["status"] == "resolved":
            old.update(status=lead.status, resolved="")    # it came back
            counts["reopened"] += 1
    for key, old in leads.items():
        if key in found_keys or old["qid"] not in checked or old["status"] == "resolved":
            continue
        if old["status"] == "dismissed":
            continue
        old.update(status="resolved", resolved=today, last_checked=today)
        counts["resolved"] += 1
    return dict(counts)


def render(ledger: dict) -> str:
    leads = ledger["leads"].values()
    lines = ["# Upstream leads", "",
             "Open leads, strongest kind first. Before an edit, open the item, read its "
             "history and references, and confirm the evidence yourself. Then "
             "`upstream_check.py --mark <key> edited --note <diff link>`.", ""]
    for status in ("confirmed", "review", "edited", "resolved"):
        group = [lead for lead in leads if lead["status"] == status]
        if not group:
            continue
        lines += [f"## {status} ({len(group)})", ""]
        for lead in sorted(group, key=lambda x: (x["kind"], x["qid"])):
            lines += [f"### {lead['subject']} — [{lead['qid']}](https://www.wikidata.org/wiki/{lead['qid']})",
                      f"`{lead['kind']}:{lead['qid']}` · first seen {lead['first_seen']}"
                      + (f" · resolved {lead['resolved']}" if lead["resolved"] else ""),
                      "", f"**Edit:** {lead['edit']}", ""]
            lines += [f"- {e}" for e in lead["evidence"]]
            if lead["note"]:
                lines += [f"- Note: {lead['note']}"]
            lines += [""]
    for name, pattern in ledger.get("patterns", {}).items():
        lines += [f"## Pattern: {name}", "", f"Last counted {pattern.get('counted', '?')}.", ""]
        for src, n in pattern["by_source"].items():
            lines += [f"- {n} from {src}: " + ", ".join(pattern["examples"].get(src, []))]
        lines += [""]
    return "\n".join(lines)


# --------------------------------------------------------------------------

def run(dataset: str | None, today: str) -> tuple[dict, dict]:
    tree = load_tree(tree_path(dataset) if dataset else tree_path())
    info_path = taxon_info_read_path(dataset)
    info = json.loads(info_path.read_text()) if info_path and info_path.exists() else {}
    cache = cache_dir() / "wikidata-species.json"
    species_cache = json.loads(cache.read_text()) if cache.exists() else None
    findings = audit(tree, info, species_cache)

    ledger = load_ledger()
    children = {f.qid: f.extra.get("children", []) for f in findings
                if f.check == "odd-taxon-name" and f.qid}
    unlike = {f.qid: f.extra for f in findings if f.check == "genus-unlike-its-species" and f.qid}
    # An open lead is re-asked with what it was raised on, since a rebuild that
    # picked up the fix no longer raises it from our data.
    for lead in ledger["leads"].values():
        if lead["kind"] == "genus-unlike-its-species" and lead["status"] != "dismissed":
            unlike.setdefault(lead["qid"], lead["extra"])
    species = sorted({f.qid for f in findings if f.check == "odd-species-name" and f.qid})
    in_tree = {n["qid"] for n in _leaves(tree) if n.get("qid")}
    generic = group_noun_candidates(species_cache or {}, in_tree)
    # Every open lead is re-checked too, even if our data no longer raises it,
    # so a fix made upstream is noticed whether or not we have rebuilt since.
    reopen = {lead["qid"] for lead in ledger["leads"].values() if lead["status"] != "dismissed"}
    asked = sorted(set(children) | set(unlike) | set(species) | set(generic) | reopen)
    print(f"checking {len(asked)} items against live Wikidata…", file=sys.stderr)
    entities = fetch_entities(asked)

    found: list[Lead] = []
    for q in sorted(set(children) | reopen):
        e = entities.get(q)
        if e and (lead := check_binomial_names(e, children.get(q, []))):
            found.append(lead)
    for q, extra in sorted(unlike.items()):
        e = entities.get(q)
        if e and (lead := check_genus_name(e, extra["children"], extra["named"])):
            found.append(lead)
    for q in sorted(set(species) | reopen):
        e = entities.get(q)
        if e and (lead := check_species_name(e)):
            found.append(lead)
    report_path = cache_dir() / "synonym-report.json"
    # The build sees all life; only the game's own species are our business.
    disputed = [r for r in json.loads(report_path.read_text())
                if r["verdict"] == "distinct" and r["qid"] in in_tree] if report_path.exists() else []
    if disputed:
        extra = fetch_entities(sorted({r["qid"] for r in disputed} - set(entities)))
        entities.update(extra)
    for row in disputed:
        e = entities.get(row["qid"])
        if e and (lead := check_synonym_link(e, row)):
            found.append(lead)
    dismissed = {k for k, v in ledger["leads"].items() if v["status"] == "dismissed"}
    found = [lead for lead in found if lead.key not in dismissed]

    counts = merge(ledger, found, set(entities), today)
    ledger.setdefault("patterns", {})["group-noun-common-name"] = {
        **group_noun_pattern(entities, generic), "counted": today}
    return ledger, counts


def _leaves(node: dict):
    kids = node.get("children") or []
    if not kids:
        yield node
    for k in kids:
        yield from _leaves(k)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dataset")
    ap.add_argument("--mark", nargs=2, metavar=("KEY", "STATUS"),
                    help="record a human decision: STATUS is edited or dismissed")
    ap.add_argument("--note", default="", help="with --mark: a diff link or a reason")
    ap.add_argument("--out", type=Path, help="also write the ledger as Markdown here")
    args = ap.parse_args()
    today = datetime.date.today().isoformat()

    if args.mark:
        key, status = args.mark
        if status not in HUMAN:
            raise SystemExit(f"status must be one of {sorted(HUMAN)}")
        ledger = load_ledger()
        if key not in ledger["leads"]:
            raise SystemExit(f"no lead {key!r}; keys look like binomial-on-higher-taxon:Q386536")
        ledger["leads"][key].update(status=status, note=args.note or ledger["leads"][key]["note"],
                                    last_checked=today)
        write_json_atomic(LEDGER, ledger)
        print(f"{key}: {status}")
        return

    ledger, counts = run(args.dataset, today)
    write_json_atomic(LEDGER, ledger)
    text = render(ledger)
    print(text)
    print(f"\nledger: {LEDGER}  " + ", ".join(f"{v} {k}" for k, v in counts.items()), file=sys.stderr)
    if args.out:
        args.out.write_text(text)


if __name__ == "__main__":
    main()
