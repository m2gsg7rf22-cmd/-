# מבחן עיוור: GTA-like vertical slice עם ה־Skill של GameForge

**תאריך:** 2026-10-29 · **בסיס:** `gameforge-aaa` (31dd451) · **תיקייה:** `tests/blind/gta-slice/`
**שיטה:** בניתי רק לפי `skills/gameforge/SKILL.md` וה־references. לא קראתי קוד מנוע (`engine/`). כל מקום שבו נאלצתי לקרוא קוד של סצנת בדיקה, לבדוק API בזמן ריצה או לנחש, רשום למטה כ־GAP.
לא שיניתי קבצים ב־`engine/` או ב־`skills/`.

## מה נבנה

"Borrowed Shine" הוא IP מקורי: העיר Port Solana, הרובע Cobalt Row, הדמויות Dez Varga, Lu Anwen ו־Tomas Ruiz.

- **עולם:** רובע של 4×4 בלוקים (`generateCity` דרך `composeGame`) עם כבישים, מדרכות, מעברי חצייה ובניינים. השעה 12:12 (יום).
- **תנועה וחניות:** 6 מכוניות traffic, ו־4 מכוניות חונות שאפשר לנהוג בהן (`GF.car` + `GF.Vehicle`): קופה זהובה, סדאן, SUV וואן.
- **הולכי רגל:** 80 הולכי רגל עם לו"ז יומי (`GF.Crowd`). 4 תבניות ריאליסטיות בטווח הקרוב, מנקינים בטווח הבינוני, והשאר מוסתרים. הם נמלטים כשמתבצע פשע.
- **השחקן:** אדם ריאליסטי (MakeHuman) שמסתובב ברגל בגוף שלישי. `ShooterController` עם אקדח ורובה. הרובה נראה מוכנס לכתף בזמן כיוון (ראו `06-aim-rifle.png`).
- **רכבים:** מקש F נכנס לרכב ויוצא ממנו (גניבה). בזמן נהיגה פועלים `ChaseCamera` ומד מהירות.
- **Wanted/heat:**
  - `WantedSystem` מגיב לגניבת רכב (`vehicleTheft`) ולירי (`shooting`).
  - שוטרים רגליים ריאליסטיים במדים רודפים אחרי השחקן, ומרמה 2 מצטרפת ניידת עם lightbar שנוסעת לעבר השחקן.
  - כוכבים ב־HUD.
  - כשהשחקן יוצא מקו הראייה הרמה דועכת חזרה ל־0.
- **סיפור:** `story/borrowed-shine.story.js` כולל 2 משימות עם הסתעפות `kept_word` / `squeezed_lu`. ההסתעפות מתכנסת למשימת foldback בשם `Payday`, ושם Lu מגיבה לפי הבחירה.
- **מודל ייעודי:** `assets/halfmoon-garage.model.js` (מוסך הצבע), נבדק עם `gameforge model` ומשולב בסצנה.
- **מסמכי תכנון:** `GDD.md` (כולל טבלת הפירוק של aaa-blueprints) ו־`tasks.json` (נוצרו ב־`gdd`/`plan`).

## תוצאות כלי הסקירה (פלט אמיתי)

### `gameforge story`
הפלט המלא נמצא ב־`tests/blind/gta-slice/story/review/story-review.txt`.
```
▶ borrowed-shine: 2 missions · 3 characters · 5 conversations · 15 lines · 5 choice points · 2 branches · 10.7 words/line
  ... 30 × PASS (כולל "simulated playthroughs reach the ending (first, last, every branch)" ו-"every branch is playable to the ending")
  WARN  custom objectives need game code (report("custom", target))  (borrowed_shine.steal; borrowed_shine.heat)
```
ה־WARN מכוון: שני ה־objectives מדווחים מקוד המשחק, והפלייטסט מוכיח שהדיווח עובד.
קבצי הסקירה: `story/review/borrowed-shine.graph.png` ו־`borrowed-shine.bible.md`.

### `gameforge model`
גיליון המבטים: `tests/blind/gta-slice/assets/review/halfmoon-garage.views.jpg`.
```
  PASS  no NaN/Infinity positions  (0 bad values)
  PASS  has geometry  (2288 triangles)
  PASS  plausible size (1 cm … 500 m)  (8.1 × 4.6 × 9.005 m)
  PASS  rests on the ground (min.y ≈ 0)  (min.y = 0.000)
  PASS  few degenerate triangles (< 1 %)  (0)
  WARN  solid meshes are closed (open edges)  (6 open edges ...)   ← דיסק חצי־ירח פתוח בשלט, מכוון
  PASS  draw calls ≤ 8 per asset  (7 materials)
  PASS  renders without page errors  (ok)
```
בסבב הראשון היו 11 חומרים (WARN), וצמצמתי אותם ל־7.

### `gameforge validate`
```
  ok  import graph OK: 97 modules
  ok  spec OK: Borrowed Shine
  ok  task graph OK
  ok  24/24 procedural props valid
```

לא השתמשתי ב־`gameforge anim`, `sound`, `scene` ו־`cinematic`: לא כתבתי קליפ, צליל או סצנה ייעודיים, ולכן לא היה מה לסקור בהם.

## Playtest: `node tools/playtest.mjs tests/blind/gta-slice`

### איכות low (`tests/blind/gta-slice/playtest-low.txt`)
```
  PASS  game boots and exposes window.__GF  (19942 ms)
  PASS  title menu on boot  (menu)
  PASS  game starts  (playing)
  PASS  player grounded on the sidewalk at spawn  (true)
  PASS  traffic cars drive the streets  (6)
  PASS  30+ pedestrians with daily schedules  (80)
  PASS  realistic pedestrian templates built  (4)
  PASS  street frame renders  ({"mean":102.1,"std":60.4,"colors":126})
  PASS  W walks the player (third-person on foot)  (true)
  PASS  pedestrians walk between schedule places  (true)
  PASS  E talks to Lu (dialogue opens)  (dialogue)
  PASS  dialogue advances to the job pitch (choices)  (lu_offer__pitch)
  PASS  mission 'Borrowed Shine' starts from the story dialogue  (active)
  PASS  dialogue closes  (playing)
  PASS  no wanted level before a crime  (0)
  PASS  F enters (steals) the parked gold coupe  (gold coupe)
  PASS  objective 'Steal the gold coupe' reported  (true)
  PASS  car theft raises the wanted level  (1)
  PASS  the stolen car accelerates (W/throttle)  (122.4)
  PASS  the car drives down the street  (50.4)
  PASS  brake slows the car to a crawl (< 15 km/h)  (11.4)
  PASS  F exits the car on foot  (null)
  PASS  switch to the rifle  (rifle)
  PASS  right mouse aims over the shoulder  (true)
  PASS  rifle fires  (6)
  PASS  ammo decreases  (true)
  PASS  gunfire raises the wanted level further  (2)
  PASS  shooting registered as a crime  (true)
  PASS  police officers spawn and pursue  (3)
  PASS  officers have pursuit goals  (true)
  PASS  a police cruiser joins at level 2  (true)
  PASS  nearby pedestrians react to the crime  (true)
  PASS  the cruiser drives toward the player  (true)
  PASS  back in the coupe  (gold coupe)
  PASS  out of sight: police switch to search  (search)
  PASS  wanted level decays to zero after hiding  (0)
  PASS  pursuers despawn when clear  (0)
  PASS  objective 'Lose the police' reported  (true)
  PASS  driving the coupe to Halfmoon completes the reach objective  (true)
  PASS  Ruiz offers the branch choice  (ruiz_drop__choose)
  PASS  branch chosen (squeeze Lu): mission 1 complete  (complete)
  PASS  foldback mission 'Payday' starts automatically  (active)
  PASS  Lu remembers the branch (squeezed_lu variant)  (lu_payday__paid)
  PASS  mission 'Payday' completes  (complete)
  PASS  story ending reached (goal done)  (true)
  PASS  frame within open-world budget (< 900 draw calls, < 2.5 M triangles)  (true)
  PASS  no runtime errors  (none)
  ✔ 47/47 checks passed in 226.4s  metrics={"fps":22.67,"frameMs":50,"calls":476,"triangles":423615,...,"tier":"low","gpu":"ANGLE (... SwiftShader ...)","errors":0,...}
```

### איכות medium (`tests/blind/gta-slice/playtest-medium.txt`)
```
  ✔ 47/47 checks passed in 461.9s  metrics={"fps":44,"frameMs":66.3,"calls":1,"triangles":1,...,"tier":"medium",...,"errors":0,...}
```
ב־medium ה־metrics מראים `calls:1, triangles:1`, כנראה רק מעבר ה־post-processing. בדיקת התקציב עוברת שם באופן טריוויאלי, ולכן היא לא אמינה (ראו GAP 15). ה־fps נמדדו על SwiftShader, לא על GPU אמיתי, ואינם מייצגים.

### הסתייגויות כנות על הפלייטסט
- **cheats לטלפורט:** ה־cheats `nearNpc`, `nearCoupe`, `carTo` מקצרים את הדרך בין המקומות. הנסיעה, ההליכה, הירי והדיאלוג עצמם רצים דרך קלט אמיתי (`hold`/`press`).
- **בריחה מהמשטרה:** ה"בריחה" היא טלפורט של הרכב אל מחוץ לטווח הראייה, ואחריו 3,600 פריימים של דעיכה אמיתית.
- **בדיקת התגובה של הולכי הרגל:** בדיקת "pedestrians react" כוללת fallback שעובר גם כשאין עדים בטווח, כך שהיא חלשה.
- **שוטרים:** השוטרים לא יורים. הם רק רודפים ופוגעים בנזק קטן במגע. אין אנימציית מעצר.
- **build:** לא הרצתי `gameforge build` ולא את הפלייטסט על ה־dist.

## צילומי מסך (בדקתי כל אחד בעיניים)

- **medium:** `tests/blind/gta-slice/screenshots/01-title.png` … `10-ending.png`
- **low:** `tests/blind/gta-slice/screenshots-low/*.png`

מה מצאתי ותיקנתי במהלך העבודה:
- **מגדר השחקן:** הגיבור נבנה בהתחלה כאישה (`sex: 0`). שיניתי ל־`sex: 1`.
- **NPCs:** ל־Lu ול־Ruiz לא היה `look`, והם קיבלו מראה ברירת מחדל. הוספתי להם.
- **מד מהירות:** הופיע גם ברגל. הסתרתי אותו.
- **prompt:** ה־prompt של F נשאר על המסך בזמן נהיגה. ניקיתי אותו.
- **מצלמה צמודה לקיר:** בנקודת ה־spawn ואצל Lu המצלמה נצמדה לקיר בניין. הזזתי את המיקומים.
- **דוכן:** הדוכן נראה כמו לוח זכוכית שקוף. הסרתי אותו.
- **שוטרים:** שוטרים נכנסו לתוך הגוף של השחקן. הוספתי `separateActors`.
- **מיקום Ruiz:** Ruiz עמד באמצע פארק בלי שום מבנה. בניתי את מודל המוסך.
- **רחוב ריק:** הרחוב נראה ריק בשעה 11:00, כשכל הולכי הרגל במצב `perform`/`inside`. העברתי ל־12:12 והגדלתי את הקהל ל־80.

בעיות שנשארו (MINOR):
- הז'קט נראה מחוספס כמו עור תנין. ניסיתי `material: 'canvas'` ולא ראיתי שינוי.
- בתסרוקת `short` יש פס משונה.
- השוטרים עומדים צמודים לשחקן בלי שום פעולה.
- במסך הסיום עדיין רואים מאחור את באנר "NEW QUEST Payday" ואת תיבת הדיאלוג.

## רשימת GAPs

1. **ערבוב composeGame עם ShooterController גורם לתנועה כפולה. חומרה: MAJOR.**
   - **מה נדרש:** שחקן ריאליסטי עם נשק בתוך משחק שבנוי על `composeGame`, שהוא ה־workflow של SKILL.md.
   - **איפה חיפשתי:** SKILL.md, engine-api.md ("Composer"), shooter.md ("Minimal setup").
   - **מה חסר או שגוי:** ה־composer קורא ל־`player.control(dt)`, ו־`ShooterController.control()` קורא לה שוב. התוצאה היא מהירות כפולה (מדדתי 10.07 מ' לעומת 4.87 מ'). אם מבטלים את `player.control`, השחקן לא זז בכלל. אין שום תיעוד לשילוב.
   - **מעקף:** gate על `player.control` שמאפשר רק את הקריאה מתוך ה־shooter.
   - **הצעה:** `SPEC.player.weapons` / `shooter: {...}` ב־composer, או `composeGame(..., { playerController: 'shooter' })`, ותיעוד ב־shooter.md.

2. **אין כניסה ויציאה מרכב לשחקן רגלי. חומרה: MAJOR, כמעט BLOCKER.**
   - **מה נדרש:** "enter/drive a car".
   - **איפה חיפשתי:** כל ה־references. ב־spec-reference יש `player.mode: onfoot | vehicle`, ובמצב `onfoot` מתקבל `vehicle: null`.
   - **מה חסר:** אין API או מתכון לכניסה ויציאה, להחלפת מצלמה, להסתרת הגוף ולהעברת הקלט.
   - **מעקף:** כתבתי את כל זה בעצמי. בדרך:
     - `GF.ChaseCamera` לא מופיע ב־engine-api.md. מצאתי אותו רק בקריאת `tests/scenes/race-track/main.js`, והתיעוד מפנה רק ל־`playtest.json` של הסצנה.
     - החלפת `app.cameraRigs` לא מתועדת.
     - `vehicle.resetOnRoad(pos, yaw)` לא מתועד.
   - **הצעה:** מודול `VehicleSeat`/`enterVehicle(player, vehicle)` במנוע, מתכון ב־recipes.md, ו־`ChaseCamera` ב־engine-api.

3. **אין ממשק קלט מתועד ל־Vehicle עבור AI, ונוהגי הכיוונים לא מתועדים. חומרה: MAJOR.**
   - **מה נדרש:** ניידת משטרה שנוסעת לבד.
   - **איפה חיפשתי:** engine-api (`.drive(input)`), genres.md.
   - **מה חסר:** לא כתוב מה `drive` מצפה לקבל. ניחשתי stub עם `{ value, held, pressed }` על בסיס `setVirtual` בסצנת המירוץ, וזה עבד. גם מוסכמת ה־yaw (forward = sin/cos) לא מתועדת. בנוסף, `brake` הופך לרוורס כשהרכב נעצר, וגם זה לא מתועד.
   - **הצעה:** לתעד את ה־input contract, להוסיף `GF.VehicleInput` לשימוש AI, ולהוסיף `PursuitDriver` בסיסי. open-world.md אומר במפורש ש"cars/roadblocks are game-level work".

4. **objective מסוג `talk` מושלם כבר ברגע האינטראקציה, ולכן שיחת `when: 'active'` של אותו NPC לא מוצגת. חומרה: MAJOR.**
   - **מה נדרש:** משימת foldback שבה Lu מגיבה לבחירה.
   - **איפה חיפשתי:** narrative.md.
   - **מה שגוי:** במשחק, `talk lu` דווח לפני שנבחרה השיחה. המשימה הושלמה מיד, ו־Lu אמרה את ה־idle (`lu__idle`) במקום את הוריאנט של הענף.
   - **בעיה קשורה בכלי `gameforge story`:** objective מסוג `talk` עם `after` שתלוי ב־custom גרם ל־"every branch is playable" להיכשל (0/2), למרות שהקומפילציה הייתה תקינה. הסימולטור לא שיחק את שיחת ההסתעפות. גם זה לא מוסבר בתיעוד.
   - **מעקף:** objectives מסוג `flag` שמוגדרים בבחירות.
   - **הצעה:** לתעד ש־talk מושלם בפתיחת השיחה, או להשלים אותו רק בסוף השיחה. ב־narrative.md להמליץ על `flag` לשיחות הסתעפות.

5. **מיקום NPCs ומקומות בלי `kind`. חומרה: MINOR.**
   - **מה שגוי:** מיקומים בלי `kind` לא הופכים ל־landmarks. ה־NPCs שלהם (`at: 'taqueria'`) הוצבו בנקודות אקראיות, למשל (-78, -70).
   - **מה חסר בתיעוד:** איך מציבים NPC בקואורדינטות. ניחשתי `npc.ctrl.teleport`.
   - **מה חסר נוסף:** objective מסוג `reach` למיקום בלי landmark לא מושלם אוטומטית. דיווחתי ידנית עם `quests.report('reach', id)`, וזה לא מתועד.
   - **הצעה:** `at: [x, z]` או `x/z` ב־locations, ותיעוד של `report('reach')`.

6. **משמעות `sex` (0/1) לא מתועדת. חומרה: MINOR.** characters.md כותב רק `sex: 0..1`. גיליתי מ־`docs/benchmarks/characters/REPORT.md` ש־1 הוא גבר, אחרי שהגיבור יצא אישה.

7. **ייבוא K למודלים בתוך משחק. חומרה: MINOR.**
   - **מה שגוי:** modeling.md אומר "K = engine/modeling/index.js". `import * as K` קרס עם `K.MeshBuilder is not a constructor`, כי K הוא default export.
   - **מעקף:** `import K from '.../modeling/index.js'`.
   - **הצעה:** דוגמת import מפורשת ב־modeling.md.

8. **API לא מתועד של `ui.prompt` וה־widgets. חומרה: MINOR.**
   - החתימה `prompt(text, key = 'E')` ואיך מסתירים prompt לא מתועדים. בדקתי בזמן ריצה עם `toString`.
   - הסתרת `speedometer` לא מתועדת. השתמשתי ב־`widget.el`.

9. **קידום דיאלוג בפלייטסט. חומרה: MINOR.** testing.md לא מסביר ש־typewriter דורש שתי לחיצות לכל צומת, ולא את הפורמט של `state().dialogue` (`<convId>__<node>`). גיליתי בניסוי.

10. **רשימת `GF.CRIMES` ו־`GF.WANTED_LEVELS` לא בתיעוד. חומרה: MINOR.** המפתחות (`vehicleTheft`, `shooting`…) והספים `[0,1,3,6,10,15]` נבדקו בזמן ריצה. נוסף על כך, גניבה בלי עדים נותנת רק 30% heat, כלומר רמה 0. זה כתוב, אבל אין המלצה למקרה של אזעקת רכב.

11. **`TrafficSystem` ו־`game.traffic` מתועדים חלקית. חומרה: MINOR.** קיימים `.cars`, `.update` ו־`.collide`, ולא ברור אם אפשר לחטוף מכונית traffic. אצלי אי אפשר, ולכן השתמשתי במכוניות חונות.

12. **קהל "מת" בשעות העבודה. חומרה: MINOR.** בשעה 11:00 כל ה־34 היו `perform`/`inside`, ואף אחד לא הלך. open-world.md מבטיח "2-6 visible pedestrians by day" אבל לא מסביר שזה תלוי בשעה ובכמות. צריך המלצה ל־count לפי גודל העיר.

13. **פערים ב־CLI. חומרה: MINOR.**
    - `gameforge help` לא מציג את `model`, `scene` ו־`anim`.
    - `gameforge model` בלי ארגומנט קורס עם `The "paths[0]" argument must be of type string`.
    - ל־`playtest.mjs` אין אופציה לקובץ תרחיש חלופי. את `--query` מצאתי רק ב־shooter.md.

14. **`gameforge gdd` מתעלם מה־story ומהמודולים. חומרה: MINOR.** ה־GDD יוצא עם "None specified" לדמויות ולמשימות כשה־story מוגדר דרך `SPEC.story` ב־`main.js`. הוספתי את טבלת הפירוק ידנית.

15. **`metrics()` ב־medium מחזיר `calls:1, triangles:1`. חומרה: MINOR.** כנראה נמדד רק מעבר ה־post. לכן בדיקת התקציב ב־medium חסרת משמעות, ואין לזה תיעוד. הצעה: לצבור `renderer.info` על כל המעברים.

16. **חומר לבגד. חומרה: MINOR.** characters.md מונה חומרים (`canvas`, `leather`…) אבל לא מראה איך בוחרים חומר לפריט. `material: 'canvas'` ל־jacket לא שינה את המראה המחוספס.

17. **אין מעצר או ירי של שוטרים כחלק מ־Wanted. חומרה: MINOR, מתועד כמגבלה.** השוטרים הם Actors שרודפים. לחיבור ל־`RangedEnemy` אין מתכון.

**סיכום:** אין BLOCKER אמיתי. הכול נבנה בלי לשנות את המנוע. אבל שני הפערים המרכזיים, נהיגה מרגל (2) ושילוב composer עם shooter (1), חייבו קוד משמעותי ופתרונות עוקפים, שסוכן אחר עלול לא למצוא.

### קריאת מקור / ניחושים (לשקיפות)
- **קוד של סצנות בדיקה:** קראתי את `tests/scenes/open-world/main.js` ואת `tests/scenes/shooting-range/main.js`, שהתיעוד מפנה אליהן. קראתי גם את `tests/scenes/race-track/main.js`, שהתיעוד מפנה רק ל־`playtest.json` שלה.
- **בדיקות API בזמן ריצה:** `GF.CRIMES`, אב־הטיפוס של `TrafficSystem`, השדות של `city`, `ui.prompt.toString()`, ורשימת ה־exports של `engine/modeling/index.js`.
- **קבצים שנוצרו מכלים:** `review/*.compiled.json` של `gameforge story`, ושלד `gameforge new` בתיקייה זמנית.

## סטטוס תיקון הפערים (אחרי הבדיקה)
| # | פער | סטטוס |
|---|---|---|
| 1 | composeGame + ShooterController = תנועה כפולה | ✔ תוקן: `spec.player.weapons` מחבר את ShooterController, ו־`game.controlOnFoot` הוא hook רשמי (shooter.md, spec-reference.md) |
| 2 | אין כניסה/יציאה מרכב ברגל | בעבודה אצל סוכן הרכבים (מערכת כללית לכל סוגי הרכבים + תיעוד ChaseCamera/cameraRigs/resetOnRoad) |
| 3 | חוזה `Vehicle.drive` ונהיגת AI | בעבודה אצל סוכן הרכבים |
| 4 | objective מסוג talk נסגר לפני הדיאלוג; הסימולטור לא הגיע לסוף | ✔ תוקן במשחק ובסימולטור (נסגר בסוף השיחה). story עכשיו 4/4 ריצות מגיעות לסוף |
| 5 | מקום בלי `kind` | ✔ תועד (narrative.md) |
| 6 | משמעות `sex` | ✔ תועד (characters.md) |
| 7 | ייבוא K | ✔ תועד (engine-api.md) |
| 8 | `ui.prompt` והסתרת widgets | ✔ תועד (engine-api.md) |
| 9 | typewriter בפלייטסט | ✔ תועד (testing.md) |
| 10 | CRIMES / WANTED_LEVELS | ✔ תועד (open-world.md) |
| 11 | TrafficSystem API | ✔ תועד (open-world.md) |
| 12 | צפיפות קהל לפי שעה | ✔ תועד (open-world.md) |
| 13 | CLI: help, model בלי ארגומנט, תרחיש חלופי | ✔ תוקן: help מציג את כל כלי הביקורת, usage במקום קריסה, `playtest --scenario` |
| 14 | gdd מתעלם מהסיפור | ✔ תוקן: `gameforge gdd` מוצא `*.story.js` וסקריפטי נכסים |
| 15 | metrics ב־medium = calls:1 | ✔ תוקן: הספירה מצטברת על כל המעברים בפריים |
| 16 | חומר בגד | ✔ תועד (רשימת חומרים והבדלים) |
| 17 | שוטרים יורים/מעצר | ✔ מתכון (open-world.md); מימוש מלא נשאר פער |
