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
| 2 | Procedural 3D Modeling Engine | **`engine/modeling/`** (SDF + Surface Nets, L-system/turtle, space colonization, cards/paint, K), `tools/model.mjs` (לולאת ביקורת: מדדים + גיליון 4 זוויות + GLB), `references/modeling.md`, דוגמאות ב־`skills/gameforge/models/`; `engine/geometry/*` | `modeling.test.mjs` (6), `bench-vehicles` (7/7) | ממומש. **Claude יוצר מודלים בעצמו**. בדיקה עיוורת: ערבה בוכייה ב־5 סבבים (`docs/benchmarks/skill-blind-tests/`), ו־11 פערים שנמצאו תוקנו |
| 3 | Animation & Rigging | `engine/animation/*`, **`tools/anim.mjs`** (`gameforge anim`: בדיקות + גיליונות שלבים), `references/animation.md` (קונבנציות מדודות), דוגמאות ב־`skills/gameforge/anims/` | unit (כולל דוגמה שבורה שנתפסת) | **Claude כותב אנימציות בעצמו**. פערים: foot IK, ragdoll |
| 4 | World Generation | `engine/world/*`, `K.world`, **`gameforge scene`** (מבט־על + 3 צילומים בגובה עיניים + תקציבים), דוגמה `skills/gameforge/scenes/` | playtests + review | ממומש. פערים: שיטת עבודה מפורטת לעולם פתוח, חזיתות מבנים |
| 5 | Rendering & Materials | `engine/render/*` | canvas checks | ממומש. פערים: SSAO, אמת מידה ויזואלית לסביבה |
| 6 | Physics & Gameplay | `engine/physics/*`, `engine/gameplay/*` | unit + playtests | ממומש |
| 7 | Narrative & Quest | `engine/gameplay/narrative.js`, `tools/lib/design.mjs` | unit + playtests | ממומש (פורמט דיאלוג/משימות). פער: מחולל עלילה מתוך spec |
| 8 | NPC Intelligence | `engine/ai/behavior.js` | unit | ממומש. פערים: navmesh, לוחות זמנים יומיים |
| 9 | Audio Generation | `engine/audio/audio.js` | metric audioEvents | ממומש (סינתזה) |
| 10 | QA & Visual Evaluation | `tools/playtest.mjs`, `tools/report.mjs`, `tools/bench-*.mjs` | — | ממומש. פער: השוואת פיקסלים מול baseline |

## יומן (חדש למעלה)
- **v0.3.1**: בדיקה עיוורת ראשונה הצליחה (ערבה). נוספו `cardStrip`, `curve`, פירוט משולשים לכל רשת, גיליון ביקורת עם 6 תצוגות, `gameforge anim` ו־`gameforge scene`, ומתכונים לצמיחה נפולה.
- **v0.3**: כיוון מתוקן לפי המשתמש: לא מודלים מוכנים, אלא יכולת. Modeling Kit, `gameforge model` (רינדור ביקורת ומדדים), מסמך שיטה ו־checklist, 4 סקריפטים לדוגמה, תדריך 3D Artist מעודכן. (מחולל העצים `geometry/trees.js` נשאר כמימוש ברירת מחדל ל־populate.)
- **v0.2**: בני אדם ריאליסטיים (MakeHuman CC0), עור, עיניים, שיער, בגדים ונעליים פרוצדורליות, retargeting ו־BVH, שילוב ב־Player/NPC/Enemy ובתבנית. benchmark לדמויות. רכבים v2 (9 סוגים) ו־benchmark לרכבים. ההדגמות הועברו ל־`examples/`. התקנה בפקודה אחת (`install.sh`, נבדקה ב־HOME נקי). תיעוד: characters.md, ARCHITECTURE, CAPABILITIES, LIMITATIONS, ROADMAP, THIRD_PARTY (MakeHuman CC0).
- **v0.1**: מנוע, כלים, Skill, 17 סוכנים, 4 הדגמות ו־recipes-lab, כולם עם playtests.

## מצב בדיקות אחרון
unit 33/33 · כל ה־playtests ב־examples עברו (source + dist) · bench-characters 11/11 · bench-vehicles 7/7.

## הצעד הבא
1. בדיקות עיוורות נוספות: כלי נשק (hard-surface), יצור עם אנימציה (anim), סצנה (scene). לתקן כל פער שיימצא.
2. אותו עיקרון ("יכולת, לא תוצרים") לשאר התחומים: סביבה/עולם, אנימציה (כתיבת clips + גיליון ביקורת), חומרים/שיידרים, סאונד.
3. World: כלי ביקורת לסצנה שלמה (`gameforge scene`) + שיטת עבודה לבניית עולם, חזיתות מבנים, טקסטורת פרטים לשטח.
4. Narrative generator: מחולל עלילה, דמויות ומשימות מתוך spec, כמודול כללי עם בדיקות.
5. LOD לבני אדם (קהל).
6. QA: השוואת פיקסלים מול baseline.
