// Herdr's notifications, silenced: each one closes as soon as it opens.
// Copied over Herdr's own toast mod by apply.sh.

import { View, div } from "gpui-kit";
import { props, closeOverlay } from "herdr";

export default class Toast extends View {
  init(p) {
    const id = p?.overlay ?? props()?.overlay;
    if (id) closeOverlay(id);
  }

  render() {
    return div();
  }
}
