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
import shutil

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

    READ-ONLY. The fallback matters for a fresh install: reference/glossary.json
    ships with the app as a starting point, and until something writes it the
    only copy is the one beside the code.

    Do not open the result for writing. On a fresh library this returns the
    path INSIDE SnipAi.app, so a writer using it puts the user's learned
    corrections in the bundle: they are lost on the next ./scripts/bundle-app,
    the library never gains the file, and once the app is signed the write
    fails outright. Writers call data_write_path() instead.
    """
    here = os.path.join(data_root(), *parts)
    if os.path.exists(here):
        return here
    beside = os.path.join(CODE_ROOT, *parts)
    return beside if os.path.exists(beside) else here


def data_write_path(*parts):
    """A file under the library, ready to be written.

    Always resolves inside data_root() -- never beside the code. This is the
    copy-on-write data_path()'s docstring used to claim and never performed:
    if the file does not exist in the library yet but ships with the app, the
    shipped copy is seeded into the library first, so the writer edits the
    user's file rather than starting from nothing.
    """
    target = os.path.join(data_root(), *parts)
    os.makedirs(os.path.dirname(target), exist_ok=True)
    if not os.path.exists(target):
        beside = os.path.join(CODE_ROOT, *parts)
        if os.path.exists(beside) and os.path.abspath(beside) != os.path.abspath(target):
            try:
                shutil.copyfile(beside, target)
            except OSError:
                pass                 # a seed we could not copy is not fatal
    return target
