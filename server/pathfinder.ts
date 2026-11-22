import { StationDef } from './types';

export class Pathfinder {
  private stationMap: Map<string, StationDef>;

  constructor(stations: StationDef[]) {
    this.stationMap = new Map(stations.map((s) => [s.id, s]));
  }

  /**
   * 指定した目的駅からの全駅の最短距離（マス数）をBFSで計算する
   */
  public getAllDistancesFrom(targetId: string): Map<string, number> {
    const dist = new Map<string, number>();
    if (!this.stationMap.has(targetId)) return dist;

    dist.set(targetId, 0);
    const queue: string[] = [targetId];
    let head = 0;

    while (head < queue.length) {
      const current = queue[head++];
      const currentDist = dist.get(current)!;
      const station = this.stationMap.get(current);
      if (!station) continue;

      for (const neighborId of station.neighbors) {
        if (!dist.has(neighborId)) {
          dist.set(neighborId, currentDist + 1);
          queue.push(neighborId);
        }
      }
    }

    return dist;
  }

  /**
   * 2駅間の最短距離を返す
   */
  public getShortestDistance(fromId: string, toId: string): number {
    if (fromId === toId) return 0;
    const distances = this.getAllDistancesFrom(toId);
    return distances.get(fromId) ?? 999;
  }

  /**
   * 指定駅(fromId)から目的地(toId)へ最も近づく隣接駅を選ぶ
   */
  public getBestNextStep(
    fromId: string,
    toId: string,
    allowedNeighbors?: string[]
  ): string | null {
    const station = this.stationMap.get(fromId);
    if (!station) return null;

    const candidates = allowedNeighbors ?? station.neighbors;
    if (candidates.length === 0) return null;

    const distances = this.getAllDistancesFrom(toId);
    let bestId = candidates[0];
    let bestDist = distances.get(bestId) ?? 999;

    for (const cand of candidates) {
      const d = distances.get(cand) ?? 999;
      if (d < bestDist) {
        bestDist = d;
        bestId = cand;
      }
    }

    return bestId;
  }
}
