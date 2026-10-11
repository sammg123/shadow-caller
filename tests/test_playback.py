"""Playback over the saved TB at DAL game's ESPN play list (docs/design/restructure-v2.md sections 5 and 9): which plays
the field draws (back and forward move by them), the progress bar's marks, the game's status from ESPN's header, and
where one drawn play back or forward lands. Pure: no engine, no Flask, never the live game."""
import copy

import playback as pb
import timeline as tl
from espn_feed import iter_plays

DRIVE_STARTS = [0, 13, 36, 44, 49, 57, 69, 74, 80, 87, 93, 97, 105, 112, 113, 124, 131, 149, 160, 167, 176]


def by_kind(marks, kind):
    return [(m.idx, m.team, m.label) for m in marks if m.kind == kind]


def with_status(summary, **status):
    out = copy.deepcopy(summary)
    out["header"]["competitions"][0]["status"]["type"].update(status)
    return out


# ---------------------------------------------------------------- which plays draw
def test_every_play_draws_but_the_admin_rows(summary):
    pm = pb.play_map(summary, "DAL")
    assert pm.ids == tuple(str(p["id"]) for t, p in iter_plays(summary)) and len(pm.drawn) == 183
    assert sum(pm.drawn) == 156                             # 183 rows, 27 admin (data contract G1): those draw nothing
    assert pm.drawn[:14] == (True,) * 12 + (False, True)   # the opening drive, its official timeout, TB's kickoff
    assert pm.drawn[-7:] == (True, False, True, False, True, True, False)   # kneels, timeouts, END GAME


def test_a_play_whose_row_cannot_be_built_draws_nothing(summary, monkeypatch):
    """The timeline leaves such a play out (its `missing` list), so the field has nothing to show for it."""
    real = tl.build_row

    def broken(ctx, team, drive, p):
        if str(p["id"]) == "40187298068":                   # DAL's first snap
            raise KeyError("start")
        return real(ctx, team, drive, p)
    monkeypatch.setattr(tl, "build_row", broken)
    assert pb.play_map(summary, "DAL").drawn[:3] == (True, False, True)


# ---------------------------------------------------------------- the progress bar's marks
def test_marks_sit_at_drive_and_quarter_starts_and_just_after_each_score(summary):
    marks = pb.play_map(summary, "DAL").marks
    assert [m._asdict() for m in marks[:3]] == [
        {"idx": 0, "kind": "quarter", "team": None, "label": "Q1"},
        {"idx": 0, "kind": "drive", "team": "DAL", "label": "DAL ball · Q1 15:00"},
        {"idx": 12, "kind": "score", "team": "DAL", "label": "TD DAL"}]       # on the board once play 11 is in
    assert by_kind(marks, "quarter") == [(0, None, "Q1"), (33, None, "Q2"), (93, None, "Q3"), (135, None, "Q4")]
    assert by_kind(marks, "score") == [(12, "DAL", "TD DAL"), (35, "TB", "TD TB"), (87, "DAL", "FG DAL"),
                                       (96, "TB", "TD TB"), (111, "TB", "TD TB"), (123, "TB", "FG TB"),
                                       (159, "DAL", "TD DAL")]
    drives = by_kind(marks, "drive")
    assert [i for i, team, label in drives] == DRIVE_STARTS                  # ESPN's 21 drives
    assert drives[1] == (13, "TB", "TB ball · Q1 10:51") and drives[-1] == (176, "TB", "TB ball · Q4 1:16")
    assert [m.idx for m in marks] == sorted(m.idx for m in marks) and len(marks) == 32


def test_quarter_names_match_the_page():
    assert [pb.quarter_name(q) for q in (1, 2, 3, 4, 5, 6)] == ["Q1", "Q2", "Q3", "Q4", "OT", "2OT"]


def test_a_game_without_plays_has_no_marks(summary):
    pm = pb.play_map({**summary, "drives": {}}, "DAL")
    assert (pm.ids, pm.drawn, pm.marks, pm.game) == ((), (), (), ("post", "Final"))
    assert pb.play_map({"drives": "not a dict"}, "DAL") == ((), (), (), (None, None))


# ---------------------------------------------------------------- the game's status (live or final)
def test_the_status_comes_from_espns_header(summary):
    assert pb.game_of(summary) == ("post", "Final") and not pb.is_live(pb.game_of(summary))
    live = pb.game_of(with_status(summary, state="in", shortDetail="7:31 - 3rd"))
    assert live == ("in", "7:31 - 3rd") and live._asdict() == {"status": "in", "detail": "7:31 - 3rd"}
    assert pb.is_live(live) and pb.is_live(pb.game_of(with_status(summary, state="pre")))   # pre: follow it live
    assert pb.game_of(with_status(summary, state="halftime", shortDetail=7)) == (None, "Final")   # detail falls back
    assert pb.game_of(with_status(summary, shortDetail="x" * 99)).detail == "x" * pb.DETAIL_MAX
    assert pb.game_of({"header": []}) == (None, None) and not pb.is_live(pb.game_of({}))
    assert pb.game_of(None) is None and pb.game_of([summary]) is None and not pb.is_live(None)


# ---------------------------------------------------------------- where back and forward land
DRAWN = (True, True, False, True, False, False, True)     # drawn plays: 0, 1, 3 and 6


def test_back_lands_just_after_the_drawn_play_before_the_last_one_shown():
    assert [pb.back_target(DRAWN, k) for k in range(1, 8)] == [0, 1, 1, 2, 2, 2, 4]
    assert pb.back_target((False, True), 2) == 0                              # nothing drawn before it: kickoff


def test_forward_lands_just_after_the_next_play_that_draws():
    assert [pb.forward_target(DRAWN, k) for k in range(0, 7)] == [1, 2, 4, 4, 7, 7, 7]
    assert pb.forward_target((True, False, False), 1) == 3                    # nothing left that draws: the end


def test_the_position_is_this_games_plays_on_screen():
    ids = ("a", "b", "c")
    assert [pb.position(applied, ids) for applied in ([], ["a"], ["a", "b", "c"])] == [0, 1, 3]
    assert pb.position(["a", "x"], ids) == 0 and pb.position(["b"], ids) == 0     # another game, or out of order
    assert pb.position(["a", "b", "c", "d"], ids) == 0                            # more plays than this game has
