# PROGRESS — נקודת המשך קבועה

> קובץ זה מתעדכן בכל שלב. סוכן שממשיך עבודה: קרא את הקובץ הזה, את CLAUDE.md ואת AGENTS.md, ואז המשך מ"הצעד הבא".
> כלל: תקשורת עם המשתמש בעברית בלבד. המוצר הוא ה־Skill והטכנולוגיה, לא משחק.
> ענף העבודה: `gameforge-aaa` במאגר `m2gsg7rf22-cmd/-`. יצירת מאגר חדש נחסמה (403), ראו LIMITATIONS.md.

## הפרדה בין טכנולוגיה להדגמות
| שכבה | מיקום | סטטוס |
|---|---|---|
| Skill וסוכנים | `skills/gameforge/` (SKILL.md, references, 17 סוכנים), `.claude/agents/`, `tools/lib/agents-def.mjs` | פעיל |
| מנוע (ספריות) | `engine/` | פעיל |
| כלים (CLI, bundler, בדיקות, benchmarks, התקנה) | `tools/`, `install.sh` | פעיל |
| תבנית פרויקט | `templates/project/` | פעיל |
| הדגמות (בדיקות אינטגרציה בלבד, לא לפתח) | `examples/` | מוקפא |

## עשר המערכות: מיפוי לקוד ומצב
| # | מערכת | קוד | בדיקות | מצב |
|---|---|---|---|---|
| 1 | Character Generation Engine | `engine/humans.js`, `engine/character/{human,human-data,skin,hair,clothing,archetypes}.js` | `tests/unit/humans.test.mjs`, `tools/bench-characters.mjs` (11/11) | ממומש ונבדק. פערים: LOD לקהל, שיער סיבים, סימולציית בד |
| 2 | Procedural 3D Modeling Engine | `engine/geometry/{builders,props,buildings,vehicles,export}.js` | `content.test.mjs`, `tools/bench-vehicles.mjs` (7/7) | רכבים v2 נבדקו. פערים: מבנים, עצים, נכסי סביבה |
| 3 | Animation & Rigging | `engine/animation/{clips,animator,retarget,tween}.js` | unit, גיליונות walk/run/BVH | ממומש. פערים: foot IK, ragdoll, root motion |
| 4 | World Generation | `engine/world/{terrain,vegetation,water,city}.js` | unit + playtests | בסיסי. **הבא בתור לשדרוג** |
| 5 | Rendering & Materials | `engine/render/*` | canvas checks | ממומש. פערים: SSAO, אמת מידה ויזואלית לסביבה |
| 6 | Physics & Gameplay | `engine/physics/*`, `engine/gameplay/*` | unit + playtests | ממומש |
| 7 | Narrative & Quest | `engine/gameplay/narrative.js`, `tools/lib/design.mjs` | unit + playtests | ממומש (פורמט דיאלוג/משימות). פער: מחולל עלילה מתוך spec |
| 8 | NPC Intelligence | `engine/ai/behavior.js` | unit | ממומש. פערים: navmesh, לוחות זמנים יומיים |
| 9 | Audio Generation | `engine/audio/audio.js` | metric audioEvents | ממומש (סינתזה) |
| 10 | QA & Visual Evaluation | `tools/playtest.mjs`, `tools/report.mjs`, `tools/bench-*.mjs` | — | ממומש. פער: השוואת פיקסלים מול baseline |

## יומן (חדש למעלה)
- **v0.2**: בני אדם ריאליסטיים (MakeHuman CC0), עור, עיניים, שיער, בגדים ונעליים פרוצדורליות, retargeting ו־BVH, שילוב ב־Player/NPC/Enemy ובתבנית. benchmark לדמויות. רכבים v2 (9 סוגים) ו־benchmark לרכבים. ההדגמות הועברו ל־`examples/`. התקנה בפקודה אחת (`install.sh`, נבדקה ב־HOME נקי). תיעוד: characters.md, ARCHITECTURE, CAPABILITIES, LIMITATIONS, ROADMAP, THIRD_PARTY (MakeHuman CC0).
- **v0.1**: מנוע, כלים, Skill, 17 סוכנים, 4 הדגמות ו־recipes-lab, כולם עם playtests.

## מצב בדיקות אחרון
unit 33/33 · כל ה־playtests ב־examples עברו (source + dist) · bench-characters 11/11 · bench-vehicles 7/7.

## הצעד הבא
1. README מלא (התקנה, מבנה, מערכות, הוכחות).
2. World Generation v2: עצים איכותיים (ענפים עם L-system וכרטיסי עלים), חזיתות מבנים, טקסטורת פרטים לשטח. benchmark ויזואלי לסביבה (`tools/bench-world.mjs`).
3. Narrative generator: מחולל עלילה, דמויות ומשימות מתוך spec, כמודול כללי עם בדיקות.
4. LOD לבני אדם (קהל).
5. QA: השוואת פיקסלים מול baseline.
