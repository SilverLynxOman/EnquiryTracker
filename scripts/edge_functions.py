#!/usr/bin/env python3
"""Which Supabase Edge Functions to deploy, and how. Used by .github/workflows/functions.yml.

  edge_functions.py list                  every function: the folders of supabase/functions with an index.ts
  edge_functions.py changed BASE [HEAD]   the functions a change from commit BASE to HEAD (default: the work tree) needs
                                          deployed; BASE "" means no earlier deploy, so every function
  edge_functions.py verify-jwt NAME       "true" or "false": verify_jwt of [functions.NAME] in supabase/config.toml

A function needs deploying when a file in its folder changed, when a file it can import from supabase/functions/_shared
changed, or when its [functions.NAME] section of supabase/config.toml changed. Tests (*.test.ts) are never deployed,
so changes to them alone deploy nothing.
"""

import subprocess
import sys
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FUNCTIONS = ROOT / "supabase" / "functions"
CONFIG = "supabase/config.toml"


def git(*args: str) -> str:
    return subprocess.run(["git", *args], cwd=ROOT, check=True, capture_output=True, text=True).stdout


def all_functions() -> list[str]:
    return sorted(p.name for p in FUNCTIONS.iterdir() if p.is_dir() and p.name[0] not in "._" and (p / "index.ts").exists())


def uses_shared(name: str) -> bool:
    return any("/_shared/" in f.read_text(encoding="utf-8") for f in (FUNCTIONS / name).rglob("*.ts"))


def function_config(text: str | None, name: str) -> dict:
    return tomllib.loads(text).get("functions", {}).get(name, {}) if text else {}


def config_at(commit: str | None) -> str | None:
    if commit is None:
        path = ROOT / CONFIG
        return path.read_text(encoding="utf-8") if path.exists() else None
    try:
        return git("show", f"{commit}:{CONFIG}")
    except subprocess.CalledProcessError:
        return None


def changed(base: str, head: str | None) -> list[str]:
    names = all_functions()
    if not base:
        return names
    files = [f for f in git("diff", "--name-only", base, *([head] if head else []), "--").splitlines() if not f.endswith(".test.ts")]
    shared = any(f.startswith("supabase/functions/_shared/") for f in files)
    old_config, new_config = config_at(base), config_at(head)
    out = []
    for name in names:
        if (
            any(f.startswith(f"supabase/functions/{name}/") for f in files)
            or (shared and uses_shared(name))
            or function_config(old_config, name) != function_config(new_config, name)
        ):
            out.append(name)
    return out


def verify_jwt(name: str) -> bool:
    # The Supabase default is to require a JWT.
    return bool(function_config(config_at(None), name).get("verify_jwt", True))


def main(argv: list[str]) -> int:
    if argv[:1] == ["list"] and len(argv) == 1:
        print("\n".join(all_functions()))
    elif argv[:1] == ["changed"] and len(argv) in (2, 3):
        print("\n".join(changed(argv[1], argv[2] if len(argv) == 3 else None)))
    elif argv[:1] == ["verify-jwt"] and len(argv) == 2:
        if argv[1] not in all_functions():
            print(f"No Edge Function named {argv[1]!r} in supabase/functions", file=sys.stderr)
            return 1
        print("true" if verify_jwt(argv[1]) else "false")
    else:
        print(__doc__, file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
