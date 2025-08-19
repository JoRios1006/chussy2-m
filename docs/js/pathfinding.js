import { MAP } from "./map.js"; // Import game map data
import { GAME_CONFIG } from "./utils.js"; // Import game configuration
import * as R from "ramda"; // Import Ramda functional library

/* -------- pull cfg once -------- */
// Extract pathfinding configuration with defaults
const PF = GAME_CONFIG.PATHFINDING || {};
// Cost for straight moves (default 1)
const STRAIGHT = PF.STRAIGHT_COST ?? 1;
// Cost for diagonal moves (default √2 ≈ 1.414)
const DIAGONAL = PF.DIAGONAL_COST ?? Math.SQRT2;
// Maximum allowed path length (default unlimited)
const MAX_LEN = PF.MAX_PATH_LENGTH ?? Infinity;

export function findPath(startX, startY, endX, endY) {
  return R.pipe(
    () => convertPixelCoordinatesToTileIFNeeded(startX, startY, endX, endY),
    validateStartandEndPoints,
    R.cond([
      // If stage.kind is "ok", then run the A* search
      [R.propEq("kind", "ok"), runAstar],
      // For any other case ("invalid", "done"), just pass the stage along
      [R.T, R.identity],
    ]),
    processFinalResult,
  )(); // Return path or null
}
function convertPixelCoordinatesToTileIFNeeded(startX, startY, endX, endY) {
  return {
    sx: snapToGrid(startX),
    sy: snapToGrid(startY),
    gx: snapToGrid(endX),
    gy: snapToGrid(endY),
  };
}
function snapToGrid(pixelCoord) {
  return Number.isInteger(pixelCoord)
    ? pixelCoord
    : Math.floor(pixelCoord / GAME_CONFIG.TILE_SIZE);
}
function validateStartandEndPoints(ctx) {
  return !walkable(ctx.sx, ctx.sy) || !walkable(ctx.gx, ctx.gy)
    ? { kind: "invalid" } // Invalid if either position is blocked
    : ctx.sx === ctx.gx && ctx.sy === ctx.gy
      ? { kind: "done", path: [] } // Already at destination
      : { kind: "ok", ctx };
} // Proceed with search
// This function's only job is to run the A* search.
function runAstar(stage) {
  const { sx, sy, gx, gy } = stage.ctx; // No longer needs a check
  const startK = key(sx, sy);
  const goal = { x: gx, y: gy, k: key(gx, gy) };

  const init = {
    open: [{ x: sx, y: sy, f: H(sx, sy, gx, gy) }],
    gScore: { [startK]: 0 },
    fScore: { [startK]: H(sx, sy, gx, gy) },
    parents: { [startK]: null },
    closed: {},
    currentK: undefined,
  };

  return {
    kind: "ran",
    startK,
    goalK: goal.k,
    endState: run(init, goal),
  };
}
function run(state, goal) {
  return R.until(
    (s) => {
      return doneOrEmpty(goal)(s) || hardStopByG(s);
    }, // Stop conditions
    step(goal), // Expansion step
    state,
  );
}
/* -------- one pure A* expansion step (now uses per-edge cost + MAX_LEN) ------- */
function step(goal) {
  return (state) => {
    // Destructure current state
    const { open, gScore, fScore, parents, closed } = state;

    // Find best node in open list
    const idx = pickBestIndex(open);
    if (idx === null) return state; // No nodes left

    const current = open[idx]; // Current best node
    const currentK = key(current.x, current.y); // Key for current node
    const done = currentK === goal.k; // Check if reached goal

    // Remove current from open list
    const openWithoutCurrent = R.remove(idx, 1, open);

    // Process neighbors only if not at goal
    const expanded = done
      ? // If at goal, just remove current node
        { open: openWithoutCurrent, gScore, fScore, parents }
      : // Process each neighbor
        R.reduce(
          (
            { open: o, gScore: g, fScore: f, parents: p },
            [nx, ny, stepCost],
          ) => {
            const nk = key(nx, ny); // Neighbor key

            // Skip if already closed
            if (get(closed, nk, false))
              return { open: o, gScore: g, fScore: f, parents: p };

            // Calculate tentative g-score (current cost + move cost)
            const tentativeG = get(g, currentK, Infinity) + stepCost;

            // Hard stop if exceeds max path length
            if (tentativeG > MAX_LEN)
              return { open: o, gScore: g, fScore: f, parents: p };

            // Check if better than existing path
            const better = tentativeG < get(g, nk, Infinity);
            return better
              ? // Update neighbor data
                {
                  open: R.append(
                    // Add neighbor to open list with f-score
                    { x: nx, y: ny, f: tentativeG + H(nx, ny, goal.x, goal.y) },
                    o,
                  ),
                  // Update gScore with new cost
                  gScore: set(g, nk, tentativeG),
                  // Update fScore (g + heuristic)
                  fScore: set(f, nk, tentativeG + H(nx, ny, goal.x, goal.y)),
                  // Set current as parent
                  parents: set(p, nk, currentK),
                }
              : // No improvement, keep state unchanged
                { open: o, gScore: g, fScore: f, parents: p };
          },
          // Start with open list without current
          { open: openWithoutCurrent, gScore, fScore, parents },
          // Get neighbors for current position
          neighbors8(current.x, current.y),
        );

    // Add current to closed set
    const nextClosed = set(closed, currentK, true);

    // Return updated state
    return {
      ...expanded, // Expanded state from neighbor processing
      closed: nextClosed, // Updated closed set
      currentK,
    };
  };
}
// Find index of node with lowest f-score in open list
function pickBestIndex(open) {
  return R.reduce(
    (best, n, i) => (best === null || n.f < open[best].f ? i : best),
    null, // Initial best index (none)
    open,
  );
}
// Termination condition check
function doneOrEmpty(goal) {
  return (state) =>
    R.isEmpty(state.open) || // Open list empty = no path
    state.currentK === goal.k;
} // Reached goal
/* Extra guard: stop if best g-score exceeds MAX_LEN */
function hardStopByG(state) {
  // Find minimum g-score among open nodes
  const minG = R.reduce(
    (acc, n) => {
      const k = key(n.x, n.y); // Node key
      const g = get(state.gScore, k, Infinity); // Get g-score
      return g < acc ? g : acc; // Track minimum
    },
    Infinity, // Initial minimum value
    state.open,
  );
  // Stop if minimum exceeds max length
  return minG > MAX_LEN;
}
function processFinalResult(stage) {
  return stage.kind === "invalid"
    ? null // Invalid positions → no path
    : stage.kind === "done"
      ? stage.path // Already at goal → empty path
      : finalize(stage.startK, stage.goalK)(stage.endState);
} // Process A* result
// Final path processing after search completes
function finalize(startK, goalK) {
  return (state) =>
    state.currentK === goalK
      ? R.pipe(
          () => pathFromParents(state.parents, startK, goalK),
          (path) =>
            get(state.gScore, goalK, Infinity) <= MAX_LEN ? path : null,
        )()
      : null;
}
// Reconstruct path from parent pointers
function pathFromParents(parents, startK, goalK) {
  // Build full path as array of keys
  const full = build(goalK, [], parents, startK);

  return R.pipe(
    R.tail, // Remove start node (we only need path segments)

    // Convert keys to {x, y} objects
    R.map((k) => {
      const [x, y] = unkey(k); // Split key into coordinates
      return { x, y }; // Return position object
    }),
  )(full);
}
function build(k, acc, parents, startK) {
  return k === startK
    ? R.prepend(k, acc)
    : build(get(parents, k, null), R.prepend(k, acc), parents, startK);
}
/* ---------------- helpers  ---------------- */
// Generate unique string key from coordinates
function key(x, y) {
  return `${x},${y}`;
}
// Convert key back to [x, y] coordinates
function unkey(k) {
  return R.map(Number, k.split(","));
}
// Check if coordinates are within map bounds
function inBounds(x, y) {
  return y >= 0 && y < MAP.length && x >= 0 && x < MAP[0].length;
}
// Check if tile is walkable (0 = walkable)
function walkable(x, y) {
  return inBounds(x, y) && MAP[y][x] === 0;
}

/* Admissible heuristic for 8-direction movement with costs: OCTILE distance */
function H(x1, y1, x2, y2) {
  const dx = Math.abs(x1 - x2); // Horizontal distance
  const dy = Math.abs(y1 - y2); // Vertical distance
  const m = Math.min(dx, dy); // Smaller component
  const M = Math.max(dx, dy); // Larger component
  return DIAGONAL * m + STRAIGHT * (M - m); // Octile distance calculation
}

/* Generate 8-direction neighbors with movement costs */
function neighbors8(x, y) {
  return R.pipe(
    // Define all 8 possible directions with costs
    () => [
      [1, 0, STRAIGHT], // Right
      [-1, 0, STRAIGHT], // Left
      [0, 1, STRAIGHT], // Down
      [0, -1, STRAIGHT], // Up
      [1, 1, DIAGONAL], // Down-right
      [1, -1, DIAGONAL], // Up-right
      [-1, 1, DIAGONAL], // Down-left
      [-1, -1, DIAGONAL], // Up-left
    ],
    // Filter out diagonal moves that would "cut corners" through walls
    R.filter(
      ([dx, dy]) =>
        // Always allow orthogonal moves
        Math.abs(dx) + Math.abs(dy) === 1 ||
        // For diagonals, require both adjacent orthogonals to be walkable
        (walkable(x + dx, y) && walkable(x, y + dy)),
    ),
    // Convert directions to actual neighbor coordinates
    R.map(([dx, dy, c]) => [x + dx, y + dy, c]),
    // Filter out unwalkable neighbors
    R.filter(([nx, ny]) => walkable(nx, ny)),
  )();
} // Immediately execute the pipeline

// Functional getter with default value
function get(obj, k, dflt) {
  return k in obj ? obj[k] : dflt;
}
// Functional immutable setter (creates new object)
function set(obj, k, v) {
  return { ...obj, [k]: v };
}
