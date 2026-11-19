// There is no Teach card in this build: the steps for making and ending passes are built in (lib/builtin.js).
import { $ } from "./shared.js";
import { renderGuide } from "./guide.js";

let getSettings = () => ({});

export async function initTeach(settingsGetter) {
  getSettings = settingsGetter;
  renderTeach();
}

export function renderTeach() {
  $("teach").hidden = true;
  renderGuide(getSettings(), false);
}
