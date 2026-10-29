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
| 1 | Character Generation Engine | `engine/humans.js`, `engine/character/{human,human-data,skin,hair,clothing,archetypes}.js` | `tests/unit/humans.test.mjs`, `tools/bench-characters.mjs` (11/11) | ממומש ונבדק. LOD (decimate) וסימולציית בד (`Cloth`, גלימות/דגלים) נוספו. פער: שיער סיבים |
| 2 | Procedural 3D Modeling Engine | **`engine/modeling/`** (SDF + Surface Nets, L-system/turtle, space colonization, cards/paint, K), `tools/model.mjs` (לולאת ביקורת: מדדים + גיליון 4 זוויות + GLB), `references/modeling.md`, דוגמאות ב־`skills/gameforge/models/`; `engine/geometry/*` | `modeling.test.mjs` (6), `bench-vehicles` (7/7) | ממומש. **Claude יוצר מודלים בעצמו**. בדיקה עיוורת: ערבה בוכייה ב־5 סבבים (`docs/benchmarks/skill-blind-tests/`), ו־11 פערים שנמצאו תוקנו |
| 3 | Animation & Rigging | `engine/animation/*` (כולל **`ik.js`**: two-bone/CCD, foot IK, look-at, hand IK; **`ragdoll.js`**: Verlet ragdoll), **`tools/anim.mjs`** (`gameforge anim`: בדיקות + גיליונות שלבים), `references/animation.md` (קונבנציות מדודות), דוגמאות ב־`skills/gameforge/anims/` | unit (כולל דוגמה שבורה שנתפסת) | **Claude כותב אנימציות בעצמו**. foot IK ו־ragdoll מומשו (`tools/bench-ik.mjs`). פערים: אנימציית קימה, self-collision ב־ragdoll |
| 4 | World Generation | `engine/world/*`, `K.world`, **`engine/world/facade.js`** (דקדוק חזיתות: `K.building`/`K.streetBlock`, 5 סגנונות), **`gameforge scene`**, דוגמאות `skills/gameforge/scenes/`, `models/street-block.model.js` | playtests + review + `facade.test.mjs` | ממומש, כולל חזיתות עם גיאומטריה אמיתית. פער: פנים מבנים |
| 5 | Rendering & Materials | `engine/render/*` | canvas checks | ממומש. פערים: SSAO, אמת מידה ויזואלית לסביבה |
| 6 | Physics & Gameplay | `engine/physics/*`, `engine/gameplay/*` | unit + playtests | ממומש |
| 7 | Narrative & Quest | `engine/gameplay/narrative.js`, **`engine/gameplay/story.js`** (מהדר + בודק סיפור), **`tools/story.mjs`** (`gameforge story`: גרף PNG, story bible, סימולציית playthroughs, בדיקות), `references/narrative.md`, דוגמה `skills/gameforge/stories/heist.story.js`, `spec.story` ב־composer | `story.test.mjs` (7) + playtest עשן | **Claude כותב סיפור, דמויות, משימות ודיאלוג מסתעף בעצמו ומאמת אותם**. פער: שיפוט איכות הכתיבה עצמה, cutscenes מתוך הסקריפט |
| 8 | NPC Intelligence | `engine/ai/behavior.js` | unit | ממומש. פערים: navmesh, לוחות זמנים יומיים |
| 7 | Narrative & Quest | `engine/gameplay/narrative.js`, `tools/lib/design.mjs` | unit + playtests | ממומש (פורמט דיאלוג/משימות). פער: מחולל עלילה מתוך spec |
| 8 | NPC Intelligence | `engine/ai/behavior.js`, `engine/ai/schedules.js` | unit + open-world scene | ממומש (כולל לוחות זמנים יומיים). פער: navmesh |
| 9 | Audio Generation | `engine/audio/audio.js` (+FM, pluck, defineSfx, רינדור offline), **`gameforge sound`** (WAV + ספקטרוגרמה + בדיקות), `references/audio.md`, דוגמאות ב־`skills/gameforge/sounds/` | review checks | **Claude מעצב צלילים בעצמו** (שיפוט לפי ניתוח, לא שמיעה) |
| 10 | QA & Visual Evaluation | `tools/playtest.mjs` (`--query`), `tools/visual-diff.mjs`, `tools/report.mjs`, `tools/bench-*.mjs` | `visual-diff.test.mjs` | ממומש, כולל רגרסיה ויזואלית מול baseline |

## יומן (חדש למעלה)
- **v0.4.2**: `ShoulderedWeapon` משולב אוטומטית ב־WeaponSystem; `gameforge visual-diff`; ‏`decimate`/LOD לבני אדם; דקדוק חזיתות (`K.building`); סימולציית בד (`Cloth`, `Cloth.cape`). ‏unit 95/95.
- **v0.4.1**: מוזגו IK + ragdoll ופלטפורמר + מרוצים. ריסים מרונדרים. `ShoulderedWeapon` לנשק ארוך על דמויות. בדיקות: unit 88/88, platformer 19/19, race-track 18/18, shooting-range 42/42, open-world 32/32, ashen-vale 22/22.
- **v0.3.4**: יכולת נרטיב: פורמט `*.story.js`, מהדר ל־quests + dialogue, `gameforge story` (בדיקות גרף/דגלים/משימות/ענפים/דמויות/קצב/מקוריות + סימולציה), מסמך שיטה ודוגמת שוד מקורית (3 מערכות, 9 משימות, 3 סופים).
- **v0.4 (open world)**: מערכות עולם פתוח כמודולים כלליים: `world/streaming.js` (ChunkManager, LODGroup, impostor), `ai/schedules.js` (לוחות זמנים יומיים, בריחה וחזרה, קפיצות זמן), `gameplay/wanted.js` (heat 0–5, רודפים, קו ראייה, cooldown, כוכבים ב־HUD דרך `ui.stars`), `world/crowd.js` (הולכי רגל על מדרכות עם LOD: אדם ריאליסטי ← בובה ← מוסתר). נוסף ל־humans.js נתיב `lod:'crowd'`, וגם `cloneHuman` ו־`mergeGarments`. בדיקות: `openworld.test.mjs` (7), סצנה `tests/scenes/open-world` (32/32), `tools/bench-crowd.mjs`. תיעוד: `references/open-world.md`.
- **v0.3.4**: שכבה פרוצדורלית אחרי ה־mixer לשני ה־rigs: two-bone IK אנליטי עם pole ו־CCD, foot IK על שטח לא אחיד (ברירת מחדל לבני אדם ריאליסטיים על heightfield), look-at עם מגבלות והחלקה (NPC מסתכלים על השחקן), hand IK ואחיזה בשתי ידיים, ragdoll מסוג Verlet (`ragdollOnDeath`). בדיקות: `tests/unit/ik.test.mjs`, ויזואלי: `sandbox/ik.html` ו־`tools/bench-ik.mjs` (`docs/benchmarks/ik/`).
- **v0.3.3**: 3 בדיקות עיוורות עברו (ערבה, רובה, הליכת זומבי), וכל הפערים שנמצאו תוקנו. בין היתר: באג בתיעוד של סימן `foot`, `ease` לא מוגבל, `groundFeet`, גיליונות אורתוגרפיים עם תוויות, `K.socket` וחומרים, מסגור ביקורת לפריטים קטנים.
- **v0.3.2**: יכולת סאונד (`gameforge sound`). רצות שתי בדיקות עיוורות: רובה מדע בדיוני (model) והליכת זומבי (anim).
- **v0.3.1**: בדיקה עיוורת ראשונה הצליחה (ערבה). נוספו `cardStrip`, `curve`, פירוט משולשים לכל רשת, גיליון ביקורת עם 6 תצוגות, `gameforge anim` ו־`gameforge scene`, ומתכונים לצמיחה נפולה.
- **v0.3**: כיוון מתוקן לפי המשתמש: לא מודלים מוכנים, אלא יכולת. Modeling Kit, `gameforge model` (רינדור ביקורת ומדדים), מסמך שיטה ו־checklist, 4 סקריפטים לדוגמה, תדריך 3D Artist מעודכן. (מחולל העצים `geometry/trees.js` נשאר כמימוש ברירת מחדל ל־populate.)
- **v0.2**: בני אדם ריאליסטיים (MakeHuman CC0), עור, עיניים, שיער, בגדים ונעליים פרוצדורליות, retargeting ו־BVH, שילוב ב־Player/NPC/Enemy ובתבנית. benchmark לדמויות. רכבים v2 (9 סוגים) ו־benchmark לרכבים. ההדגמות הועברו ל־`examples/`. התקנה בפקודה אחת (`install.sh`, נבדקה ב־HOME נקי). תיעוד: characters.md, ARCHITECTURE, CAPABILITIES, LIMITATIONS, ROADMAP, THIRD_PARTY (MakeHuman CC0).
- **v0.1**: מנוע, כלים, Skill, 17 סוכנים, 4 הדגמות ו־recipes-lab, כולם עם playtests.

## מצב בדיקות אחרון
unit 33/33 · כל ה־playtests ב־examples עברו (source + dist) · bench-characters 11/11 · bench-vehicles 7/7.

## הצעד הבא
0. ✔ נפתר: `ShoulderedWeapon` (קת בכתף, סיבוב גו, cheek weld, IK לשתי הידיים; מצבי aim/ready/hip). נשאר: חיבור אוטומטי ל־ShooterController עבור בני אדם ריאליסטיים.
1. בדיקות עיוורות לסאונד ולסצנה. לתקן כל פער שיימצא.
2. אותו עיקרון ("יכולת, לא תוצרים") לשאר התחומים: סביבה/עולם, אנימציה (כתיבת clips + גיליון ביקורת), חומרים/שיידרים, סאונד.
3. World: כלי ביקורת לסצנה שלמה (`gameforge scene`) + שיטת עבודה לבניית עולם, חזיתות מבנים, טקסטורת פרטים לשטח.
4. Narrative generator: מחולל עלילה, דמויות ומשימות מתוך spec, כמודול כללי עם בדיקות.
5. ✔ LOD לבני אדם: `decimate` (QEM half-edge, שומר UV/skin/morphs) + `decimateHuman`, ‏28k→7k משולשים ב־0.25 בלי חדירת שכבות. זמין גם כ־`K.decimate` למודלים.
6. ✔ QA: `gameforge visual-diff` (השוואת פיקסלים מול baseline, מפת הבדלים, `--update`).
