"""Unit tests for the Report Runs registry emit shape (T3.2).

Covers weekly_run.build_report_run_record: required keys + fixed type/source,
runId derivation, optional-field omission, and default runDate. Pure — no
collectors, no network. Run:

    python -m unittest scripts.test_weekly_run_emit   # from ai-report-card/
    python scripts/test_weekly_run_emit.py
"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from weekly_run import build_report_run_record  # noqa: E402

# Must stay in lockstep with REPORT_RUN_KEYS in scripts/report-registry/config.mjs.
REQUIRED = {"runId", "type", "period", "runDate", "status", "source"}
ALLOWED = REQUIRED | {"artifactUrl", "docxUrl", "summary", "commit"}


class BuildReportRunRecordTest(unittest.TestCase):
    def test_required_keys_and_fixed_values(self):
        rec = build_report_run_record(
            period="2026-W27", run_date="2026-07-05T13:30:00-05:00"
        )
        self.assertTrue(REQUIRED.issubset(rec.keys()))
        self.assertEqual(rec["type"], "VP Weekly")
        self.assertEqual(rec["source"], "AIWeeklyReport")
        self.assertEqual(rec["period"], "2026-W27")
        self.assertEqual(rec["status"], "OK")
        self.assertEqual(rec["runDate"], "2026-07-05T13:30:00-05:00")
        self.assertEqual(
            rec["runId"], "VP Weekly|2026-W27|2026-07-05T13:30:00-05:00"
        )

    def test_only_known_keys_emitted(self):
        rec = build_report_run_record(
            period="2026-W27",
            artifact_url="https://rev4nchist.github.io/ai-enablement-status/",
            docx_url="C:/Users/x/report.docx",
            summary="12 commits / 90 hooks",
            commit="abc1234",
        )
        self.assertTrue(set(rec.keys()).issubset(ALLOWED))
        self.assertEqual(
            rec["artifactUrl"], "https://rev4nchist.github.io/ai-enablement-status/"
        )
        self.assertEqual(rec["docxUrl"], "C:/Users/x/report.docx")
        self.assertEqual(rec["summary"], "12 commits / 90 hooks")
        self.assertEqual(rec["commit"], "abc1234")

    def test_omits_empty_or_none_optionals(self):
        rec = build_report_run_record(
            period="2026-W27", artifact_url="", summary="   ", docx_url=None
        )
        for key in ("artifactUrl", "summary", "docxUrl", "commit"):
            self.assertNotIn(key, rec)

    def test_default_run_date_is_iso_and_matches_runid(self):
        rec = build_report_run_record(period="2026-W27")
        self.assertRegex(rec["runDate"], r"^\d{4}-\d{2}-\d{2}T")
        self.assertTrue(rec["runId"].endswith(rec["runDate"]))

    def test_status_passthrough(self):
        rec = build_report_run_record(period="2026-W27", status="Failed")
        self.assertEqual(rec["status"], "Failed")


if __name__ == "__main__":
    unittest.main()
