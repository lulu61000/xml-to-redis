"""
Export data from an XML config file into Redis.

Keys written:
  subdomains            -> JSON list of every <subdomain>
  cookie:<name>:<host>  -> text of each <cookie name="..." host="...">

Usage:
  python export.py [-v] /path/to/xml
  -v   print every key saved to Redis
"""

import argparse
import json
import os
import sys
import xml.etree.ElementTree as ET

import redis


# ---------------------------------------------------------------------------
# Step 1: read the XML and pull out the data we need.
# Input:  XML text (a string)
# Output: (list of subdomains, list of (name, host, value) cookie tuples)
# This function only works with the string it is given (no files, no Redis),
# which makes it easy to test.
# ---------------------------------------------------------------------------
def parse_config(xml_text):
    if not xml_text or not xml_text.strip():
        raise ValueError("XML input is empty")

    # Turn the text into a tree of elements. Broken XML raises ParseError,
    # which we turn into a clearer message.
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError as e:
        raise ValueError(f"Invalid XML: {e}") from e

    if root.tag != "config":
        raise ValueError(f"Root element must be <config>, found <{root.tag}>")

    # Every <subdomain> inside <subdomains>, in file order.
    # .strip() removes spaces, tabs and newlines around the text.
    # "or ''" covers an empty element, whose .text is None.
    subdomains = [(el.text or "").strip() for el in root.findall("./subdomains/subdomain")]

    # Every <cookie> inside <cookies>. name and host are attributes,
    # the value is the element's text. XML comments are skipped automatically.
    cookies = []
    for i, el in enumerate(root.findall("./cookies/cookie"), start=1):
        name = el.get("name")
        host = el.get("host")
        if not name or not host:
            raise ValueError(f'Cookie #{i} is missing a "name" or "host" attribute')
        cookies.append((name, host, (el.text or "").strip()))

    return subdomains, cookies


# ---------------------------------------------------------------------------
# Step 2: turn the parsed data into the exact Redis keys the task asks for.
# Output: a list of (key, value) pairs, in the order they will be saved.
# Values are kept exactly as in the XML (no case change, no number conversion).
# ---------------------------------------------------------------------------
def build_entries(subdomains, cookies):
    # "subdomains" holds the whole list as one JSON string.
    entries = [("subdomains", json.dumps(subdomains))]
    # One key per cookie, e.g. "cookie:dlp-avast:amazon".
    for name, host, value in cookies:
        entries.append((f"cookie:{name}:{host}", value))
    return entries


# ---------------------------------------------------------------------------
# Step 3: save the pairs to Redis.
# A pipeline with transaction=True sends everything as one MULTI/EXEC block,
# so either all keys are saved or none are (no half-finished export).
# `client` is passed in rather than created here, so tests can use a fake one.
# ---------------------------------------------------------------------------
def save_to_redis(client, entries):
    pipe = client.pipeline(transaction=True)
    for key, value in entries:
        pipe.set(key, value)
    pipe.execute()


# ---------------------------------------------------------------------------
# Step 4: tie it all together - read arguments and the file, run steps 1-3,
# and print the keys when -v is given.
# ---------------------------------------------------------------------------
def main(argv=None, client=None, out=sys.stdout):
    # 4a. Command-line arguments: optional -v and one file path.
    parser = argparse.ArgumentParser(description="Export XML config data to Redis.")
    parser.add_argument("-v", "--verbose", action="store_true",
                        help="print every key saved to Redis")
    parser.add_argument("xml_path", help="path to the XML file")
    args = parser.parse_args(argv)

    # 4b. Read and convert the file. This happens before connecting to Redis,
    # so a bad file stops the run without touching the database.
    with open(args.xml_path, encoding="utf-8") as f:
        subdomains, cookies = parse_config(f.read())
    entries = build_entries(subdomains, cookies)

    # 4c. Connect to Redis. Inside Docker, REDIS_URL points at the redis
    # container; outside Docker it falls back to a local Redis.
    url = os.environ.get("REDIS_URL", "redis://localhost:6379")
    if client is None:
        client = redis.Redis.from_url(url, decode_responses=True)

    # 4d. Save everything.
    save_to_redis(client, entries)

    # 4e. Report. With -v, list each key and its value.
    if args.verbose:
        for key, value in entries:
            print(f"{key} = {value}", file=out)
    print(f"Saved {len(entries)} keys to Redis ({url}).", file=out)
    return entries


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, redis.RedisError) as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
