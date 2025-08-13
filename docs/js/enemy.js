import { pipe, times, find, defaultTo, sortBy, map } from "ramda";
import { GAME_CONFIG, spriteCache, worldToScreen } from "./utils.js";
import { checkWallCollision as isCollidingWithWall, castRay } from "./map.js";
import { findPath } from "./pathfinding.js";
import { handlePlayerDeath } from "./game.js";

// ──────────────────────────────────────────────────────────────────────────────
// Tunables & constants
const ENEMY_TYPE_ID = "ENEMY_1";
const ENEMY_MAX_HEALTH = 100;
const ENEMY_COLLISION_RADIUS = 0.3; // used when moving / checking walls
const ENEMY_CONTACT_RANGE = 0.5; // distance at which enemy damages the player
const ENEMY_CONTACT_DAMAGE = 25; // damage dealt on contact
const ENEMY_SPEED_PER_TICK = 0.003; // world units per frame
const PATH_RECOMPUTE_MS = 100; // recompute A* roughly every 100ms
const WAYPOINT_REACHED_RANGE = 0.1; // snap threshold for waypoints
// ──────────────────────────────────────────────────────────────────────────────

// Corner-ish safe bases for spawning (tile space); small random offsets applied
const SAFE_SPAWN_POINTS = [
  { x: 3.5, y: 3.5 },
  { x: 8.5, y: 3.5 },
  { x: 3.5, y: 8.5 },
  { x: 8.5, y: 8.5 },
];

// ──────────────────────────────────────────────────────────────────────────────
// Small helpers (pure)
const randomTileOffset = () => Math.random() * 2 - 1; // [-1, +1]
const pickBaseSpawnPoint = () =>
  SAFE_SPAWN_POINTS[Math.floor(Math.random() * SAFE_SPAWN_POINTS.length)];
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Use a *single* base point for both x and y to keep candidates coherent.
 */
const generateCandidateSpawnPoint = () => {
  const base = pickBaseSpawnPoint();
  return { x: base.x + randomTileOffset(), y: base.y + randomTileOffset() };
};

const createEnemyAt = (x, y) => ({
  x,
  y,
  health: ENEMY_MAX_HEALTH,
  type: ENEMY_TYPE_ID,
  lastMove: Date.now(),
  lastPathUpdate: 0,
  pathIndex: 0,
  path: null,
});

const distanceToPlayer = (enemy, player) =>
  Math.hypot(enemy.x - player.x, enemy.y - player.y);

// Sort helper: far → near (painter's algorithm draws near last)
const sortEnemiesByDistanceDesc = (player) =>
  sortBy((e) => -distanceToPlayer(e, player));

// ──────────────────────────────────────────────────────────────────────────────
// Spawning — point-free, Ramda pipe; no loops
/**
 * Attempts up to 8 random candidate positions, returns a fully constructed enemy.
 * If all candidates collide, falls back to a safe default (1.5, 1.5).
 */
export const spawnEnemy = pipe(
  () => times(() => generateCandidateSpawnPoint(), 8),
  find(({ x, y }) => !isCollidingWithWall(x, y, ENEMY_COLLISION_RADIUS)),
  defaultTo({ x: 1.5, y: 1.5 }),
  ({ x, y }) => createEnemyAt(x, y),
);
// ──────────────────────────────────────────────────────────────────────────────
// ──────────────────────────────────────────────────────────────────────────────
// Update — transform the enemy list
/**
 * Update all enemies for this tick: damage on contact, path recompute, movement.
 * Side-effects
 *  - Mutates `player.health` and may call `handlePlayerDeath()` if health <= 0.
 *  - Replaces `state.enemies` with a new, sorted array each tick.
 */
export function updateEnemies(state, player) {
  if (state.gameOver || !Array.isArray(state.enemies)) return;

  const now = Date.now();

  // 1) Compute which enemies are in contact with the player this tick
  const inContactWithPlayer = (e) =>
    distanceToPlayer(e, player) < ENEMY_CONTACT_RANGE;

  const contactCount = state.enemies.filter(inContactWithPlayer).length;

  // Apply damage once per contacting enemy
  if (contactCount > 0) {
    player.health = Math.max(
      0,
      player.health - ENEMY_CONTACT_DAMAGE * contactCount,
    );
    if (player.health <= 0) handlePlayerDeath();
  }

  // 2) Remove enemies that contacted the player
  const survivingEnemies = state.enemies.filter((e) => !inContactWithPlayer(e));

  // 3) Recompute path (A*) if stale, then move toward current waypoint with wall sliding
  const withUpdatedPaths = map((e) =>
    now - e.lastPathUpdate > PATH_RECOMPUTE_MS
      ? {
          ...e,
          path: findPath(e.x, e.y, player.x, player.y),
          pathIndex: 0,
          lastPathUpdate: now,
        }
      : e,
  )(survivingEnemies);

  const stepTowardWaypoint = (e) => {
    const hasPath = e.path && e.path.length > 0 && e.pathIndex < e.path.length;
    if (!hasPath) return e;

    const waypoint = e.path[e.pathIndex];
    const dx = waypoint.x - e.x;
    const dy = waypoint.y - e.y;
    const dist = Math.hypot(dx, dy) || 1e-6;

    // If close enough, advance to the next waypoint
    if (dist < WAYPOINT_REACHED_RANGE) {
      return { ...e, pathIndex: e.pathIndex + 1, lastMove: now };
    }

    // Propose a step toward the waypoint
    const stepX = e.x + (dx / dist) * ENEMY_SPEED_PER_TICK;
    const stepY = e.y + (dy / dist) * ENEMY_SPEED_PER_TICK;

    // Try full step; otherwise try sliding along axes
    if (!isCollidingWithWall(stepX, stepY, ENEMY_COLLISION_RADIUS)) {
      return { ...e, x: stepX, y: stepY, lastMove: now };
    }
    if (!isCollidingWithWall(stepX, e.y, ENEMY_COLLISION_RADIUS)) {
      return { ...e, x: stepX, lastMove: now };
    }
    if (!isCollidingWithWall(e.x, stepY, ENEMY_COLLISION_RADIUS)) {
      return { ...e, y: stepY, lastMove: now };
    }
    return e; // fully blocked this tick
  };

  const movedEnemies = map(stepTowardWaypoint)(withUpdatedPaths);

  // 4) Sort far→near for painter's algorithm
  state.enemies = sortEnemiesByDistanceDesc(player)(movedEnemies);
}
// ──────────────────────────────────────────────────────────────────────────────

// ──────────────────────────────────────────────────────────────────────────────
// Render
// ──────────────────────────────────────────────────────────────────────────────
/**
 * Project and draw a single enemy sprite with occlusion and FOV culling.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Object} enemy - {x, y, health, type}
 * @param {Object} player - {x, y, angle}
 * @param {HTMLCanvasElement} canvas
 */
export function renderEnemy(ctx, enemy, player, canvas) {
  if (!enemy || typeof enemy.x !== "number" || typeof enemy.y !== "number")
    return;

  const { screenX, screenY, size, distance } = worldToScreen(
    enemy.x,
    enemy.y,
    player.x,
    player.y,
    player.angle,
    canvas,
  );

  const deltaX = enemy.x - player.x;
  const deltaY = enemy.y - player.y;
  const angleToEnemy = Math.atan2(deltaY, deltaX);
  const relativeAngle =
    ((angleToEnemy - player.angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI;

  // Cull enemies outside field of view
  if (Math.abs(relativeAngle) > GAME_CONFIG.FOV / 2) return;

  // Simple occlusion: if a wall is closer along this ray, the enemy is hidden
  const distanceToWall = castRay(
    angleToEnemy,
    player.x,
    player.y,
    player.angle,
  );
  if (distance > distanceToWall) return;

  // Offscreen safety margin
  const margin = size * 0.5;
  if (screenX < -margin || screenX > canvas.width + margin) return;

  // Draw sprite
  ctx.save();
  const sprite = spriteCache[enemy.type];
  if (sprite) {
    const drawSize = Math.max(16, size);
    ctx.drawImage(
      sprite,
      screenX - drawSize / 2,
      screenY - drawSize / 2,
      drawSize,
      drawSize,
    );
  }

  // Health bar overlay
  const barW = size / 2;
  const barH = size / 10;
  const hpRatio = enemy.health / ENEMY_MAX_HEALTH;

  ctx.fillStyle = "#ff0000";
  ctx.fillRect(screenX - barW / 2, screenY - size / 3, barW, barH);

  ctx.fillStyle = "#00ff00";
  ctx.fillRect(screenX - barW / 2, screenY - size / 3, barW * hpRatio, barH);

  ctx.restore();
}
