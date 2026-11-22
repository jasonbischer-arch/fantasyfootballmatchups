#!/usr/bin/env python3
"""Make a Mattress Pro access code and print the hash to paste into pro.json.

Usage:
  python tools/make_code_hash.py            # generate a new random code
  python tools/make_code_hash.py MYCODE     # hash a code you chose

Put the printed hash in pro.json "codeHashes" and the code itself in your Stripe
Payment Link's confirmation message. Never commit the code itself.
"""
import hashlib
import secrets
import string
import sys

code = sys.argv[1] if len(sys.argv) > 1 else "SLEEP-" + "".join(secrets.choice(string.ascii_uppercase + string.digits) for _ in range(6))
code = code.strip().upper()
print("Access code:", code)
print("Hash for pro.json:", hashlib.sha256(code.encode()).hexdigest())
