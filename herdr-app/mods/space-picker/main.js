import { View, div } from 'gpui-kit';
import { h_flex, v_flex, InputState, Input } from 'gpui-base';
import { home, appHome, exec, theme, shared, setShared, run, props, closeOverlay, pickFolder, spaces, panes } from 'herdr';
import { normalize, display, completion, search } from './paths.js';

const FAVORITES = 'space-picker.favorites';
const RECENTS = 'space-picker.recents';
const IDENTITIES = 'space-picker.identities';
const LIMIT = 60;
// The navigator roots of ~/dotfiles/herdr: zoxide only knows folders entered by hand.
const ROOTS = ['code', 'glouton', 'stuffs', 'business', 'Learn', 'Downloads', 'dotfiles', 'brain', 'Obsidian', '.claude'];
const saved = key => (Array.isArray(shared(key)) ? shared(key).filter(p => typeof p === 'string' && p.startsWith('/')) : []);

export default class SpacePicker extends View {
  init(_props, cx) {
    this.home = home();
    this.query = '';
    this.index = [this.home];
    this.matches = [];
    this.list = this.buildRows();
    this.at = 0;
    this.version = 0;
    this.loading = true;
    this.busy = false;
    this.error = '';
    this.handle = cx.focus_handle();
    this.input = InputState.new({ placeholder: 'Search folders or type ~/code/…' });
    this.input.on('change', (_event, cx) => {
      this.query = this.input.value();
      this.at = 0;
      this.chosen = false;
      this.error = '';
      this.refresh(cx);
    });
    this.input.on('submit', (_event, cx) => this.open(this.selected(), cx));
    this.input.focus();
    cx.timer.after(150, () => this.input.focus());
    cx.spawn(async cx => {
      const found = [this.home];
      // Bounded discovery: home children and one level under common roots.
      const children = await this.directories(this.home);
      found.push(...(children ?? []));
      const roots = ROOTS.map(name => this.home + '/' + name);
      const nested = await Promise.all(roots.map(path => this.directories(path)));
      for (let i = 0; i < roots.length; i++) {
        if (nested[i] !== null) found.push(roots[i], ...nested[i]);
      }
      this.index = [...new Set(found)];
      if (shared(FAVORITES) == null) setShared(FAVORITES, roots.filter(p => found.includes(p)).slice(0, 6));
      this.loading = false;
      this.refresh(cx);
      this.loadIndex(roots.filter(p => found.includes(p)), cx);
    });
  }

  async request(path, mode = 'list', options = '') {
    try {
      const result = await exec('python3', [appHome() + '/mods/space-picker/folders.py', path, mode, options]);
      if (result.code === 127) this.runtimeError = 'Python 3 is required. Install it and reopen the picker.';
      if (result.code !== 0) return null;
      this.runtimeError = '';
      return JSON.parse(result.stdout);
    } catch {
      this.runtimeError = 'Folder scanner unavailable. Check that Python 3 is installed on PATH.';
      return null;
    }
  }

  directories(path) {
    return this.request(path);
  }

  loadIndex(roots, cx, refresh = false) {
    this.searchRoots = roots;
    this.indexing = true;
    cx.notify();
    const options = JSON.stringify({
      roots: [...new Set([...roots, ...saved(FAVORITES), ...saved(RECENTS)])],
      cache: appHome() + '/data/space-picker-index.json',
      ttl: refresh ? 0 : 60,
    });
    cx.spawn(async cx => {
      const result = await this.request(this.home, 'index', options);
      if (result) {
        this.index = [...new Set([...this.index, ...result.paths])];
        this.indexLimited = result.limited;
        this.list = this.buildRows();
      }
      this.indexing = false;
      cx.notify();
    });
  }

  refresh(cx) {
    const version = ++this.version;
    const target = completion(this.query, this.home);
    this.matches = [];
    this.loadingPath = false;
    this.list = this.buildRows();
    if (!target) { cx.notify(); return; }
    this.loadingPath = true;
    cx.spawn(async cx => {
      const paths = await this.directories(target.dir);
      if (version !== this.version) return;
      this.matches = (paths ?? []).filter(p => {
        const name = p.split('/').pop().toLowerCase();
        return name.startsWith(target.prefix) && (!name.startsWith('.') || target.prefix.startsWith('.'));
      });
      this.loadingPath = false;
      this.list = this.buildRows();
      cx.notify();
    });
    cx.notify();
  }

  // Searches the whole index: call when inputs change and store in this.list; never from render or key handlers.
  buildRows() {
    const favorites = saved(FAVORITES);
    const recents = saved(RECENTS);
    if (this.query.trim()) {
      let paths = this.matches;
      if (!completion(this.query, this.home)) {
        const showHidden = this.query.includes('.');
        const candidates = [...favorites, ...recents, ...this.index].filter(p => showHidden || !p.includes('/.'));
        paths = search(candidates, this.query, this.home, LIMIT);
      }
      return paths.slice(0, LIMIT).map(path => ({ path, group: 'Matches' }));
    }
    const seen = new Set();
    const rows = [];
    for (const [group, paths] of [['Favorites', favorites], ['Recent', recents], ['Folders', this.index.filter(p => !p.split('/').pop().startsWith('.')).slice(0, 16)]]) {
      for (const path of paths) if (!seen.has(path)) { seen.add(path); rows.push({ path, group }); }
    }
    return rows;
  }

  selected() {
    // A fully typed absolute path takes precedence on Enter.
    return (this.chosen ? this.list[this.at]?.path : normalize(this.query, this.home)) ?? this.list[this.at]?.path;
  }

  complete(cx) {
    const path = this.list[this.at]?.path;
    if (path) {
      this.chosen = false;
      this.input.set_value(path === '/' ? '/' : display(path, this.home) + '/');
      this.query = this.input.value(); this.at = 0; this.refresh(cx);
    }
  }

  star(path) {
    const favorites = saved(FAVORITES);
    setShared(FAVORITES, favorites.includes(path) ? favorites.filter(p => p !== path) : [...favorites, path]);
    this.list = this.buildRows();
  }

  open(path, cx) {
    if (!path || this.busy) return;
    this.busy = true;
    this.error = '';
    // Capture the target before validation: edits during I/O cannot change this request.
    const fallback = !this.chosen && path === normalize(this.query, this.home) ? this.list[this.at]?.path : null;
    const overlay = props().overlay;
    cx.notify();
    cx.spawn(async cx => {
      try {
        // Validates even stale favorites and typed paths before creating a terminal.
        let canonical = await this.request(path, 'check');
        // Partial typed paths open the highlighted completion if the literal path is absent.
        if (canonical === null && fallback && fallback !== path) {
          path = fallback;
          canonical = await this.request(path, 'check');
        }
        if (canonical === null) throw new Error('Unreadable directory');
        // Like the herdr navigator: a folder already open as a space goes back to it.
        const local = spaces().filter(s => !s.machine);
        const open = local.find(s => s.folder === path || s.folder === canonical)
          ?? local.find(s => panes().some(p => s.tabs.some(t => t.id === p.tab) && (p.cwd === path || p.cwd === canonical)));
        if (open) run('space.select', { id: open.id });
        else run('space.new', { folder: path });
        const identities = shared(IDENTITIES) ?? {};
        const recents = [path, ...saved(RECENTS).filter(p => p !== path && p !== canonical && identities[p] !== canonical)].slice(0, 12);
        setShared(RECENTS, recents);
        setShared(IDENTITIES, Object.fromEntries(recents.map(p => [p, p === path ? canonical : identities[p] ?? p])));
        closeOverlay(overlay);
      } catch {
        this.error = 'Cannot open this folder. Check that it exists and is readable.';
      }
      this.busy = false;
      cx.notify();
    });
  }

  browse(cx) {
    cx.spawn(async cx => {
      try {
        const path = await pickFolder({ prompt: 'Choose a folder for your new space' });
        if (path) this.open(path, cx);
      } catch { this.error = 'Could not open the folder browser.'; cx.notify(); }
    });
  }

  render() {
    const t = theme();
    const rows = this.list;
    this.at = Math.max(0, Math.min(this.at, rows.length - 1));
    const favorites = saved(FAVORITES);
    const button = (id, text, primary, action) => h_flex().id(id).h(32).px(12).items_center().rounded(7)
      .bg(primary ? t.solid : t.raised).text_color(primary ? t.solid_foreground : t.foreground)
      .cursor_pointer().hover(s => s.opacity(0.85)).on_click(action).child(text);
    let previous = '';
    const items = rows.map((row, i) => {
      const heading = row.group !== previous;
      previous = row.group;
      return v_flex().flex_none().h(heading ? 60 : 36).when(heading, el => el.child(div().h(24).px(8).pt(6).text_size(11).text_color(t.dim).child(row.group)))
        .child(h_flex().id('folder-' + i).h(36).px(8).gap(8).items_center().rounded(7)
          .when(i === this.at, el => el.bg(t.selected)).hover(s => s.bg(t.hover))
          .child(div().id('open-' + i).flex_1().truncate().cursor_pointer().on_click((_e, cx) => this.open(row.path, cx))
            .child(display(row.path, this.home)))
          .child(div().id('star-' + i).px(7).py(5).cursor_pointer().text_color(favorites.includes(row.path) ? t.accent : t.dim)
            .on_click((_e, cx) => { this.star(row.path); cx.notify(); }).child(favorites.includes(row.path) ? '★' : '☆'))
          .child(div().id('enter-' + i).px(7).py(5).cursor_pointer().text_color(t.dim)
            .on_click((_e, cx) => { this.at = i; this.complete(cx); }).child('›')));
    });
    return v_flex().id('space-picker').track_focus(this.handle).w_full().h_full().p(20).gap(10).bg(t.popover).text_color(t.foreground).text_size(13)
      .on_key_down((e, cx) => {
        if (e.key === 'escape') closeOverlay(props().overlay);
        else if (e.key === 'down') { this.at = Math.min(this.list.length - 1, this.at + 1); this.chosen = true; }
        else if (e.key === 'up') { this.at = Math.max(0, this.at - 1); this.chosen = true; }
        else if (e.key === 'pagedown') { this.at = Math.min(this.list.length - 1, this.at + 6); this.chosen = true; }
        else if (e.key === 'pageup') { this.at = Math.max(0, this.at - 6); this.chosen = true; }
        else if (e.key === 'tab') this.complete(cx);
        else return;
        cx.stop_propagation(); cx.notify();
      })
      .child(h_flex().items_center().justify_between()
        .child(div().text_size(18).font_semibold().child('New space'))
        .child(div().text_size(11).text_color(t.dim).child('Esc to cancel')))
      .child(div().text_color(t.muted).child('Choose where your terminal starts.'))
      .child(Input.new(this.input).h(38).flex_none().px(10).rounded(8).border_1().border_color(t.accent).bg(t.background).text_color(t.foreground))
      .child(v_flex().id('folder-results-' + this.query).flex_1().min_h(0).overflow_y_scrollbar().children(items)
        .when(!rows.length, el => el.child(div().p(12).text_color(t.dim).child(this.loading || this.loadingPath || this.indexing ? 'Searching folders…' : 'No matches. Type a full path or browse.'))))
      .when(Boolean(this.error || this.runtimeError), el => el.child(div().text_size(12).text_color(t.blocked).child(this.runtimeError || this.error)))
      .child(h_flex().gap(8).items_center().text_size(11).text_color(t.dim)
        .child(div().flex_none().child(this.indexing ? 'Searching folders…' : `${rows.length}${rows.length === LIMIT ? '+' : ''} ${this.query ? 'matches' : 'folders'}`))
        .when(Boolean(this.chosen && rows[this.at]), el => el.child(div().flex_1().truncate().text_color(t.foreground).child(display(rows[this.at].path, this.home))))
        .when(Boolean(this.indexLimited && !this.indexing && !this.chosen), el => el.child(div().flex_1().truncate().child('Search limited · type a path to browse further')))
        .child(div().flex_1())
        .when(Boolean(this.searchRoots && !this.indexing), el => el.child(div().id('refresh-search').cursor_pointer().text_color(t.muted)
          .hover(s => s.text_color(t.foreground)).on_click((_e, cx) => this.loadIndex(this.searchRoots, cx, true)).child('Refresh'))))
      .child(div().text_size(11).text_color(t.dim).child('↑ ↓ Select    Tab / › Browse deeper    Enter Open    ☆ Favorite'))
      .child(h_flex().gap(8).items_center()
        .child(button('browse', 'Browse…', false, (_e, cx) => this.browse(cx)))
        .child(div().flex_1())
        .child(button('cancel', 'Cancel', false, () => closeOverlay(props().overlay)))
        .child(button('create', this.busy ? 'Opening…' : 'Open space', true, (_e, cx) => this.open(this.selected(), cx))));
  }
}
