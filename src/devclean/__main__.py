"""Allow running as `python -m devclean`."""

from __future__ import annotations

import sys

from devclean.cli.main import main

if __name__ == "__main__":
    sys.exit(main())