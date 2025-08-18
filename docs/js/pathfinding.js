import { MAP } from "./map.js";
import { GAME_CONFIG } from "./utils.js";

class PathNode {
  constructor(x, y, costFromStart = 0, heuristicCost = 0) {
    this.x = x;
    this.y = y;
    this.g = costFromStart;
    this.h = heuristicCost;
    this.f = costFromStart + heuristicCost;
    this.parent = null;
  }
}

class MinHeapOpenList {
  constructor() {
    this.nodes = [];
  }

  enqueue(node) {
    this.nodes.push(node);
    this.sortByTotalCost();
  }

  dequeue() {
    return this.nodes.shift();
  }

  sortByTotalCost() {
    this.nodes.sort((a, b) => a.f - b.f);
  }
}

export function findPath(startX, startY, goalX, goalY) {
    return path
}

function aStar(OPEN=[], CLOSE=[]){
    if(curentNodeisTargetNode)
}
