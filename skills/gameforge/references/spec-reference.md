# game.spec.js reference

`game.spec.js` exports `SPEC`, consumed by `composeGame()` (runtime), `gameforge gdd` (GDD.md),
`gameforge plan` (tasks.json) and `new` (playtest.json). Unknown fields are ignored by the
composer, so you may add design-only fields (e.g. `story`, `art`, `references`).

```js
export const SPEC = {
  id: 'skyline-vigil',            // url/file-safe id (default: from title)
  title: 'Skyline Vigil',
  genre: 'action',                // action | driving | racing | adventure | exploration | survival | collectathon
  pitch: 'One sentence the title screen shows.',
  seed: 42,                       // all procedural content is deterministic per seed
  references: ['Marvel\'s Spider-Man 2 (traversal feel only)'],   // quality targets, never copied
  world: {
    type: 'hills',                // hills | mountains | dunes | flat | arena | island | city
    biome: 'temperate',           // temperate | autumn | desert | snow | tropical | volcanic
    size: 360,                    // metres (terrain worlds)
    height: 30,                   // max terrain height
    water: false,                 // island-style coastline + water plane for non-island types
    timeOfDay: 16.5, dayLength: 0,// hours; dayLength>0 enables a day/night cycle (seconds per day)
    trees: 220, rocks: 100, grass: 8000, species: ['oak', 'pine'],   // vegetation overrides
    // city only:
    blocks: 5, style: 'modern',   // modern | neon | suburb
    maxFloors: 24, traffic: 10,   // traffic: number of AI cars or false
    palette: { grass: 0x4f7a2c }  // override biome colours (grass, grass2, rock, sand, dirt, water, leaves[])
  },
  landmarks: [                    // flattened, decorated sites; ids become anchors for `at`
    { id: 'village', kind: 'village', at: 'north', distance: 60, houses: 6 },
    { id: 'ruins', kind: 'ruins', at: 'west' },
    { id: 'camp', kind: 'camp', x: 40, z: -30 },
    { kind: 'tower', at: 'east', floors: 12 },
    { kind: 'arena', at: 'south' },
  ],
  player: {
    mode: 'onfoot',               // onfoot | vehicle
    combat: true,                 // melee combat kit (combo, heavy, block/parry, dodge, lock-on, ability)
    hp: 150,
    look: { outfit: 'armor', armor: true, cape: true, top: 0x2e3440, accent: 0xc9a227, hairStyle: 'short' },
    vehicle: { type: 'sports', color: 0x16c8ff, tuning: { enginePower: 26, maxSpeed: 62 } },
    spawn: [0, 20],               // optional x,z
  },
  enemies: [                      // archetypes: grunt | brute | duelist | thug (see ENEMY_TYPES)
    { type: 'grunt', count: 4, at: 'camp', spread: 12 },
    { type: 'brute', count: 1, boss: true, name: 'The Warden', hp: 600 },
  ],
  npcs: [
    { id: 'elder', name: 'The Elder', at: 'village', offset: [2, 3], wander: 0,
      look: { outfit: 'robe', top: 0x2a4a6a, hairStyle: 'bun' },
      dialogue: `# start\nThe Elder: Hello!\n> Hi -> end` },   // GameForge dialogue script (below)
  ],
  quests: [
    { id: 'relics', title: 'The Three Relics', description: '…', requires: 'met_elder',
      objectives: [
        { id: 'find', type: 'collect', target: 'relic', count: 3, text: 'Find the relics' },
        { id: 'back', type: 'talk', target: 'elder', text: 'Return to the Elder', after: ['find'] },
      ], rewards: { xp: 100, flags: { relics_done: true } }, next: 'epilogue' },
  ],
  startQuests: [],                // quests active from the start
  collectibles: [{ kind: 'gem', item: 'relic', count: 3, at: 'ruins', radius: 30, label: 'Take the relic', color: 0xffc23a }],
  items: { relic: { name: 'Ancient Relic' } },
  goal: { type: 'quests', quests: ['relics'], label: 'Help the Elder', winTitle: 'Victory', winText: '…' },
        // goal.type: defeat | collect (count) | quests | reach (at, radius) | survive (seconds) | explore
  music: 'exploration',           // exploration | calm | tension | combat | driving | heroic | mystery
  theme: { accent: '#ffb347', accent2: '#ff6a3a' },    // UI colours
  attackTokens: 2,                // how many enemies may attack at once
};
```

## Dialogue script format

```
# node_id                       first node is the entry point
Speaker Name: Line of text      (multiple lines are joined)
> Choice text -> target [if flag_expr] {do: action; action}
-> next_node                    linear continuation ('end' closes the conversation)
@do: action; action             run when the node is shown
@if: flag_expr                  show node only if true, otherwise go to @else
@else: other_node
```
Flag expressions: `flag`, `!flag`, `var>=3`, `quest:id` (active/complete), `quest:id:complete`,
`talked:npcId`, `seen:dialogueId:nodeId`. Text may interpolate `{var}`.
Actions: `set flag`, `set var=3`, `unset flag`, `inc var`, `start questId`, `complete questId`,
`report type target`, `give item [n]`, `take item [n]`, `money n`, `emit eventName`.
A node with no text and a `->` next is a silent router.

## Genre starting points

| Genre | world.type | player | key fields |
|---|---|---|---|
| Brawler / soulslike | arena or hills | onfoot, combat | enemies (+boss), goal defeat |
| Open-world action | island / mountains | onfoot, combat | landmarks, npcs, quests, enemies at camps |
| Street racing | city | vehicle | traffic, custom checkpoints in `src/gameplay.js` |
| Story adventure | island | onfoot, no combat | npcs + dialogue, quest chain, collectibles, goal quests |
| Survival | dunes / snow | onfoot, combat | enemies in waves via `game.spawnEnemy`, goal survive |
| Collectathon | hills | onfoot | collectibles count, goal collect |
