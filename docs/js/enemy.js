/**
 * Enemy module: spawns, updates, and renders enemies.
 *
 * Notes on conventions:
 * - World coordinates are in tile units.
 * - We avoid renaming exported APIs or object property keys (e.g., enemy.x) to keep inter-module contracts stable.
 * - Variable names are made verbose within local scopes for readability; behavior and logic are unchanged.
 */
import { GAME_CONFIG } from './utils.js';
import { player } from './player.js';
import { checkWallCollision, castRay } from './map.js';
import { calculateDistance, spriteCache, worldToScreen } from './utils.js';
import { findPath } from './pathfinding.js';
import { handlePlayerDeath } from './game.js';
// --- Spawn helpers -----------------------------------------------------------
// Hard-coded cells near the corners of the map; offsets add variation
const SAFE_SPAWN_POINTS = [
  { x: 3.5, y: 3.5 },
  { x: 8.5, y: 3.5 },
  { x: 3.5, y: 8.5 },
  { x: 8.5, y: 8.5 },
];
const pickSpawnBasePoint = () =>
  SAFE_SPAWN_POINTS[Math.floor(Math.random() * SAFE_SPAWN_POINTS.length)];
const randomTileOffset = () => Math.random() * 2 - 1;
const computeSpawnCandidate = () => {
  const base = pickSpawnBasePoint();
  return { x: base.x + randomTileOffset(), y: base.y + randomTileOffset() };
};
const createEnemyAt = (x, y) => ({
  x,
  y,
  health: 100, // Enemy starts at full health
  type: 'ENEMY_1', // Sprite/behavior identifier
  lastMove: Date.now(), // Timestamp of last movement (ms)
  lastPathUpdate: 0, // Last pathfinding recompute time (ms)
  pathIndex: 0, // Index of the current waypoint in the path
  path: null,
});
export function spawnEnemy() {
  const spawnCandidate = Array.from({ length: 8 }, () => computeSpawnCandidate()).find(
    ({ x, y }) => !checkWallCollision(x, y, 0.3),
  );
  return spawnCandidate ? createEnemyAt(spawnCandidate.x, spawnCandidate.y) : undefined;
}

/**
 * Advance the enemy simulation for the current frame: sorting for draw order,
 * collision with the player, pathfinding updates, and movement with wall sliding.
 *
 * @param {Object} state - Global game state.
 * @param {Object} player - Player entity (position, angle, health).
 */
export function updateEnemies(state, player) {
  if (!state.gameOver && state.enemies && Array.isArray(state.enemies)) {
    // Sort enemies back-to-front by distance so nearer sprites draw last (proper painter's algorithm)
    state.enemies.sort((a, b) => {
      if (!a || !b) return 0;
      const distanceA = Math.sqrt(Math.pow(a.x - player.x, 2) + Math.pow(a.y - player.y, 2));
      const distanceB = Math.sqrt(Math.pow(b.x - player.x, 2) + Math.pow(b.y - player.y, 2));
      return distanceB - distanceA; // Sort furthest to closest
    });

    for (let enemyIndex = state.enemies.length - 1; enemyIndex >= 0; enemyIndex--) {
      const enemy = state.enemies[enemyIndex];
      if (!enemy) continue;

      // Vector from enemy to player
      const deltaXToPlayer = player.x - enemy.x;
      const deltaYToPlayer = player.y - enemy.y;
      const distanceToPlayer = Math.sqrt(
        deltaXToPlayer * deltaXToPlayer + deltaYToPlayer * deltaYToPlayer,
      );

      // If an enemy gets very close to the player, inflict damage and despawn the enemy
      if (distanceToPlayer < 0.5) {
        player.health = Math.max(0, player.health - 25); // Reduce health by 25
        state.enemies.splice(enemyIndex, 1);
        if (player.health <= 0) {
          handlePlayerDeath();
        }
        continue;
      }

      // Recompute path (A*) periodically so enemies can navigate around walls responsively
      const currentTimeMs = Date.now();
      if (currentTimeMs - enemy.lastPathUpdate > 100) {
        // Reduced from 500ms to 100ms
        enemy.path = findPath(enemy.x, enemy.y, player.x, player.y);
        enemy.lastPathUpdate = currentTimeMs;
        enemy.pathIndex = 0;
      }

      // Step toward the current waypoint along the computed path
      if (enemy.path && enemy.path.length > 0 && enemy.pathIndex < enemy.path.length) {
        const currentWaypoint = enemy.path[enemy.pathIndex];
        const deltaToWaypointX = currentWaypoint.x - enemy.x;
        const deltaToWaypointY = currentWaypoint.y - enemy.y;
        const distanceToWaypoint = Math.sqrt(
          deltaToWaypointX * deltaToWaypointX + deltaToWaypointY * deltaToWaypointY,
        );

        if (distanceToWaypoint < 0.1) {
          enemy.pathIndex++;
        } else {
          // Smoother movement with proper collision radius
          const movementSpeed = 0.003; // World units per frame (tuned for fairness)
          const proposedX = enemy.x + (deltaToWaypointX / distanceToWaypoint) * movementSpeed;
          const proposedY = enemy.y + (deltaToWaypointY / distanceToWaypoint) * movementSpeed;

          // Check collision with entity radius
          if (!checkWallCollision(proposedX, proposedY, 0.3)) {
            // 0.3≈enemy collision radius
            enemy.x = proposedX;
            enemy.y = proposedY;
          } else {
            // If forward movement is blocked, attempt axis-aligned sliding to skim along walls
            if (!checkWallCollision(proposedX, enemy.y, 0.3)) {
              enemy.x = proposedX;
            } else if (!checkWallCollision(enemy.x, proposedY, 0.3)) {
              enemy.y = proposedY;
            }
          }
        }
      }
    }
  }
}

/**
 * Project and draw a single enemy sprite to the 2D canvas with simple occlusion,
 * field-of-view culling, and a health bar overlay.
 *
 * @param {CanvasRenderingContext2D} ctx - Drawing context.
 * @param {Object} enemy - Enemy entity with {x, y, health, type}.
 * @param {Object} player - Player entity providing position and view angle.
 * @param {HTMLCanvasElement} canvas - Target canvas (for width/height).
 */
export function renderEnemy(ctx, enemy, player, canvas) {
  if (!enemy || typeof enemy.x !== 'number' || typeof enemy.y !== 'number') return;

  const { screenX, screenY, size, distance } = worldToScreen(
    enemy.x,
    enemy.y,
    player.x,
    player.y,
    player.angle,
    canvas,
  );

  // Compute bearing to the enemy and normalize relative to the player view ([-π, π])
  const deltaXToPlayer = enemy.x - player.x;
  const deltaYToPlayer = enemy.y - player.y;
  const angleToEnemy = Math.atan2(deltaYToPlayer, deltaXToPlayer);
  const relativeAngleToView =
    ((angleToEnemy - player.angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI;

  // Cull enemies outside the player FOV to save fill-rate
  if (Math.abs(relativeAngleToView) > GAME_CONFIG.FOV / 2) return;

  // Raycast to the nearest wall; if the wall is closer than the enemy, the enemy is occluded
  const distanceToNearestWall = castRay(angleToEnemy, player.x, player.y, player.angle);
  if (distance > distanceToNearestWall) return;

  // Skip if the projected sprite would be off-screen (with a small margin)
  const screenMargin = size * 0.5;
  if (screenX < -screenMargin || screenX > canvas.width + screenMargin) return;

  // Draw the enemy sprite scaled by distance, then overlay a simple health bar
  ctx.save();
  const enemySprite = spriteCache[enemy.type];
  if (enemySprite) {
    const drawWidth = Math.max(16, size); // Minimum on-screen size for readability
    const drawHeight = drawWidth;
    ctx.drawImage(
      enemySprite,
      screenX - drawWidth / 2,
      screenY - drawHeight / 2,
      drawWidth,
      drawHeight,
    );
  }

  // Draw health bar above the sprite
  const healthBarWidth = size / 2; // Proportional to sprite size
  const healthBarHeight = size / 10; // Thin bar
  const healthPercent = enemy.health / 100; // 0..1 range

  ctx.fillStyle = '#ff0000';
  ctx.fillRect(screenX - healthBarWidth / 2, screenY - size / 3, healthBarWidth, healthBarHeight);
  ctx.fillStyle = '#00ff00';
  ctx.fillRect(
    screenX - healthBarWidth / 2,
    screenY - size / 3,
    healthBarWidth * healthPercent,
    healthBarHeight,
  );

  ctx.restore();
}
