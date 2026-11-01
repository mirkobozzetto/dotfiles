import { readState, readSize, reconcile, returnPane, shownTerminal, windowSpec, MAX_TERMINALS } from "./model.js";

// The one floating window's lifecycle. Copies share one controller and run its
// commands one at a time, so rapid toggles cannot spawn duplicate shells.
export class FloatController {
  constructor() {
    this.overlay = null;
    this.mounted = null;
    this.seen = null;
    this.previous = null;
    this.generation = 0;
    this.key = null;
  }

  state(host) { return readState(host.getState()); }
  save(host, state) {
    if (JSON.stringify(host.getState()) !== JSON.stringify(state)) host.setState(state);
    return state;
  }
  patch(host, patch) { return this.save(host, { ...this.state(host), ...patch }); }

  // Herdr closes a window by itself when the terminal it shows ends. A terminal
  // a lagging snapshot hasn't listed yet has not ended, so it must be seen first.
  ended(live) {
    if (!this.overlay || !this.mounted || !live) return false;
    if (live.some(terminal => terminal.address === this.mounted)) {
      this.seen = this.mounted;
      return false;
    }
    return this.seen === this.mounted;
  }

  // The host snapshot can also come back empty, so core confirms before a
  // toggle treats the window as gone; then it is forgotten and shown again.
  async closedByHost(host) {
    if (!this.ended(host.liveOwned?.())) return false;
    const state = await this.refresh(host);
    if (state.tabs.some(tab => tab.address === this.mounted)) return false;
    this.overlay = this.mounted = null;
    return true;
  }

  // The header reports its window closing. A close of the current mount that
  // this controller didn't make is Herdr's: on a layout change or quit the
  // window stays closed; when its terminal ended, the next tab or Notes shows
  // at once. Herdr usually closes the window before its snapshot drops the
  // terminal; then core decides, within the 250 ms Herdr gives `close()`.
  async windowClosed(host, generation) {
    if (!this.overlay || generation !== this.generation) return;
    const ended = this.mounted;
    this.overlay = this.mounted = null;
    if (!ended) return;
    const all = host.terminals?.() ?? [];
    if (!all.length || all.some(terminal => terminal.address === ended && terminal.state === "live")) {
      const state = await this.refresh(host);
      // Still running, or shown again meanwhile: nothing to reopen.
      if (this.overlay || state.tabs.some(tab => tab.address === ended)) return;
      this.mount(host, state.active ? state : this.patch(host, { page: "notes" }));
      return;
    }
    const live = host.liveOwned?.() ?? [];
    const tabs = this.state(host).tabs.filter(tab => tab.address !== ended);
    const next = tabs.find(tab => live.some(terminal => terminal.address === tab.address));
    this.mount(host, this.patch(host, next ? { tabs, active: next.address, page: "terminal" } : { tabs, page: "notes" }));
  }

  async refresh(host) {
    const owned = await host.listOwned();
    // Read after the await: notes might have changed while core replied.
    const state = reconcile(this.state(host), owned);
    return this.save(host, state);
  }

  async create(host) {
    const state = this.state(host);
    if (state.tabs.length >= MAX_TERMINALS) throw new Error(`Float Space supports up to ${MAX_TERMINALS} terminals. Close one before adding another.`);
    const title = `Terminal ${state.sequence + 1}`;
    const terminal = await host.spawnOwned();
    if (!/^t[0-9a-z]+$/.test(terminal?.address ?? "")) throw new Error("The core did not return a local terminal address.");
    const latest = this.state(host);
    return this.patch(host, {
      tabs: [...latest.tabs, { address: terminal.address, title }],
      active: terminal.address, page: "terminal", sequence: state.sequence + 1,
    });
  }

  async show(host, remember = true) {
    if (this.overlay && !(await this.closedByHost(host))) return;
    if (remember && !this.overlay) this.previous = host.focused();
    const live = host.liveOwned?.();
    // The host already streams labels and liveness. Reopening a known live shell
    // needs no subprocess. An empty/lagging snapshot still needs an exact query.
    let state = live?.some(terminal => terminal.address === this.state(host).active)
      ? this.save(host, reconcile(this.state(host), live)) : await this.refresh(host);
    // Only the very first opening starts a shell. Once every terminal has ended,
    // in view or while hidden, Notes shows, as after closing the last tab.
    if (!state.active && state.page !== "notes") state = state.sequence ? this.patch(host, { page: "notes" }) : await this.create(host);
    this.mount(host, state);
  }

  // Opening the same key replaces the window in place; a new size has a new
  // key, so the old window is closed after the new one shows.
  mount(host, state = this.state(host)) {
    this.generation += 1;
    const spec = windowSpec(state, this.generation);
    const previous = this.overlay;
    this.overlay = host.open(spec);
    this.mounted = shownTerminal(state);
    if (previous && previous !== this.overlay && spec.key !== this.key) host.close(previous);
    this.key = spec.key;
  }

  hide(host, restore = true) {
    if (!this.overlay) return;
    const current = host.focused();
    const pane = returnPane(this.previous, current, host.panes(), this.state(host).tabs.map(tab => tab.address));
    const overlay = this.overlay;
    // Forget the window first: closing it closes the header, which must not
    // take this for Herdr's close. Focus the pane while the caller still lives.
    this.overlay = this.mounted = null;
    if (restore && pane) host.focusPane(pane);
    host.close(overlay);
  }

  async handle(command, host) {
    if (command === "toggle") {
      if (this.overlay && !(await this.closedByHost(host))) this.hide(host);
      else await this.show(host);
    } else if (command === "show") {
      await this.show(host);
    } else if (command === "hide") {
      this.hide(host);
    } else if (command === "new") {
      if (!this.overlay) this.previous = host.focused();
      const live = host.liveOwned?.();
      if (live?.length) this.save(host, reconcile(this.state(host), live));
      else await this.refresh(host);
      const state = await this.create(host);
      this.mount(host, state);
    } else if (command === "notes") {
      if (this.state(host).page === "notes") return;
      this.patch(host, { page: "notes" });
      if (this.overlay) this.mount(host);
    } else if (/^resize-\d+-\d+$/.test(command)) {
      const [width, height] = command.slice(7).split("-").map(value => Number(value) / 100);
      const state = this.state(host);
      const size = readSize({ width, height });
      if (JSON.stringify(size) === JSON.stringify(state.size)) return;
      this.patch(host, { size });
      if (this.overlay) this.mount(host);
    } else if (command.startsWith("select-")) {
      const address = command.slice(7);
      if (address === this.state(host).active && this.state(host).page === "terminal") return;
      const live = host.liveOwned?.();
      const state = live?.some(terminal => terminal.address === address)
        ? this.save(host, reconcile(this.state(host), live)) : await this.refresh(host);
      if (!state.tabs.some(tab => tab.address === address)) return;
      this.patch(host, { active: address, page: "terminal" });
      if (this.overlay) this.mount(host);
    } else if (command.startsWith("end-")) {
      // Like Herdr's tab.close: no question, but only a terminal core still lists as ours.
      const address = command.slice(4);
      const state = await this.refresh(host);
      if (!state.tabs.some(tab => tab.address === address)) throw new Error("That terminal no longer belongs to Float Space.");
      // Show the next tab first: Herdr closes a window whose terminal ends,
      // and replacing it in place flickers less than closing and reopening.
      const before = { tabs: state.tabs, active: state.active, page: state.page };
      const tabs = state.tabs.filter(tab => tab.address !== address);
      const after = this.patch(host, { tabs, active: state.active === address ? tabs[0]?.address ?? null : state.active,
        page: tabs.length ? state.page : "notes" });
      if (this.overlay && shownTerminal(after) !== this.mounted) this.mount(host, after);
      try {
        await host.killOwned(address);
      } catch (error) {
        const restored = this.patch(host, before);
        if (this.overlay && shownTerminal(restored) !== this.mounted) this.mount(host, restored);
        throw error;
      }
    } else if (command === "reconcile" && this.overlay) {
      const before = this.state(host);
      const live = host.liveOwned?.();
      if (live && !this.ended(live) && live.length === before.tabs.length
        && before.tabs.every(tab => live.some(terminal => terminal.address === tab.address))) return;
      let after = await this.refresh(host);
      if (!after.active) after = this.patch(host, { page: "notes" });
      if (shownTerminal(after) !== this.mounted) this.mount(host, after);
    }
  }
}
