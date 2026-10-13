// His tendencies on the Model Report (pure): the app's own view model (model/vm-tendencies.js) on the view his boards
// read (report/model/side.js sidePv). With both callers tracked and no model profile on the shown caller's side, the
// plate still names him over an empty face (never the plain "His tendencies", never the other caller's terms); with
// one caller it is the app's view model as it is.
import { TENDENCIES } from "../../model/copy.js";
import { freezeDeep } from "../../model/format.js";
import { tendenciesVm } from "../../model/vm-tendencies.js";

/**
 * @param {object} pv  presented view (sidePv's: `side` is the shown caller when both are tracked)
 * @returns {object} frozen tendenciesVm(pv), its title naming the shown caller when his profile is missing
 */
export function reportTendenciesVm(pv) {
  const vm = tendenciesVm(pv);
  const caller = pv && pv.side && pv.side.caller;
  if (!caller || vm.title !== TENDENCIES.fallbackTitle) return vm;
  return freezeDeep({ ...vm, title: TENDENCIES.title(caller) });
}
