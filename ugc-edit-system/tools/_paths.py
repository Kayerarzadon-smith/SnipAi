"""Where the tools find things.

The tools used to sit in the same directory as the footage, the learned rules
and the glossary, so `ROOT/../reference/glossary.json` was correct. It is not
any more: the code ships inside SnipAi.app and is read-only, and the library
lives in ~/Movies/SnipAi and belongs to the person.

A tool that resolves a DATA path from its own location keeps working in a
checkout and fails only inside the bundle -- which is the worst way for it to
fail, because every test passes and it breaks on the machine it shipped to.
"""
import os

# where this file is: <code>/tools/_paths.py
CODE_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def data_root():
    """The library. SNIPAI_DATA wins, then the standard location, then the old
    in-repo layout so an un-migrated checkout still works."""
    env = (os.environ.get("SNIPAI_DATA") or "").strip()
    if env:
        return os.path.abspath(env)
    movies = os.path.join(os.path.expanduser("~"), "Movies", "SnipAi")
    if os.path.isdir(os.path.join(movies, "projects")):
        return movies
    return CODE_ROOT


def data_path(*parts):
    """A file under the library, falling back to the copy beside the code.

    The fallback matters for a fresh install: reference/glossary.json ships
    with the app as a starting point, and is copied into the library the first
    time anything writes to it.
    """
    here = os.path.join(data_root(), *parts)
    if os.path.exists(here):
        return here
    beside = os.path.join(CODE_ROOT, *parts)
    return beside if os.path.exists(beside) else here
