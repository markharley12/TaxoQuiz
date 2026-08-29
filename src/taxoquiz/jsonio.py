"""Reading and writing the JSON data files, without the chance of losing them.

`open(path, "w")` truncates before writing a single byte, so a crash, a Ctrl-C
or a full disk part-way through leaves a truncated file and no original. That is
not hypothetical here: the taxon-info scrape checkpoints every 50 entries over a
run of an hour or more, so a plain write gives well over a hundred windows in
which existing data can be destroyed.

Writing to a temporary file in the same directory and then `os.replace()`-ing it
over the target is atomic on POSIX: readers see either the old file or the new
one, never a half-written one, and a crash at any point leaves the original
intact.
"""

import json
import os
import tempfile
from pathlib import Path
from typing import Any


def read_json(path: Path | str) -> Any:
    with open(path) as f:
        return json.load(f)


def write_json_atomic(path: Path | str, obj: Any, *, indent: int | None = 2) -> None:
    """Write `obj` to `path` as JSON, atomically.

    The temporary file is created in the destination directory so that
    `os.replace` stays within one filesystem, where it is guaranteed atomic.
    """
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)

    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.", suffix=".tmp")
    try:
        # mkstemp creates 0600. Left alone, every atomically-written file would
        # silently end up more restrictive than the one it replaced, so match
        # what a normal create would have produced under the current umask.
        umask = os.umask(0)
        os.umask(umask)
        os.chmod(tmp, 0o666 & ~umask)

        with os.fdopen(fd, "w") as f:
            json.dump(obj, f, indent=indent, ensure_ascii=False)
            f.flush()
            os.fsync(f.fileno())   # the bytes must be on disk before the rename
        os.replace(tmp, path)
    except BaseException:
        # Leave the original untouched, and don't litter on the way out.
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise
