# Writing narrative content

You can write a game's story, cast, missions and branching dialogue yourself, and prove it is
sound. Write a **story script** (`story/<name>.story.js`), review it with the tool, fix what it
reports, and repeat until there is no FAIL. The tool does not judge whether the writing is
good. That is your job, and the method below is how to do it.

```bash
node $GF/tools/gameforge.mjs story story/heist.story.js      # [--out dir] [--no-render]
```

The command:
- compiles the script to engine data (quests + per-NPC dialogue graphs) and prints clear,
  path-prefixed errors (`missions (regatta) objectives[1] (book): collect undeclared item "ledgr"`);
- runs the checks listed below. Each one prints PASS, WARN or FAIL;
- **simulates playthroughs** with the real `DialogueSystem` and `QuestSystem`: one always
  picking the first choice, one picking the last, and one targeted run per branch flag.
  World objectives (reach, collect, kill) are auto-reported. Every run must reach the ending;
- writes these files to `review/`:
  - `<name>.graph.png` / `.svg`: the mission DAG plus every conversation as a node graph,
    with defects shown in red;
  - `<name>.bible.md`: a story bible with premise, cast table, acts and beats, branches, a
    flag table (where each flag is set and read), playthroughs and metrics;
  - `<name>.compiled.json`: the compiled engine data.

**Open the graph and read the bible before you use the story.**

Worked example: `skills/gameforge/stories/heist.story.js` (*The Blue Ledger*). It is an
original open-world crime arc with 3 acts, 9 missions, 11 branch flags, 3 endings and a
foldback through optional branch missions. Read it first.

## Using a story in a game

```js
// game.spec.js
import story from './story/heist.story.js';
export const SPEC = { title: 'The Blue Ledger', world: { type: 'city' }, story, /* ...rest */ };
```

`composeGame` compiles `spec.story` (raw or already compiled with `compileStory`) and merges:
- missions become `quests`;
- each character with dialogue becomes an NPC with one merged dialogue graph whose entry
  depends on mission state;
- `world.locations` that have a `kind` become `landmarks`;
- `items`, `startQuests` and missions with `start: 'auto'` are merged too;
- a default `goal: { type: 'quests' }` is added from the ending.

Entries you write in the spec directly win on id clashes. `reach` objectives complete when
the player comes within 12 m of the location's anchor (set `radius` to change this). For
`custom` objectives, call `game.quests.report('custom', target)` from your module code.

## Story script format

```js
export default {
  id, title, premise, logline, themes: [..], tone,
  world: { setting, facts: [..], locations: [{ id, name, kind?, at?, desc, hooks: [..] }] },
  items: { ledger: { name: 'The Blue Ledger' } },
  enemies: ['drone'],                      // extra enemy types beyond grunt|brute|duelist|thug
  flags: { initial: { heat: 0 }, external: ['alarm'] },   // external = set/read by game code
  characters: [{ id, name, aliases, role, main, player, want, need, flaw, arc, voice, barks, idle, at, look }],
  acts: [{ id, title, purpose, missions: [ /* mission objects or ids */ ] }],   // or top-level missions: [...]
  missions: [{
    id, title, giver, summary, act, optional, start: 'dialogue'|'auto',
    requires: ['missionId'], requiresFlags: 'cond',
    beats: ['...'],
    objectives: [{ id, type: 'talk'|'reach'|'collect'|'kill'|'flag'|'custom', target, count, text, after: [ids], optional }],
    dialogue: [{ id, with: 'charId', when: 'offer'|'active'|'complete'|'always'|cond, if, once, priority, script: `...` }],
    branches: [{ id, choice, flag, consequence, foldback: 'missionId' | ending: true }],
    flags: { flagName: 'what it means' },
    rewards: { xp, money, items, flags: { k: v } },
  }],
  conversations: [{ id, with, when: cond, script }],       // story-level (not tied to a mission)
  ending: { missions: [..], if: cond, title, text },      // default: every non-optional mission
}
```

Dialogue `script` uses the GameForge dialogue script format (`references/spec-reference.md`):

| Syntax | Meaning |
|---|---|
| `# node` | starts a node |
| `Speaker: line` | a line. Use one speaker per node; split nodes when the speaker changes |
| `> choice -> target [if cond] {do: a; b}` | a player choice |
| `-> next` | continue to the next node |
| `@if:` / `@else:` | a router node |
| `@do:` | run actions when the node is shown |

Every path must end in `-> end`.

`when` decides which conversation a character opens with:

| `when` | Plays while |
|---|---|
| `offer` | the mission's requirements are met and the mission has not started. Put `start <missionId>` in the accepting choice |
| `active` | the mission is in progress |
| `complete` | after the mission is done. It plays once by default |

Higher priority wins. By default later missions win, and within a mission the order is
complete > active > offer. If nothing matches, the character plays an idle line (`idle` or
the first bark).

The engine sets some flags you can read in conditions:

| Flag | Meaning |
|---|---|
| `quest:<id>` | active or complete |
| `quest:<id>==active` | the mission is in progress |
| `quest:<id>:complete` | the mission is done |
| `quest:<id>:<objectiveId>` | that objective is done. Gate a conversation with `if:` until the player has arrived |
| `talked:<npc>` | the player has talked to this NPC |
| `seen:<conversationId>` | this conversation has been seen |

### Checks

| Check | Level |
|---|---|
| compiles: schema, ids, references (giver, requires, after, items, locations) | FAIL |
| undefined jump targets · unreachable nodes · dead ends (a node without `-> end`, next or choices) · traps (`end` unreachable) | FAIL |
| every choice in a node is conditional (the player may see no option) | WARN |
| a flag is read but never set (dead condition) | FAIL |
| a flag is set but never read (consequence not tracked) | WARN |
| conditions or actions name an unknown mission, NPC, node or item | FAIL |
| a mission can never start · an objective can never complete · an `after` cycle | FAIL |
| mission dependency cycles | FAIL |
| a branch flag is not set by any reachable choice · a branch does not fold back | FAIL |
| a branch flag is never read | WARN |
| undefined speaker · a main character is missing want/need/flaw/arc | FAIL |
| no voice note · a character never appears | WARN |
| a line is over 30 words, or a choice over 12 words · a mission has no choice · more than 60 lines in a mission · a mission has no beat sheet | WARN |
| franchise names (original IP only) | FAIL |
| a simulated playthrough fails to reach the ending · a branch cannot be played to the ending | FAIL |

## The method (what a professional narrative designer does)

1. **Premise.** Write it in one sentence: *character + want + obstacle + stakes*. For example:
   "A getaway driver who works alone must join a crew to steal a crime boss's ledger, and
   decide whether its truth is worth more than her brother's debt." If you cannot write this
   sentence, you do not have a story yet. Add a logline, the hook a player would repeat.
2. **Theme.** Pick one or two questions the story argues about, not answers. For example:
   *loyalty you are paid for versus loyalty you choose*. Every major choice should put
   pressure on the theme. Then the branches mean something, and the player is not just
   picking a route.
3. **Characters.** For every main character, write:
   - **Want**: the external goal.
   - **Need**: the inner truth they must accept.
   - **Flaw**: what stops them from accepting it.
   - **Arc**: how the story forces the change. A flat arc is allowed for antagonists if it is
     tested.
   - **Voice**: rhythm, vocabulary, verbal tics and what they never say.

   Supporting characters need at least a want and a voice. Build the cast as contrasts: each
   character embodies a different answer to the theme (mentor, zealot, pragmatist,
   antagonist).
4. **Structure.** Use three acts, or an act/mission structure for open worlds.
   - **Act I.** Status quo, inciting incident, commitment.
   - **Act II.** Escalation, a midpoint reversal, a crisis.
   - **Act III.** Climax, decision, resolution.

   Each mission is a small story: goal → obstacle → turn → new information. Lay missions out
   as a DAG (`requires`). Parallel missions give an open world its freedom. Gate them with
   requirements, not walls.
5. **Beat sheets.** Write 2–6 beats per mission before you write any dialogue. A beat is
   something that *changes* (information, relationship, power, location). If a beat changes
   nothing, cut it.
6. **Branching design.**
   - **Make choices meaningful.** Each one costs something, reflects the character, and has
     a consequence the player sees later. Make some choices purely expressive (tone, no
     state), and say so.
   - **Track consequences with flags.** Declare each branch (`branches: [{ flag,
     consequence, foldback }]`) and read the flag later: in dialogue variants (`@if:`), in
     gated choices (`[if flag]`) and in requirements. A flag nobody reads is a broken
     promise to the player.
   - **Use a foldback structure.** Branches diverge, then reconverge at a foldback mission
     (`foldback`). This keeps the content cost linear. Diverge in what characters say and
     remember, and save truly divergent content for endings. Optional branch missions
     (`optional: true` with `requiresFlags`) are the cheap way to give each branch its own
     gameplay.
   - Run the tool: every branch must be playable to the ending.
7. **Dialogue craft.**
   - **Subtext.** Characters rarely say what they mean. Use the flaw to decide what they
     avoid saying.
   - **Brevity.** Games are read while playing. Aim for 8–15 words per line, at most 30 per
     line and 12 per choice. Use one speaker per node. Enter late and leave early.
   - **Voice.** Cover the speaker names: you should still know who is talking.
   - **Choices** are short intents ("Count faster."), not full sentences. Avoid choices
     where one option is obviously right.
   - Give each character 2–4 **barks** (short ambient lines). The first one is their idle
     line.
   - No exposition dumps. Let the world show it (see 9).
8. **Quest design.**
   - Build each objective on a verb: talk, reach, collect, kill, decide (`flag`). Vary the
     verbs within a mission and across a chain. Never use three fetch quests in a row.
   - Every mission ends on a turn or a reveal.
   - Side-quest types: *character* (deepens a cast member), *world* (explains a place),
     *consequence* (pays off an earlier flag), *mirror* (echoes the theme in a smaller
     story), *activity* (a pure gameplay loop with a framing line).
9. **Environmental storytelling.** For each location, give the World Builder 2–4 `hooks`:
   concrete props or staging that tell a story without text. For example, "blue debt markers
   pinned to a stall's wall of shame" or "a child's drawing taped inside the clerk's window".
   These go in the bible's location list.
10. **Original IP only.** AAA games are quality targets for structure and pacing. Never use
    their names, characters, places, plots or lines. The tool fails on known franchise
    names, but originality is your responsibility.

## Checklist (before you report the story as done)

- [ ] The premise is one sentence. The themes are 1–2 questions. The world has 3+ facts.
- [ ] Every main character has want, need, flaw, arc and voice. The cast contrasts on the theme.
- [ ] 3 acts (or a clear act/mission DAG). Every mission has beats and ends on a turn.
- [ ] Every mission has at least one choice, and some choices set flags read later.
- [ ] Every branch has a consequence and a foldback (or is an ending). Every branch is playable to the end.
- [ ] Lines ≤ 30 words, choices ≤ 12 words, one speaker per node, every character has barks.
- [ ] Objective verbs vary. No objective is impossible, and no mission is unreachable.
- [ ] Every location has environmental storytelling hooks.
- [ ] `gameforge story` shows no FAIL. You opened the graph and read the bible, and the WARNs are fixed or justified.
- [ ] In-game: the quest chain completes in a playtest (`references/testing.md`).
