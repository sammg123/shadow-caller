"""A call and how the model scored it: what was entered becomes a family, a leaf and an outcome; the prediction's
fields a log row keeps (p, the play-type tree, the ranks); and a retag, which fixes the play type ESPN can't see
(play-action, screen, RPO, the run gap) and rescores the row from its stored tree. A retag never flips pass and run,
so no play-caller's in-game memory changes."""
from granular import FAMILIES, FAMILY_NAMES, LEAF_FAMILY, LEAF_NAMES, LEAVES, leaf_is_dropback

OUTCOME_NAMES = {"sack": "sack", "scramble": "scramble", "incomplete": "incomplete"}


class CallsMixin:
    """GameEngine's calls. The engine provides state, _checkpoint() and _save()."""

    def _resolve_call(self, call, leaf, family, outcome):
        """Normalise what was entered into (family, leaf, outcome, dropback, legacy call)."""
        pass_flag = None
        if call:
            call = call.upper()
            legacy = {"R": ("run", None, None), "P": (None, None, None),
                      "SC": ("dropback", None, "scramble"), "S": ("dropback", None, "sack")}
            if call not in legacy:
                raise ValueError("Call must be R, P, SC or S.")
            family, leaf, outcome = (family or legacy[call][0]), (leaf or legacy[call][1]), (outcome or legacy[call][2])
            pass_flag = call != "R"
        if leaf is not None and leaf not in LEAF_FAMILY:
            raise ValueError(f"Unknown play '{leaf}'")
        if leaf is not None:
            family = LEAF_FAMILY[leaf]
        if family is not None and family not in FAMILIES:
            raise ValueError(f"Unknown play type '{family}'")
        if outcome not in OUTCOME_NAMES and outcome is not None:
            raise ValueError("Outcome must be sack, scramble or incomplete")
        if outcome == "incomplete":
            if leaf == "rpo_run" or (family == "rpo" and leaf is None):
                family, leaf = "rpo", "rpo_throw"
            elif family == "run":
                family, leaf = "dropback", None          # depth unknown; P/A first to keep it
        elif outcome:                                    # sack or scramble
            if family in ("run", "screen") or leaf == "rpo_run":
                family, leaf = "dropback", None
            leaf = None                                  # the depth of the called route is unknown
        if outcome:
            dropback = 1
        elif leaf:
            dropback = leaf_is_dropback(leaf)
        elif family is not None:
            dropback = int(family in ("dropback", "pa", "screen"))
        elif pass_flag is not None:
            dropback = int(pass_flag)
        else:
            raise ValueError("Pick what he called first.")
        name = LEAF_NAMES[leaf] if leaf else (FAMILY_NAMES[family] if family else ("Pass" if dropback else "Run"))
        if outcome:
            name += f", {OUTCOME_NAMES[outcome]}"
        code = call or ("S" if outcome == "sack" else "SC" if outcome == "scramble" else ("P" if dropback else "R"))
        return family, leaf, outcome, dropback, code, name

    def _pred_fields(self, pred, family, leaf):
        T = pred["_tree"]
        return {
            "p": round(pred["p"], 4), "p_league": round(pred["p_league"], 4),
            "p_habits": round(pred["p_habits"], 4), "flag": pred["flag"],
            "top_leaf": T["rank"][0], "top_leaf_p": round(T["his_l"][T["rank"][0]], 4),
            "fam_p": round(T["his_f"][family], 4) if family else None,
            "fam_p_league": round(T["lg_f"][family], 4) if family else None,
            "fam_top": max(T["his_f"], key=T["his_f"].get),
            "leaf_p": round(T["his_l"][leaf], 4) if leaf else None,
            "leaf_p_league": round(T["lg_l"][leaf], 4) if leaf else None,
            "leaf_rank": (T["rank"].index(leaf) + 1) if leaf else None,
            "leaf_rank_league": (sorted(LEAVES, key=lambda k: -T["lg_l"][k]).index(leaf) + 1) if leaf else None,
            "tree": {k: {kk: round(vv, 5) for kk, vv in T[k].items()} for k in ("his_l", "lg_l", "his_f", "lg_f")},
        }

    def _rescore(self, row, family, leaf):
        """Recompute a logged row's scoring fields from its stored prediction tree after a retag."""
        T = row["tree"]
        rank = sorted(LEAVES, key=lambda k: -T["his_l"][k])
        rank_l = sorted(LEAVES, key=lambda k: -T["lg_l"][k])
        row.update({
            "family": family, "leaf": leaf,
            "fam_p": T["his_f"][family] if family else None, "fam_p_league": T["lg_f"][family] if family else None,
            "leaf_p": T["his_l"][leaf] if leaf else None, "leaf_p_league": T["lg_l"][leaf] if leaf else None,
            "leaf_rank": rank.index(leaf) + 1 if leaf else None,
            "leaf_rank_league": rank_l.index(leaf) + 1 if leaf else None,
        })

    def retag_last(self, key):
        """Fix the play type ESPN can't see on the last logged play: A play-action, N screen, O RPO,
        P plain dropback, K/J/L run gap. Never flips run vs pass, so his memory is unchanged."""
        key = key.upper()
        rows = [r for r in self.state["log"] if not r.get("nullified") and r.get("tree")]
        if not rows:
            raise ValueError("No logged play to retag yet.")
        r = rows[-1]
        drop, depth, out = r["dropback"], r.get("depth"), r.get("outcome")
        if drop:
            target = {"A": ("pa", f"pa_{depth}" if depth and not out else None),
                      "P": ("dropback", f"dropback_{depth}" if depth and not out else None),
                      "N": ("screen", "screen"),
                      "O": ("rpo", "rpo_throw")}.get(key)
            if key == "N" and out in ("sack", "scramble"):
                target = None
        else:
            target = {"O": ("rpo", "rpo_run"), "K": ("run", "run_inside"), "R": ("run", "run_inside"),
                      "J": ("run", "run_edge_left" if r.get("leaf") == "run_ot_left" else "run_ot_left"),
                      "L": ("run", "run_edge_right" if r.get("leaf") == "run_ot_right" else "run_ot_right")}.get(key)
        if not target:
            raise ValueError(f"{key} doesn't fit a {'pass' if drop else 'run'}.")
        self._checkpoint()
        family, leaf = target
        self._rescore(r, family, leaf)
        name = LEAF_NAMES[leaf] if leaf else FAMILY_NAMES[family]
        if out:
            name += f", {OUTCOME_NAMES[out]}"
        r["name"] = name
        r["retagged"] = True
        self.state["message"] = f"Last play retagged: {name}."
        self._save()
