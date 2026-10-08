"""
A second opinion on names, from each group's own taxonomic authority.

Wikidata is a claim like any other, and where it is ambiguous — two items for
one animal, a "synonym" link between two species — it cannot settle the
question itself. The Catalogue of Life (COL) can help: it is assembled from the
authority for each group (the Reptile Database for reptiles, WoRMS for marine
species, ITIS for much else) and says, per name, whether it is accepted or a
synonym of what, and which source said so.

It is a second opinion and not an oracle. Measured Oct 2026 on the 83 synonym
links Wikidata draws between species in the Full dataset: 27 agreed with COL,
32 linked species COL holds distinct (mostly wrong links on Wikidata), and 3
went the other way — where COL's source for birds, ITIS, lags the bird lists.
So nothing here acts on COL alone: the build drops a species only when Wikidata
*and* COL agree, and a disagreement becomes a lead for a person.

Answers are cached in `data/_cache/col-names.json`, keyed by name, because a
name's status changes over years, not between builds. COL's data is CC BY 4.0.

API: ChecklistBank, the latest COL release (`3LR`). No key needed.
"""
from __future__ import annotations

import json
import time
from pathlib import Path

import requests

from taxoquiz.jsonio import write_json_atomic
from taxoquiz.paths import cache_dir

API = "https://api.checklistbank.org"
RELEASE = "3LR"
HEADERS = {"User-Agent": "TaxoQuiz/1.0 (https://github.com/markharley12/TaxoQuiz)"}
DELAY = 0.2
CACHE_NAME = "col-names.json"


def _get(path: str, **params) -> dict:
    """Strict: an unanswered question must not be cached as "unknown name"."""
    for attempt in range(3):
        try:
            r = requests.get(API + path, params=params, headers=HEADERS, timeout=30)
            if r.status_code < 500:
                r.raise_for_status()
                return r.json()
        except requests.ConnectionError:
            pass
        time.sleep(2 ** attempt)
    raise RuntimeError(f"Catalogue of Life did not answer {path} {params}")


class Authority:
    """Name lookups against the Catalogue of Life, cached on disk."""

    def __init__(self, path: Path | None = None) -> None:
        self.path = path or cache_dir() / CACHE_NAME
        self.names: dict[str, dict] = json.loads(self.path.read_text()) if self.path.exists() else {}
        self.sources: dict[str, str] = self.names.pop("__sources__", {})
        self.dirty = False

    def lookup(self, name: str) -> dict:
        """{"status": accepted|synonym|unknown|…, "accepted": name|None, "source": str|None}."""
        if name in self.names:
            return self.names[name]
        usage = _get(f"/dataset/{RELEASE}/match/nameusage", q=name).get("usage") or {}
        time.sleep(DELAY)
        status = usage.get("status") or "unknown"
        if status == "synonym" and usage.get("classification"):
            accepted = usage["classification"][0]["name"]
        elif status == "accepted":
            accepted = usage.get("name")
        else:
            accepted = None
        answer = {"status": status, "accepted": accepted,
                  "source": self._source(usage.get("sectorKey"))}
        self.names[name] = answer
        self.dirty = True
        return answer

    def _source(self, sector) -> str | None:
        if sector is None:
            return None
        key = str(sector)
        if key not in self.sources:
            s = _get(f"/dataset/{RELEASE}/sector/{sector}")
            d = _get(f"/dataset/{s['subjectDatasetKey']}")
            self.sources[key] = d.get("alias") or d.get("title") or key
            time.sleep(DELAY)
        return self.sources[key]

    def save(self) -> None:
        if self.dirty:
            write_json_atomic(self.path, {**self.names, "__sources__": self.sources})
            self.dirty = False
