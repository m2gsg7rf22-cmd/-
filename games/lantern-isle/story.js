// Lantern Isle narrative data: characters, dialogue scripts (GameForge dialogue format)
// and the quest chain. Kept separate from code so writers/agents can edit it directly.
export const CHARACTERS = {
  mira: { name: 'Keeper Mira', look: { seed: 31, outfit: 'robe', top: 0x2a4a6a, accent: 0xd0a030, hairStyle: 'bun', hair: 0x9a9aa0, skin: 0xe0b48f, height: 1.7 }, pos: [6, 4], idleAnim: null },
  tobin: { name: 'Tobin', look: { seed: 44, outfit: 'casual', top: 0x8a5a2a, bottom: 0x3a3a2a, hairStyle: 'short', hair: 0x6a4022, beard: true, skin: 0xc68c64 }, pos: [-14, 10] },
  ilse: { name: 'Ilse', look: { seed: 52, outfit: 'casual', top: 0x3a7a5a, bottom: 0x2a2a3a, hairStyle: 'ponytail', hair: 0x8a2a1a, skin: 0xf1d0b5, height: 1.68 }, pos: [12, -12] },
  bram: { name: 'Old Bram', look: { seed: 63, outfit: 'robe', top: 0x5a4a3a, accent: 0x8a6a3a, hairStyle: 'bald', beard: true, hair: 0xd8d8d8, skin: 0xa86d47 }, pos: [-6, -16] },
};

export const DIALOGUE = {
  mira: `
# start
@if: quest:light:complete
@else: check
-> after
# after
Keeper Mira: The lighthouse burns again. Ships will find their way home tonight — because of you.
-> end
# check
@if: quest:crystals
@else: intro
-> progress
# intro
Keeper Mira: Ah — a traveller, washed up with the morning tide. Welcome to Lantern Isle.
-> intro2
# intro2
Keeper Mira: I'm afraid you've arrived on a dark day. The great lantern on the cliff went out three nights ago.
> What happened to it? -> what
> How can I help? -> help
> I should go. -> bye
# what
Keeper Mira: Its heart is made of three sun-crystals. A storm scattered them across the island.
-> help
# help
Keeper Mira: Find the three crystals and bring them to the lighthouse. Tobin, Ilse and old Bram each saw where one fell.
@do: start crystals; set met_mira
-> help2
# help2
Keeper Mira: Take this lantern. It will glow brighter when a crystal is near.
@do: give lantern
-> end
# progress
Keeper Mira: You carry {crystals} of the three crystals. The villagers may know where the rest lie.
-> end
# bye
Keeper Mira: Then may the tide be kind to you. Come back if you change your mind.
-> end
`,
  tobin: `
# start
@if: met_mira
@else: stranger
-> hint
# stranger
Tobin: Fresh off the beach, are you? You should talk to Keeper Mira by the well.
-> end
# hint
Tobin: A crystal? Aye — I saw a streak of gold fall on the hill east of the old pines. Up past the standing stones.
@do: set hint_east
> Thanks, Tobin. -> end
> Anything else? -> gossip
# gossip
Tobin: Only that Bram claims the lighthouse ghost took them. Bram claims a lot of things.
-> end
`,
  ilse: `
# start
@if: met_mira
@else: stranger
-> hint
# stranger
Ilse: Oh! Hello. The keeper is looking for help, if you're the helpful sort.
-> end
# hint
Ilse: The beach to the south — something glittered in the rock pools at low tide. Mind the water, it's cold.
@do: set hint_south
-> end
`,
  bram: `
# start
@if: met_mira
@else: stranger
-> hint
# stranger
Old Bram: Hrm. The lantern's out. Bad omens. Bad omens.
-> end
# hint
Old Bram: The third crystal? The ghost carried it to the ruins in the north-west. I'd not go there myself.
> Is there really a ghost? -> ghost
> I'm not afraid. -> brave
# ghost
Old Bram: There's always a ghost, child. Whether it's dead or just lonely is another matter.
@do: set heard_ghost
-> end
# brave
Old Bram: Then take my old key. There's a chest in the ruins that's been locked longer than I've been alive.
@do: give old_key; set bram_key
-> end
`,
};

export const QUESTS = [
  { id: 'crystals', title: 'The Dark Lantern', description: 'Recover the three sun-crystals scattered by the storm.',
    objectives: [
      { id: 'c', type: 'collect', target: 'crystal', count: 3, text: 'Find the sun-crystals' },
      { id: 'ask', type: 'flag', target: 'hint_east', text: 'Ask the villagers for clues', optional: true },
    ], rewards: { xp: 100 }, next: 'light' },
  { id: 'light', title: 'Rekindle the Light', description: 'Return the crystals to the lighthouse on the northern cliff.',
    objectives: [{ id: 'reach', type: 'reach', target: 'lighthouse', text: 'Bring the crystals to the lighthouse' }], rewards: { xp: 200, flags: { ending: true } } },
  { id: 'chest', title: 'Older Than Bram', description: 'Open the ancient chest in the north-west ruins.', requires: 'bram_key',
    objectives: [{ id: 'open', type: 'custom', target: 'ruin_chest', text: 'Open the chest in the ruins' }], rewards: { xp: 50 } },
];
