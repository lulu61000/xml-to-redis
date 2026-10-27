"""
Unit tests for export.py. Run with:  python -m unittest -v

No Redis server is needed: FakeRedis below stands in for the real client.
"""

import io
import json
import os
import tempfile
import unittest

from export import build_entries, main, parse_config, save_to_redis

HERE = os.path.dirname(os.path.abspath(__file__))
CONFIG_XML = os.path.join(HERE, "config.xml")


class FakeRedis:
    """Pretends to be a redis.Redis client, storing data in a plain dict."""

    def __init__(self):
        self.store = {}
        self.execute_calls = 0

    def pipeline(self, transaction=True):
        fake = self
        queued = []

        class Pipe:
            def set(self, key, value):
                queued.append((key, value))

            def execute(self):
                fake.execute_calls += 1
                fake.store.update(queued)

        return Pipe()


class TestParseConfig(unittest.TestCase):
    def test_small_document(self):
        xml = """
        <config>
          <subdomains>
            <subdomain>http://a.example.com</subdomain>
            <subdomain>https://b.example.com</subdomain>
          </subdomains>
          <cookies>
            <!-- comments are ignored -->
            <cookie name="dlp-avast" host="amazon">mmm_amz_dlp_777_ppc_m</cookie>
          </cookies>
        </config>"""
        subdomains, cookies = parse_config(xml)
        self.assertEqual(subdomains, ["http://a.example.com", "https://b.example.com"])
        self.assertEqual(cookies, [("dlp-avast", "amazon", "mmm_amz_dlp_777_ppc_m")])

    def test_values_kept_as_written(self):
        xml = """<config><cookies>
            <cookie name="n" host="01net">007</cookie>
            <cookie name="n" host="x">Mmm_Upper</cookie>
        </cookies></config>"""
        _, cookies = parse_config(xml)
        self.assertEqual(cookies[0], ("n", "01net", "007"))   # not turned into 7
        self.assertEqual(cookies[1][2], "Mmm_Upper")          # case preserved

    def test_whitespace_and_tabs_trimmed(self):
        xml = "<config><subdomains>\n\t<subdomain>  https://x.net \t</subdomain></subdomains></config>"
        self.assertEqual(parse_config(xml)[0], ["https://x.net"])

    def test_missing_sections_give_empty_lists(self):
        self.assertEqual(parse_config("<config></config>"), ([], []))

    def test_empty_input_rejected(self):
        with self.assertRaisesRegex(ValueError, "empty"):
            parse_config("   ")

    def test_malformed_xml_rejected(self):
        with self.assertRaisesRegex(ValueError, "Invalid XML"):
            parse_config("<config><subdomains></config>")

    def test_wrong_root_rejected(self):
        with self.assertRaisesRegex(ValueError, "<config>"):
            parse_config("<other/>")

    def test_cookie_without_host_rejected(self):
        with self.assertRaisesRegex(ValueError, "missing"):
            parse_config('<config><cookies><cookie name="x">v</cookie></cookies></config>')

    def test_real_config_file(self):
        with open(CONFIG_XML, encoding="utf-8") as f:
            subdomains, cookies = parse_config(f.read())
        self.assertEqual(len(subdomains), 38)
        self.assertEqual(subdomains[0], "http://secureline.tools.avast.com")
        self.assertEqual(subdomains[-1], "https://bits.avcdn.net")  # tab-indented in the file
        self.assertEqual(len(cookies), 46)


class TestBuildEntries(unittest.TestCase):
    def test_key_format(self):
        entries = build_entries(
            ["http://secureline.tools.avast.com", "http://gf.tools.avast.com"],
            [("dlp-avast", "amazon", "mmm_amz_dlp_777_ppc_m")],
        )
        self.assertEqual(entries[0][0], "subdomains")
        self.assertEqual(json.loads(entries[0][1]),
                         ["http://secureline.tools.avast.com", "http://gf.tools.avast.com"])
        self.assertEqual(entries[1], ("cookie:dlp-avast:amazon", "mmm_amz_dlp_777_ppc_m"))

    def test_no_subdomains_gives_empty_json_list(self):
        self.assertEqual(build_entries([], []), [("subdomains", "[]")])


class TestSaveToRedis(unittest.TestCase):
    def test_all_keys_saved_in_one_transaction(self):
        client = FakeRedis()
        save_to_redis(client, [("a", "1"), ("b", "2")])
        self.assertEqual(client.store, {"a": "1", "b": "2"})
        self.assertEqual(client.execute_calls, 1)


class TestMain(unittest.TestCase):
    def test_verbose_prints_every_key(self):
        client, out = FakeRedis(), io.StringIO()
        main(["-v", CONFIG_XML], client=client, out=out)

        self.assertEqual(len(client.store), 47)  # 1 subdomains + 46 cookies
        self.assertEqual(client.store["cookie:dlp-avast:amazon"], "mmm_amz_dlp_777_ppc_m")
        self.assertEqual(client.store["cookie:dlp-avg:filehippo"], "Mmm_fhp_dlp_779_ppc_m")
        lines = out.getvalue().splitlines()
        self.assertIn("cookie:dlp-avast:amazon = mmm_amz_dlp_777_ppc_m", lines)
        self.assertEqual(len(lines), 48)  # 47 keys + summary line

    def test_without_verbose_prints_only_summary(self):
        out = io.StringIO()
        main([CONFIG_XML], client=FakeRedis(), out=out)
        lines = out.getvalue().splitlines()
        self.assertEqual(len(lines), 1)
        self.assertTrue(lines[0].startswith("Saved 47 keys"))

    def test_bad_xml_does_not_touch_redis(self):
        with tempfile.NamedTemporaryFile("w", suffix=".xml", delete=False) as f:
            f.write("<config><broken></config>")
        client = FakeRedis()
        try:
            with self.assertRaises(ValueError):
                main([f.name], client=client, out=io.StringIO())
        finally:
            os.unlink(f.name)
        self.assertEqual(client.execute_calls, 0)

    def test_missing_path_is_an_error(self):
        with self.assertRaises(SystemExit):  # argparse exits on bad arguments
            main([], client=FakeRedis(), out=io.StringIO())


if __name__ == "__main__":
    unittest.main()
