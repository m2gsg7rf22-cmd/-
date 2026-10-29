// GameForge engine public API. Import from games as:
//   import * as GF from './engine/index.js';
export * as THREE from './vendor/three/three.module.js';
export { GameApp, ENGINE_VERSION } from './core/app.js';
export { RNG, Noise, hashString, clamp, lerp, smoothstep, damp, dampAngle, wrapAngle } from './core/rng.js';
export { EventBus } from './core/events.js';
export { GameLoop } from './core/loop.js';
export { Input, DEFAULT_BINDINGS, createTouchControls } from './core/input.js';
export { SaveSystem } from './core/save.js';
export { createRenderer, QUALITY, GradeShader } from './render/renderer.js';
export { Atmosphere } from './render/sky.js';
export { generateTexture, TEXTURE_KINDS, textureStats, seamError } from './render/textures.js';
export { MaterialLibrary, pbr, solid, emissive, glass, carPaint, textureSet, addOutline, applyWind, SHARED_UNIFORMS, registerNightEmissive, updateNightLights } from './render/materials.js';
export { VFX, ParticleSystem, VFX_PRESETS } from './render/particles.js';
export * as Geo from './geometry/builders.js';
export { PROPS } from './geometry/props.js';
export { BUILDINGS, tower, shop, house } from './geometry/buildings.js';
export { car, VEHICLE_TYPES } from './geometry/vehicles.js';
export { exportGLB, exportOBJ } from './geometry/export.js';
export { createHumanoid, attach, defaultParams, BONES, UPPER_BODY } from './character/humanoid.js';
export { CLIP_LIBRARY, buildClip, buildClipSet, defineClip } from './animation/clips.js';
export { HumanoidAnimator, AnimStateMachine } from './animation/animator.js';
export { Tween, Tweens, Ease } from './animation/tween.js';
export { CharacterIK, solveTwoBone, solveCCD, rigOf, groundFromPhysics, groundFromHeightfield, flatGround, rotateBoneWorld, setBoneWorldQuat } from './animation/ik.js';
export { Ragdoll } from './animation/ragdoll.js';
export { Heightfield, terrainMesh, terrainMaterial } from './world/terrain.js';
export { populate, scatterPoints, instanceProp, grassField } from './world/vegetation.js';
export { createWater } from './world/water.js';
export { generateCity, TrafficSystem } from './world/city.js';
export { PhysicsWorld, raySphere } from './physics/world.js';
export { CharacterController, syncVisual } from './physics/character.js';
export { Vehicle } from './physics/vehicle.js';
export { ThirdPersonCamera, FirstPersonCamera, ChaseCamera, CinematicCamera, CameraShake } from './camera/cameras.js';
export { BehaviorTree, bt, Sequence, Selector, Parallel, Condition, Action, Wait, Cooldown, StateMachine, Steering, NavGrid, Perception, SUCCESS, FAILURE, RUNNING } from './ai/behavior.js';
export { Health, Stamina, meleeSweep, ComboSystem, ProjectileSystem, Inventory, Progression, Entities } from './gameplay/systems.js';
export { Flags, QuestSystem, DialogueSystem, parseDialogue, Mission } from './gameplay/narrative.js';
export { compileStory, analyzeStory, simulatePlaythrough, applyStoryToSpec, STORY_FORMAT } from './gameplay/story.js';
export { AudioEngine, MusicSequencer, MOODS, SFX_NAMES } from './audio/audio.js';
export { UI, DEFAULT_SETTINGS } from './ui/ui.js';
export { Actor, NPC, Enemy, ENEMY_TYPES, AttackTokens, separateActors } from './gameplay/actors.js';
export { Player } from './gameplay/player.js';
export { composeGame, normalizeSpec, BIOMES } from './compose/composer.js';
export { Traversal } from './gameplay/traversal.js';
export { LightPool } from './render/lightpool.js';

// ---- cinematics
export { playCinematic, shotCamera, lintCinematic, cinematicLights, SHOT_SIZES } from './gameplay/cinematic.js';
export { place, foundation, pathStrip, scatter, groundAudit } from './world/placement.js';
// ---------- Open-world systems (streaming, NPC daily life, wanted/heat, crowds) ----------
// See skills/gameforge/references/open-world.md. Crowd uses realistic humans only when the game
// set app.useHumans(H, data); otherwise mannequins (the 6 MB dataset stays optional).
export { ChunkManager, LODGroup, selectLOD, createImpostor, streamObjects, bucketByCell, cellDistance, chunkKey, parseChunkKey } from './world/streaming.js';
export { ScheduleAgent, ScheduleSystem, PlaceRegistry, ACTIVITIES, SCHEDULE_TEMPLATES, makeSchedule, activityAt, jitterSchedule, inSpan, hoursBetween, straightPlanner, navGridPlanner, attachSchedules } from './ai/schedules.js';
export { WantedSystem, CRIMES, WANTED_LEVELS, levelForHeat, assignPursuit, lineOfSight, wantedHUD } from './gameplay/wanted.js';
export { Crowd, CrowdAnimator, sidewalkNetwork, placesFromCity, pedestrianLook } from './world/crowd.js';
// ---------------------------------------------------------------------------------------------
// Shooter kit (ranged combat, third- and first-person): weapons, hitscan/projectiles, cover,
// ranged AI, firearm meshes. See skills/gameforge/references/shooter.md.
export { WEAPONS, WEAPON_DEFAULTS, defineWeapon, weaponDef, damageAtDistance, zoneMultiplier, spreadAngle, coneDirection, timeToKill,
  WeaponState, WeaponSystem, actorHitboxes, rayHitbox, hitscan, applyDamage, attachFirearm, ShootingTarget, ShooterController } from './gameplay/shooter.js';
export { CoverSystem } from './gameplay/cover.js';
export { RangedEnemy, RANGED_TYPES, aiAimError } from './gameplay/shooter-ai.js';
export { weaponModel, weaponSocketWorld, WEAPON_MODEL_KINDS } from './gameplay/weapon-models.js';
// ---- Genre kit: platformer (controller profile, level runtime, reachability, generator, bot)
export { PLATFORMER_DEFAULTS, PIECES as PLATFORMER_PIECES, platformerParams, platformerProfile, jumpArc, airTime, jumpReach, canReach, maxGap, validateLevel, motionPose, PlatformerLevel, generatePlatformerLevel, PlatformerBot } from './gameplay/platformer.js';

// ---- Genre kit: racing (track generator + mesh + physics, racing line, AI racers, race manager)
export { Track, generateTrack, trackMesh, addTrackPhysics } from './world/track.js';
export { computeRacingLine, RaceAI, RaceManager, formatTime } from './gameplay/racing.js';
export { ShoulderedWeapon } from './gameplay/weapon-pose.js';
export { decimate, decimateObject } from './geometry/decimate.js';
export { building, streetBlock, FACADE_STYLES, GROUND_TYPES } from './world/facade.js';
export { Cloth } from './physics/cloth.js';
export { StealthSystem, lightProbe, GUARD_STATES, defaultMoveTo } from './gameplay/stealth.js';
