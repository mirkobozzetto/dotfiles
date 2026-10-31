// Whitby: herdr dressed as the Whitby desktop app. One mod draws each part of
// the layout, picked by props().part: titlebar, rail, sidebar, header, footer, home.

import { View, div } from "gpui-kit";
import { props } from "herdr";
import { titlebar } from "./titlebar.js";
import { rail } from "./rail.js";
import { initSidebar, sidebar } from "./sidebar.js";
import { header } from "./header.js";
import { footer } from "./footer.js";
import { initHome, home } from "./home.js";
import { sampleStats } from "./kit.js";

export default class Whitby extends View {
  init(_props, cx) {
    this.part = props()?.part;
    if (this.part === "sidebar") initSidebar(this, cx);
    if (this.part === "footer") sampleStats(this, cx);
    if (this.part === "home") initHome(this);
  }

  render() {
    switch (this.part) {
      case "titlebar": return titlebar(this);
      case "rail": return rail(this);
      case "sidebar": return sidebar(this);
      case "header": return header();
      case "footer": return footer(this);
      case "home": return home(this);
      default: return div();
    }
  }
}
