import json
import pathlib
import unittest


REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
FIXTURES_PATH = REPO_ROOT / "posawesome" / "fixtures" / "custom_field.json"
PATCH_PATH = REPO_ROOT / "posawesome" / "patches" / "add_gift_card_pos_profile_settings.py"


def _load_custom_field(name):
    fields = json.loads(FIXTURES_PATH.read_text())
    for field in fields:
        if field.get("name") == name:
            return field
    raise AssertionError(f"Missing fixture field {name}")


class TestGiftCardProfileSettings(unittest.TestCase):
    # posa_allow_supervisor_manage_gift_cards was removed 2026-07-11 (dead
    # field — superseded by the supervisor ROLE gate; POS-PROFILE-SPEC P1).
    def test_gift_cards_are_disabled_by_default_in_fixtures(self):
        use_gift_cards = _load_custom_field("POS Profile-posa_use_gift_cards")

        self.assertEqual(use_gift_cards.get("default"), "0")

    def test_dead_supervisor_flag_stays_removed(self):
        fields = json.loads(FIXTURES_PATH.read_text())
        names = {f.get("name") for f in fields}
        self.assertNotIn("POS Profile-posa_allow_supervisor_manage_gift_cards", names)

    def test_related_gift_card_profile_fields_are_conditional_in_fixtures(self):
        liability_account = _load_custom_field("POS Profile-posa_gift_card_liability_account")

        self.assertEqual(
            liability_account.get("depends_on"),
            "eval:doc.posa_use_gift_cards==1",
        )

    def test_patch_keeps_gift_card_settings_opt_in(self):
        patch_source = PATCH_PATH.read_text()

        self.assertIn('"default": "0"', patch_source)
        self.assertIn('"depends_on": "eval:doc.posa_use_gift_cards==1"', patch_source)


if __name__ == "__main__":
    unittest.main()
