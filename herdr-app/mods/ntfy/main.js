import { View, div } from "gpui-kit";
import { agents, appHome, readTextFile, setShared } from "herdr";

const NTFY = "https://ntfy.sh/";
// Anyone who knows the topic can read it, so it stays out of the dotfiles repo.
const TOPIC_FILE = "data/ntfy/topic";
const SENT = {
  blocked: { title: "Needs you", priority: "high", tags: "warning" },
  done: { title: "Done", priority: "default", tags: "white_check_mark" },
};

// Pings the phone when an agent starts needing you or finishes. Draws nothing.
export default class Ntfy extends View {
  init(_props, cx) {
    // Agents already blocked or done when Herdr starts don't ping again.
    this.seen = new Map(agents().map((a) => [a.address, a.status]));
    cx.spawn(async () => {
      try {
        this.topic = (await readTextFile(`${appHome()}/${TOPIC_FILE}`)).trim();
        setShared("ntfy.started", Date.now());
      } catch (e) {
        console.log(`ntfy: no topic in ${TOPIC_FILE}: ${e}`);
      }
    });
  }

  render() {
    for (const a of agents()) {
      const before = this.seen.get(a.address);
      this.seen.set(a.address, a.status);
      const ping = SENT[a.status];
      if (!this.topic || !ping || before === a.status) continue;
      fetch(NTFY + this.topic, {
        method: "POST",
        headers: { Title: `${ping.title} · ${a.space_name}`, Priority: ping.priority, Tags: ping.tags },
        body: `${a.tab_name} · ${a.program?.name ?? "agent"}`,
      }).catch((e) => console.log(`ntfy: ${e}`));
    }
    return div();
  }
}
