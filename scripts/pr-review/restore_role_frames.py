#!/usr/bin/env python3
"""Restore private request frames."""

import argparse
from pathlib import Path
import re
import sys

from role_review import Invalid, frame_request, issued_request, load_plan, strict_json, text_file, write


def restore(work):
    plan = load_plan(work)
    if not plan["input_complete"]:
        return
    requests = work / "requests"
    if requests.is_symlink():
        raise Invalid("invalid_request_directory")
    for tag, role in plan["roles"].items():
        if not role["required"]:
            continue
        receipt = strict_json(text_file(work / "slot" / f"{tag}-request.json"))
        nonce = receipt.get("invocation_nonce") if isinstance(receipt, dict) else None
        if not isinstance(nonce, str) or not re.fullmatch(r"[0-9a-f]{32}", nonce):
            raise Invalid("invalid_invocation_nonce")
        prompt, payload = frame_request(
            (work / "roles" / f"{tag}.txt").read_bytes().decode("utf-8"),
            (work / "roles" / f"{tag}.diff").read_bytes().decode("utf-8"), nonce,
        )
        for suffix, value in (("prompt", prompt), ("input", payload)):
            path = requests / f"{tag}.{suffix}"
            if path.is_symlink() or (path.exists() and path.read_bytes() != value.encode()):
                raise Invalid("altered_request_frame")
            if not path.exists():
                write(path, value)
        # Revalidate receipt and frame bytes.
        issued_request(work, plan, tag)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--work", required=True, type=Path)
    args = parser.parse_args()
    try:
        restore(args.work)
        return 0
    except (Invalid, OSError, UnicodeError):
        print("Private request restoration failed validation.", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
