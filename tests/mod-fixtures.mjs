// Named loaders for production modules used by multiple tests.
import { join } from "node:path";
import { chain, databaseTimer, drawingHost, exec, gpuiHost, load, nodes, openedKdb, popoverHost, temporary, KIT_NIGHT } from "./helpers.mjs";

export const loadSpaces = (host) => load("kanso-spaces/main.js", ["Spaces"], host);
export const loadDescribe = (host) => load("kanso-help/keymap.js", ["describe"], host);
export const loadContainers = (host) => load("kanso-containers/main.js", ["Containers"], host);
export const loadStore = (host) => load("kanso-spaces/store.js", ["Store"], host);
export const loadKdb = (host) => load("kanso-spaces/kdb.js", ["Kdb"], host);
export const loadMarkdownDoc = (host) => load("kanso-panel/doc.js", ["MarkdownDoc"], host);
export const loadDirectory = (host) => load("kanso-panel/files.js", ["directory"], host);
export const loadFiles = (host) => load("kanso-panel/files.js", ["Files"], host);
export const loadReadDigest = (host) => load("kanso-strip/main.js", ["readDigest"], host);
export const loadHachiPixels = (host) => load("kanso-dojo/mascot-pixels.js", ["hachiPixels"], host);
export const loadWorkspaceChrome = (host) => load("kanso-chrome/main.js", ["WorkspaceChrome"], host);
// kanso-chrome mounted as Herdr mounts it, with nothing run.
export const mountChrome = async (host) => {
  const { WorkspaceChrome } = await loadWorkspaceChrome(host);
  const view = new WorkspaceChrome();
  view.init({}, { focus_handle: () => ({ focus() {} }), spawn() {}, timer: { after() {}, every() {} } });
  return view;
};
export const loadFront = (host) => load("kanso-panel/front.js", ["Front"], host);
export const loadCheckState = (host) => load("kanso-panel/ghchecks.js", ["checkState"], host);
export const loadPullRequest = (host) => load("kanso-panel/pr.js", ["PullRequest"], host);
export const loadMemory = (host) => load("kanso-guard/main.js", ["Memory"], host);
export const loadStaleAgents = (host) => load("kanso-guard/model.js", ["staleAgents"], host);
export const loadPorts = (host) => load("kanso-panel/ports.js", ["Ports"], host);
export const loadGuideSections = (host) => load("kanso-help/guide.js", ["guideSections"], host);
export const loadHelp = (host) => load("kanso-help/main.js", ["Help"], host);
export const loadTokens = (host) => load("kanso-panel/ui.js", ["tokens"], host);
export const loadRow = (host) => load("kanso-panel/ui-row.js", ["row"], host);
export const loadMenu = (host) => load("kanso-panel/ui-menu.js", ["menu"], host);
export const loadStrip = (host) => load("kanso-strip/main.js", ["Strip"], host);
export const loadTabs = (host) => load("kanso-tabs/main.js", ["Tabs"], host);
export const loadTabPanels = (host) => load("kanso-tabs/main.js", ["Tabs", "panelList"], host);
export const loadLook = (host) => load("kanso-panel/look.js", ["Look"], host);
export const loadPanelKdb = (host) => load("kanso-panel/kdb.js", ["Kdb"], host);
export const loadShareImages = (host) => load("kanso-panel/share.js", ["toPng", "firstPage"], host);
export const loadSinceLeft = (host) => load("kanso-spaces/since-left.js", ["SinceLeft"], host);
export const loadWorkspaceStatus = (host) => load("kanso-status/main.js", ["WorkspaceStatus"], host);
export const loadNeedsYouView = (host) => load("kanso-spaces/needs-you-view.js", ["queueControl", "queueList"], host);
export const loadQuestionOf = (host) => load("kanso-status/model.js", ["questionOf"], host);
export const loadOpenWith = (host) => load("open-with/main.js", ["OpenWith"], host);
export const loadPanelState = (host) => load("kanso-panel/panel-state.js", ["projectOpen", "fileMemory", "OPEN"], host);
export const loadFindThreads = (host) => load("kanso-spaces/threads.js", ["findThreads"], host);
export const loadSimulatorTools = (host) => load("kanso-sim/registration.js", ["TOOLS"], host);
export const loadSimulator = (host) => load("kanso-sim/main.js", ["Simulator"], host);
export const loadUpdater = (host) => load("kanso-chrome/update.js", ["Updater"], host);
export const loadGroupInbox = (host) => load("kanso-panel/pr-inbox.js", ["groupInbox"], host);
export const loadAuthTiming = (host) => load("kanso-panel/pr-poll.js", ["AUTH_MS"], host);
export const loadSleepingNow = (host) => load("kanso-spaces/roster.js", ["sleepingNow"], host);
export const loadRosterReads = (host) => load("kanso-spaces/roster.js", ["readNow", "seenNow"], host);
export const loadTerminalNames = (host) => load("kanso-spaces/roster.js", ["terminalNames"], host);
export const loadPendingState = (host) => load("kanso-panel/ui-state.js", ["PENDING"], host);
export const loadDefaultKeys = (host) => load("kanso-settings/defaults.js", ["DEFAULT_KEYS"], host);
export const loadSettings = (host) => load("kanso-settings/main.js", ["Settings"], host);
export const loadSessionHeight = (host) => load("kanso-spaces/agents.js", ["sessionHeight"], host);
export const loadSimulatorApi = (host) => load("kanso-panel/platform-simulator.js", ["simulatorApi"], host);
export const loadRecordPrFacts = (host) => load("kanso-panel/pr-inbox.js", ["recordPrFacts"], host);
export const loadDuration = (host) => load("kanso-spaces/agents.js", ["duration"], host);
export const loadTokenSpend = (host) => load("kanso-spend/main.js", ["TokenSpend"], host);
export const loadToast = (host) => load("kanso-toast/main.js", ["Toast"], host);

const pageHost = (host) => ({ ...popoverHost(), theme: () => KIT_NIGHT, appHome: () => "/app", home: () => "/home/me", ...host });
const onScreen = { awake: true, width: 960, share: { open: false }, busy: {}, reading: false, again: false };
export const memoryPage = async (fields = {}, host = {}) => {
  const { Memory, Armed } = await load("kanso-guard/main.js", ["Memory", "Armed"], pageHost(host));
  return Object.assign(new Memory(), onScreen, { now: null, digest: null, range: "day", batch: null, showAll: false, armed: new Armed(), actionError: null }, fields);
};
export const spendPage = async (fields = {}, host = {}) => {
  const { TokenSpend } = await loadTokenSpend(pageHost(host));
  const handle = { focus() {}, scroll_to_item() {} };
  return Object.assign(new TokenSpend(), onScreen, { costs: null, scan: null, error: null, runtimeError: null, running: null, page: "home", stack: [], settings: null, planInputs: [], queuedSources: null, expanded: {}, syncHolds: [],
    cost: { period: "day", offset: 0, project: "all", model: "all" }, nodeBinary: null, openMenu: null, menuOptions: null, menuAt: -1, menuG: 0, chooserFocus: { project: handle, model: handle }, chooserScroll: handle }, fields);
};

// kdb.js in its own temporary folder: `names` are more of its exports, `wrap` watches its commands, and `fresh()` is a new view of a database file there, as after a restart.
export const temporaryKdbFile = async (t, names = [], wrap = (run) => run) => {
  const dir = await temporary(t);
  const loaded = await load("kanso-spaces/kdb.js", ["Kdb", ...names], { exec: wrap(exec), appHome: () => dir });
  return { ...loaded, dir, fresh: () => new loaded.Kdb(databaseTimer, join(dir, "kanso")) };
};

// A real kanso.db in its own temporary folder, opened.
export const temporaryKdb = async (...args) => {
  const loaded = await temporaryKdbFile(...args);
  return { ...loaded, db: await openedKdb(loaded.Kdb) };
};

// Files on /repo with `entries` at its top, drawn through a virtual list; `guard(name)` runs as each handler is registered.
export const listedFiles = async (entries, guard = () => {}) => {
  let listed;
  const element = () => {
    const handlers = {};
    const target = { handlers, when(condition, callback) { if (condition) callback(proxy); return proxy; } };
    const proxy = new Proxy(target, { get(object, name) {
      if (name in object) return object[name];
      return (...args) => {
        if (String(name).startsWith("on_")) {
          guard(name);
          handlers[name] = args[0];
        }
        return proxy;
      };
    } });
    return proxy;
  };
  const { Files } = await loadFiles({
    div: element, svg: element, h_flex: element, v_flex: element,
    Scrollbar: { vertical: element }, theme: () => ({}), key: () => "fixture",
    isMarkdown: (path) => /\.md$/.test(path),
    v_virtual_list: (_id, count, _height, key, render) => { const el = element(); listed = { count, key, render, el }; return el; },
  });
  const panel = Object.assign(new Files(), { context: "fixture", root: "/repo", folders: new Set(), marks: {}, entries: new Map([["", entries]]) });
  return { panel, list: () => listed };
};

export const STRIP_NIGHT = { foreground: "#d8d4cb", background: "#1b1b19", hover: "#232321", selected: "#2b2b28", accent: "#da627d", dim: "#6b6862", muted: "#949086", chrome: "#141413" };
export const loadStripWith = (props, panes, store) => load("kanso-strip/main.js", ["Strip"], {
  ...gpuiHost(), svg: (path) => { const el = chain("svg"); el.calls.push(["svg", path]); return el; },
  image: (path) => { const el = chain("image"); el.calls.push(["image", path]); return el; }, Popover: { new: (id) => chain(id) }, HoverCard: { new: (id) => chain(id) },
  theme: () => STRIP_NIGHT, props: () => props, panes: () => panes, agents: () => [], focused: () => null,
  spaces: () => [], machines: () => [], home: () => "/home/me", terminals: () => [], shared: (key) => store[key] ?? null, setShared: (key, value) => { store[key] = value; },
  run: () => {}, hc: async () => ({ code: 0 }), openOverlay: () => {},
});

export const byTag = (el, tag) => nodes(el).find((kid) => kid.tag === tag);
export const keyDown = (el, e, cx = { notify() {}, stop_propagation() {}, spawn() {} }) => el.calls.filter((call) => call[0] === "on_key_down").forEach(([, handler]) => handler(e, cx));
export const dialogHost = () => ({ ...drawingHost(), Textarea: { new: () => chain("textarea") }, Input: { new: () => chain("input") } });
const typed = (value, multiline = false) => ({ value: () => value, state: {}, multiline, focused: false });
export async function openedSend(host, { from = null, to = null, text = "hi", query = "" } = {}) {
  const { Send } = await load("kanso-send/main.js", ["Send"], {
    ...dialogHost(), theme: () => KIT_NIGHT, props: () => ({ overlay: "o1" }), terminals: () => [], panes: () => [], spaces: () => [], machines: () => [],
    shared: () => null, setShared() {}, closeOverlay() {}, run() {}, ...host,
  });
  return Object.assign(new Send(), { from, to, toProject: null, text, error: null, sending: false, unsure: [], handle: {}, query: typed(query), box: typed(text, true) });
}
