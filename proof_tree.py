#!/usr/bin/env python3
"""Source-checkout CLI; installable package entry point is formality."""
if __package__:
    from .api import *
else:
    from api import *

if __name__ == "__main__":
    main()
