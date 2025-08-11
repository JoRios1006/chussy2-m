export const MAP = [
  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  [1, 1, 0, 0, 0, 1, 1, 0, 0, 0, 1, 1],
  [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
  [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
  [1, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 1],
  [1, 1, 0, 0, 1, 1, 1, 1, 0, 0, 1, 1],
  [1, 1, 0, 0, 1, 1, 1, 1, 0, 0, 1, 1],
  [1, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 1],
  [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
  [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
  [1, 1, 0, 0, 0, 1, 1, 0, 0, 0, 1, 1],
  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
];

// Pre-calculate step size for better performance
const RAY_STEP = 1;
const MAX_DISTANCE = 200;
const MAP_HEIGHT = MAP.length;
const MAP_WIDTH = MAP[0].length;
const isWallAt = (gridX, gridY) =>
  gridY >= 0 &&
  gridY < MAP_HEIGHT &&
  gridX >= 0 &&
  gridX < MAP_WIDTH &&
  MAP[gridY][gridX] === 1;
export function castRay(
  rayAngleRadians,
  playerWorldPositionX,
  playerWorldPositionY,
  playerFacingAngleRadians,
) {
  // Calculate ray direction vector components
  const rayDirectionVectorX = Math.cos(rayAngleRadians);
  const rayDirectionVectorY = Math.sin(rayAngleRadians);

  // Precompute fisheye correction factor
  const fisheyeCorrectionFactor = Math.cos(
    rayAngleRadians - playerFacingAngleRadians,
  );

  // Initialize ray at player's position
  let currentRayPositionX = playerWorldPositionX;
  let currentRayPositionY = playerWorldPositionY;
  let accumulatedRayDistance = 0;

  // Traverse ray path until max distance
  while (accumulatedRayDistance < MAX_DISTANCE) {
    // Advance ray position by whole grid units
    currentRayPositionX += rayDirectionVectorX;
    currentRayPositionY += rayDirectionVectorY;

    // Update distance traveled (Pythagorean approximation)
    accumulatedRayDistance = Math.hypot(
      currentRayPositionX - playerWorldPositionX,
      currentRayPositionY - playerWorldPositionY,
    );

    // Calculate current grid cell WITHOUT flooring
    const currentMapCellX = Math.trunc(currentRayPositionX);
    const currentMapCellY = Math.trunc(currentRayPositionY);

    // Check if ray has exited map bounds
    if (
      currentMapCellY < 0 ||
      currentMapCellY >= MAP_HEIGHT ||
      currentMapCellX < 0 ||
      currentMapCellX >= MAP_WIDTH
    ) {
      return accumulatedRayDistance * fisheyeCorrectionFactor;
    }

    // Check for wall collision
    if (MAP[currentMapCellY][currentMapCellX] === 1) {
      return accumulatedRayDistance * fisheyeCorrectionFactor;
    }
  }

  // Return max distance with fisheye correction
  return accumulatedRayDistance * fisheyeCorrectionFactor;
}
const OFFSETS = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [0, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
];
export const checkWallCollision = (x, y, radius = 0.2) =>
  OFFSETS.some(([dx, dy]) =>
    isWallAt(Math.floor(x + dx * radius), Math.floor(y + dy * radius)),
  );
