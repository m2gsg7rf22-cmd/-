// Game spec: the single source of truth for composeGame(), GDD.md, tasks.json and playtest.json.
// Edit, then run: node tools/gameforge.mjs gdd . && node tools/gameforge.mjs plan .
export const SPEC = {
  "id": "recipes-lab",
  "title": "Recipes Lab",
  "genre": "action",
  "seed": 5,
  "pitch": "Test bed that exercises every recipe in references/recipes.md.",
  "world": {
    "type": "arena",
    "biome": "volcanic",
    "size": 260
  },
  "player": {
    "mode": "onfoot",
    "combat": true,
    "hp": 200
  },
  "npcs": [
    {
      "id": "ada",
      "name": "Ada",
      "wander": 0,
      "offset": [
        3,
        6
      ]
    }
  ],
  "enemies": [],
  "goal": {
    "type": "explore",
    "label": "Try every recipe"
  },
  "music": "tension"
};
