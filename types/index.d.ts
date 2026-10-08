// What the pixel Clawd is doing right now
export type BuddyMode =
  | 'think' | 'work' | 'edit' | 'search' | 'web' | 'ask' // a turn is running
  | 'recall' | 'memorize' // memory: recalling, memorizing
  | 'compact' | 'offline' // compacting the conversation, connection trouble
  | 'celebrate' | 'walk' | 'coffee' | 'sleep' // idle

// Clawd's state.
// activity — a turn is running or Clawd is resting; tool — the main loop's tool running now;
// spinner — what the turn's spinner says (thinking / waiting for the server / writing / tool);
// wordTool — the kind of work read from the spinner's step word (desktop: "Editing notes.md");
// compacting / compactSince — a compaction is running and since when;
// flash / flashUntil — a short scene raised by an engine insertion (memories attached to the prompt, memory saved) and until when;
// offlineSince — since when the connection is down (0 — fine);
// helpers — how many helpers are on the strip (agents of the main session, leaving ones included);
// crewKey — who sits in which slot and who is leaving (changes — rebuild the picture);
// idleSince — when idling began (ms); celebrate — the turn ended with an answer (celebrate first);
// tick — idle redraw counter; ultra — ultra mode (sunglasses);
// booted — the process's first start has been handled (a hot reload does not repeat it)
export type Buddy = {
  activity: 'idle' | 'busy'
  tool: '' | 'search' | 'web' | 'edit' | 'work' | 'ask' | 'recall' | 'memorize'
  flash: '' | 'search' | 'web' | 'edit' | 'work' | 'ask' | 'recall' | 'memorize'
  flashUntil: number
  spinner: '' | 'requesting' | 'responding' | 'thinking' | 'tool-input' | 'tool-use'
  wordTool: '' | 'search' | 'web' | 'edit' | 'work' | 'ask' | 'recall' | 'memorize'
  compacting: boolean
  compactSince: number
  offlineSince: number
  helpers: number
  crewKey: string
  idleSince: number
  celebrate: boolean
  tick: number
  ultra: boolean
  booted: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'clawd-buddy': { buddy: Buddy }
  }
}
