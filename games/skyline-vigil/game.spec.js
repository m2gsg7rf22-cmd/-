// Game spec: the single source of truth for composeGame(), GDD.md, tasks.json and playtest.json.
// Edit, then run: node tools/gameforge.mjs gdd . && node tools/gameforge.mjs plan .
export const SPEC = {
  "id": "skyline-vigil",
  "title": "Skyline Vigil",
  "genre": "action",
  "pitch": "An original superhero night patrol: swing between towers, glide over the avenues and break up the gangs terrorising downtown.",
  "seed": 9,
  "references": [
    "Marvel's Spider-Man 2 (traversal ambition only — no characters, names or assets used)"
  ],
  "world": {
    "type": "city",
    "blocks": 5,
    "style": "neon",
    "maxFloors": 30,
    "traffic": 10,
    "timeOfDay": 17.9
  },
  "player": {
    "mode": "onfoot",
    "combat": true,
    "hp": 220,
    "look": {
      "seed": 3,
      "outfit": "suit",
      "top": 1714794,
      "bottom": 1054250,
      "accent": 3858687,
      "hairStyle": "short",
      "hair": 1052688,
      "cape": false
    }
  },
  "enemies": [],
  "npcs": [
    {
      "id": "rae",
      "name": "Dispatcher Rae",
      "look": {
        "seed": 21,
        "outfit": "casual",
        "coat": true,
        "top": 3816006,
        "hairStyle": "ponytail",
        "hair": 6957594
      },
      "wander": 0
    }
  ],
  "quests": [
    {
      "id": "streets",
      "title": "Take Back the Streets",
      "description": "Three gangs are holding intersections downtown. Break them up.",
      "objectives": [
        {
          "id": "k",
          "type": "kill",
          "target": [
            "thug",
            "grunt",
            "brute"
          ],
          "count": 9,
          "text": "Defeat gang members"
        }
      ],
      "rewards": {
        "xp": 200
      }
    },
    {
      "id": "beacons",
      "title": "Rooftop Relays",
      "description": "Re-activate the emergency relays on the rooftops.",
      "objectives": [
        {
          "id": "b",
          "type": "collect",
          "target": "relay",
          "count": 4,
          "text": "Activate rooftop relays"
        }
      ],
      "rewards": {
        "xp": 150
      }
    }
  ],
  "items": {
    "relay": {
      "name": "Relay activation"
    }
  },
  "goal": {
    "type": "quests",
    "quests": [
      "streets",
      "beacons"
    ],
    "label": "Secure downtown",
    "winTitle": "Downtown Secured",
    "winText": "The city sleeps safely tonight."
  },
  "music": "driving",
  "theme": {
    "accent": "#3ae0ff",
    "accent2": "#ff3a9a"
  },
  "attackTokens": 2,
  "art": {
    "style": "neon-noir stylized PBR",
    "heroAssets": [
      "hero suit",
      "rooftop relays",
      "neon towers"
    ]
  },
  "acceptance": [
    "player can swing between buildings",
    "glide and air-dash work",
    "gangs fight back and can be defeated",
    "rooftop relays can be reached and activated"
  ]
};
