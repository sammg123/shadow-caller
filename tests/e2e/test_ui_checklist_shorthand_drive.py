"""FI 6.3 checklist #78 to #91: the shorthand bar (FI 2.6; G22), drive ends, Undo, Reset and Export (FI 2.2; G8)."""
import re
import urllib.request

import pytest
from playwright.sync_api import expect
from ui_helpers import (COL, answer_dialogs, clear_history, command, csv_rows, ensure_finished, expect_off_field,
                        expect_shows, expect_toast, fresh, load, log_table, quiet, record_requests, reset_game, state,
                        until, with_drive)
from ui_helpers import show  # v1.4 (W6): world-aware helpers

pytestmark = pytest.mark.e2e

CSV_HEADER = ("snap,drive,time,qtr,clock,down,togo,yardline_100,score,p,p_league,p_habits,flag,call,dropback,yards,"
              "success,td,turnover,family,leaf,outcome,name,top_leaf,top_leaf_p,fam_p,fam_p_league,leaf_p,leaf_p_league,"
              "leaf_rank,leaf_rank_league,seq,nullified,penalty").split(",")


def run(page, text, via_button=False):
    cmd = page.locator("#cmd")
    cmd.fill(text)
    if via_button:
        page.locator("#cmdBtn").click()
    else:
        cmd.press("Enter")


def test_78_two_segments_run_as_one_undo_step(upage, server):
    """#78: `JJ 6 | 2&4 D44` toasts "Done: JJ 6, 2&4 D44", clears the box; one Undo reverts both segments."""
    base = server["base"]
    with_drive(upage, base)
    run(upage, "JJ 6 | 2&4 D44")
    expect_toast(upage, "Done: JJ 6, 2&4 D44")
    expect(upage.locator("#cmd")).to_have_value("")
    s = state(base)
    assert (len(s["log"]), s["sit"]["down"], s["sit"]["togo"], s["sit"]["yardline_100"]) == (1, 2, 4, 56)
    upage.locator("#undoBtn").click()
    expect_toast(upage, "Undid the last action.")
    expect(upage.locator("#iDown")).to_have_value("1")
    s = state(base)
    assert (len(s["log"]), s["sit"]["down"], s["sit"]["togo"], s["sit"]["yardline_100"]) == (0, 1, 10, 75)


@pytest.mark.parametrize("line, name, yds", [
    ("PP 0 INC", "Intermediate (10–19), incomplete", "0"),
    ("AA 12", "PA intermediate (10–19)", "12"),
    ("O 3", "RPO, handed off or kept", "3"),
    ("OO 9", "RPO, thrown", "9"),
    ("S 7", "Dropback pass, sack", "-7"),
    ("SC 6", "Dropback pass, scramble", "6"),
], ids=["PP-0-INC", "AA-12", "O-3", "OO-9", "S-7", "SC-6"])
def test_79_shorthand_play_codes(upage, server, line, name, yds):
    """#79: each tap code logs its play name (and S 7 logs -7)."""
    with_drive(upage, server["base"])
    run(upage, line)
    expect_toast(upage, re.compile(r"^Done: "))
    until(upage, lambda: len(log_table(upage)) == 1, what="the logged row")
    row = log_table(upage)[0]
    assert (row[COL["Actual"]], row[COL["Yds"]]) == (name, yds)


def test_80_i_logs_a_pass_turnover_with_dashes(upage, server):
    """#80: `I` logs "Pass, turnover" with dashes in His % on it, League % and Rank."""
    with_drive(upage, server["base"])
    run(upage, "I")
    until(upage, lambda: len(log_table(upage)) == 1, what="the interception row")
    row = log_table(upage)[0]
    assert row[COL["Actual"]] == "Pass, turnover"
    assert (row[COL["His % on it"]], row[COL["League %"]], row[COL["Rank"]]) == ("—", "—", "—")


@pytest.mark.parametrize("line, toast, moves", [
    ("X DH", "Done: Defensive holding: 5 yards, automatic first down. 1st & 10 at DAL 30.", True),
    ("X FS", "Done: False start: back 5 yards. 1st & 15 at DAL 20.", True),
    ("X DPI 28", "Done: Defensive pass interference: ball at the spot, 28 yards, automatic first down. 1st & 10 at TB 47.",
     True),
    ("X TB 15 1ST", "Done: Penalty on TB: 15 yards, automatic first down. 1st & 10 at DAL 40.", True),
    ("X DAL 10", "Done: Penalty on DAL: back 10 yards. 1st & 20 at DAL 15.", True),
    ("X", "Done: Offsetting penalties, replay the down. 1st & 10 at DAL 25.", False),
], ids=["X-DH", "X-FS", "X-DPI-28", "X-TB-15-1ST", "X-DAL-10", "X"])
def test_81_shorthand_flags_toast_and_log_nothing(upage, server, line, toast, moves):
    """#81: each shorthand flag toasts its message and adds no log row; `X` replays the down without moving the ball."""
    base = server["base"]
    with_drive(upage, base)
    run(upage, line)
    expect_toast(upage, toast)
    s = state(base)
    assert s["log"] == []
    assert (s["sit"]["yardline_100"] != 75 or s["sit"]["togo"] != 10) == moves


def test_82_shorthand_situation_and_drive_ends(upage, server):
    """#82: `new D25`, `new T30`, `DAL 14 TB 10`, `Q2 1:58`, `punt`, `fg miss`, `half` each do what FI 2.6 says."""
    base = server["base"]
    fresh(upage, base)
    run(upage, "new D25")
    expect(upage.locator("#driveInfo")).to_have_text(re.compile(r"^Drive 1, snap 1 of the game$"))
    expect(upage.locator("#iYard")).to_have_value("25")
    run(upage, "new T30")
    expect(upage.locator("#sideTxt")).to_have_text("TB")
    expect(upage.locator("#iYard")).to_have_value("30")
    run(upage, "DAL 14 TB 10")
    expect(upage.locator("#iOff")).to_have_value("14")
    expect(upage.locator("#iOpp")).to_have_value("10")
    run(upage, "Q2 1:58")
    expect(upage.locator("#iQtr")).to_have_value("2")
    expect(upage.locator("#iClock")).to_have_value("1:58")
    for end in ("punt", "fg miss", "half"):
        run(upage, "new D25")
        expect(upage.locator("#endRow")).to_be_visible()
        run(upage, end)
        expect_toast(upage, f"Done: {end}")                    # FI 2.6: "Done: " plus the segments
        expect(upage.locator("#endRow")).to_be_hidden()
        expect_off_field(upage)
    s = state(base)
    assert (s["sit"]["score_off"], s["sit"]["score_opp"], s["drive_active"]) == (14, 10, False)


@pytest.mark.parametrize("line, message", [
    ("KK 3", "Didn't understand 'KK 3'"),
    ("X ZZ", "Unknown flag 'ZZ'. Try X DH, X FS, X OH, X DPI 25, X TB 5"),
], ids=["KK-3", "X-ZZ"])
def test_83_bad_shorthand_is_refused_and_kept(upage, server, line, message):
    """#83: a bad line gives its red toast, changes nothing, and stays in the box."""
    base = server["base"]
    with_drive(upage, base)
    before = state(base)["version"]
    run(upage, line)
    expect_toast(upage, message, error=True)
    expect(upage.locator("#cmd")).to_have_value(line)
    s = state(base)
    assert (s["version"], s["log"], s["sit"]["yardline_100"]) == (before, [], 75)


def test_84_enter_and_run_button_run_shorthand_never_the_pick(upage, server):
    """#84: Enter in the shorthand box runs it, the Run button does too, and Enter there never logs the picked play."""
    base = server["base"]
    with_drive(upage, base)
    upage.keyboard.press("p")
    expect(upage.locator("#chosen")).to_contain_text("Short (0–9 air yds)")
    plays = record_requests(upage, "/api/play")
    commands = record_requests(upage, "/api/command")
    run(upage, "Q1 14:00")
    expect(upage.locator("#iClock")).to_have_value("14:00")
    run(upage, "Q1 13:00", via_button=True)
    expect(upage.locator("#iClock")).to_have_value("13:00")
    quiet(upage)
    assert [r["body"] for r in commands] == [{"text": "Q1 14:00"}, {"text": "Q1 13:00"}]
    assert plays == []


def test_85_fg_without_a_drive_is_refused(upage, server):
    """#85 [fix] (G22): `fg` with no drive active is refused and the score stays."""
    base = server["base"]
    fresh(upage, base)
    run(upage, "fg")
    expect_toast(upage, re.compile(r"^No DAL drive in progress, so there's no field goal to add\."), error=True)
    expect(upage.locator("#iOff")).to_have_value("0")
    assert state(base)["sit"]["score_off"] == 0


def test_86_punt_ends_the_drive(upage, server):
    """#86: Punt toasts "Punt. Waiting for the next Dallas drive.", shows the off-field state, the field loses its
    markers."""
    with_drive(upage, server["base"])
    expect(upage.locator("#field")).to_have_attribute("data-los", "75")
    upage.locator('[data-end="punt"]').click()
    expect_toast(upage, "Punt. Waiting for the next Dallas drive.")
    expect_off_field(upage)
    expect(upage.locator("#field")).to_have_attribute("data-drive-active", "false")
    expect(upage.locator("#field")).not_to_have_attribute("data-los", re.compile(".*"))


def test_87_fg_good_fg_missed_half_over(upage, server):
    """#87: FG good adds 3; FG missed leaves the score; Half over toasts "End of half. ..." and ends the drive."""
    base = server["base"]
    with_drive(upage, base)
    upage.locator('[data-end="fg"]').click()
    expect_toast(upage, "Field goal good (+3). Waiting for the next Dallas drive.")
    expect(upage.locator("#iOff")).to_have_value("3")
    command(base, "new D25")
    expect(upage.locator("#endRow")).to_be_visible()
    upage.locator('[data-end="fg_miss"]').click()
    expect_toast(upage, "Field goal missed. Waiting for the next Dallas drive.")
    expect(upage.locator("#iOff")).to_have_value("3")
    command(base, "new D25")
    expect(upage.locator("#endRow")).to_be_visible()
    upage.locator('[data-end="half"]').click()
    expect_toast(upage, "End of half. Waiting for the next Dallas drive.")
    assert state(base)["drive_active"] is False


def test_88_undo_key_and_button_then_nothing_to_undo(upage, server):
    """#88: U and the Undo button revert the last action ("Undid the last action."); with nothing to undo the toast is
    "Nothing to undo."."""
    base = server["base"]
    reset_game(base)
    clear_history(base)
    load(upage, base)
    upage.keyboard.press("u")
    expect_toast(upage, "Nothing to undo.")
    command(base, "new D25")
    expect(upage.locator("#endRow")).to_be_visible()
    upage.keyboard.press("u")
    expect_toast(upage, "Undid the last action.")
    expect(upage.locator("#endRow")).to_be_hidden()
    command(base, "new D25")
    expect(upage.locator("#endRow")).to_be_visible()
    upage.locator("#undoBtn").click()
    expect_toast(upage, "Undid the last action.")
    expect(upage.locator("#endRow")).to_be_hidden()
    assert state(base)["drive_active"] is False


def test_89_reset_confirms_and_dismissing_changes_nothing(upage, server):
    """#89: Reset asks "Clear every snap logged for this game?"; dismissing changes nothing; accepting gives the fresh
    state and "Set the start of Dallas's first drive."."""
    base = server["base"]
    reset_game(base)
    command(base, "new D25 | K 3")
    load(upage, base)
    before = state(base)["version"]
    asked = answer_dialogs(upage, accept=[False, True])
    upage.locator("#resetBtn").click()
    until(upage, lambda: len(asked) == 1, what="the reset confirm")
    assert asked == ["Clear every snap logged for this game?"]
    quiet(upage)
    assert state(base)["version"] == before
    expect(upage.locator("#iDown")).to_have_value("2")
    upage.locator("#resetBtn").click()
    expect_toast(upage, "Set the start of Dallas's first drive.")
    assert asked == ["Clear every snap logged for this game?"] * 2
    s = state(base)
    assert (s["log"], s["drive_active"], s["sit"]["yardline_100"]) == ([], False, 75)
    show(upage, "#logArea")
    expect_shows(upage.locator("#logArea"), "No snaps yet.")


def test_90_export_csv(upage, server):
    """#90: Export CSV downloads shadow_caller_log.csv (text/csv), the FI header, one row per log row, oldest first."""
    base = server["base"]
    ensure_finished(base)
    load(upage, base)
    log = state(base)["log"]
    with upage.expect_download() as info:
        upage.locator('a[href="/api/export.csv"]').click()
    download = info.value
    assert download.suggested_filename == "shadow_caller_log.csv"
    rows = csv_rows(open(download.path(), encoding="utf-8").read())
    assert rows[0] == CSV_HEADER
    assert len(rows) - 1 == len(log)
    seqs = [int(r[CSV_HEADER.index("seq")]) for r in rows[1:]]
    assert seqs == sorted(seqs) and seqs[0] == min(row["seq"] for row in log)
    with urllib.request.urlopen(base + "/api/export.csv") as r:
        assert r.headers.get("Content-Type", "").startswith("text/csv")


def test_91_undo_in_one_tab_shows_in_another_within_2_5_s(ui_pages, server):
    """#91 [fix] (G8): an Undo made in one tab shows up in a second open tab within 2.5 s."""
    base = server["base"]
    reset_game(base)
    command(base, "new D25 | K 3")
    first = ui_pages()
    second = ui_pages()
    load(first, base)
    load(second, base)
    show(second, "#logArea")                          # before the clock starts: a world may keep the log on a board
    expect(second.locator("#iDown")).to_have_value("2")
    first.keyboard.press("u")
    expect_toast(first, "Undid the last action.")
    expect(second.locator("#iDown")).to_have_value("1", timeout=2500)
    expect_shows(second.locator("#logArea"), "No snaps yet.", timeout=2500)
