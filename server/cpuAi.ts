import { Pathfinder } from './pathfinder';
import {
  CardDef,
  OwnedProperty,
  PlayerInternalState,
  PublicGameState,
  StationDef,
} from './types';

export type CpuActionDecision =
  | { type: 'roll_dice' }
  | { type: 'use_card'; cardIndex: number; targetPlayerId?: string }
  | { type: 'move_step'; nextStationId: string }
  | { type: 'buy_properties'; propertyIds: string[]; upgradeIds: string[] }
  | { type: 'skip_buy' }
  | { type: 'buy_card_shop'; cardId: string }
  | { type: 'skip_card_shop' };

export class CpuAi {
  private pathfinder: Pathfinder;
  private cardMap: Map<string, CardDef>;
  private stationMap: Map<string, StationDef>;

  constructor(
    pathfinder: Pathfinder,
    cards: CardDef[],
    stations: StationDef[]
  ) {
    this.pathfinder = pathfinder;
    this.cardMap = new Map(cards.map((c) => [c.id, c]));
    this.stationMap = new Map(stations.map((s) => [s.id, s]));
  }

  public decideAction(
    player: PlayerInternalState,
    state: PublicGameState
  ): CpuActionDecision {
    if (state.phase === 'action_select') {
      const dist = this.pathfinder.getShortestDistance(
        player.stationId,
        state.destinationStationId
      );

      // 1. ピンポイント移動カードでゴールできるなら使う
      for (let i = 0; i < player.cards.length; i++) {
        const card = this.cardMap.get(player.cards[i]);
        if (card?.category === 'fixed_move' && card.fixedSteps === dist) {
          return { type: 'use_card', cardIndex: i };
        }
      }

      // 2. 臨時収入カードがあれば使う
      const cashIdx = player.cards.findIndex((id) => id === 'bonus_cash');
      if (cashIdx !== -1 && player.money < 5000) {
        return { type: 'use_card', cardIndex: cashIdx };
      }

      // 3. 目的地が遠ければ急行系・接近ワープカードを使う
      if (dist >= 12) {
        const nearWarpIdx = player.cards.findIndex((id) => id === 'warp_near_dest');
        if (nearWarpIdx !== -1) {
          return { type: 'use_card', cardIndex: nearWarpIdx };
        }
      }
      if (dist >= 7) {
        const speedPriority = ['linear_express', 'super_express', 'express_3', 'express_2'];
        for (const cid of speedPriority) {
          const idx = player.cards.findIndex((id) => id === cid);
          if (idx !== -1) {
            return { type: 'use_card', cardIndex: idx };
          }
        }
      }

      // 4. とても遠ければぶっとびカードを使うことがある
      if (dist >= 15) {
        const warpIdx = player.cards.findIndex((id) => id === 'warp_near');
        if (warpIdx !== -1 && Math.random() < 0.5) {
          return { type: 'use_card', cardIndex: warpIdx };
        }
      }

      // 5. 攻撃カード（トップのプレイヤーを狙う）
      const sortedOthers = state.players
        .filter((p) => p.id !== player.id)
        .sort((a, b) => a.rank - b.rank);
      if (sortedOthers.length > 0 && Math.random() < 0.35) {
        const topRival = sortedOthers[0];
        const robIdx = player.cards.findIndex((id) => id === 'rob_money');
        if (robIdx !== -1 && topRival.money >= 2000) {
          return { type: 'use_card', cardIndex: robIdx, targetPlayerId: topRival.id };
        }
      }

      return { type: 'roll_dice' };
    }

    if (state.phase === 'moving') {
      const rawCandidates = state.availableNextStations;
      const forwardOnly = rawCandidates.filter((id) => id !== state.undoStationId);
      const candidates = forwardOnly.length > 0 ? forwardOnly : rawCandidates;
      if (candidates.length === 0) {
        const st = this.stationMap.get(player.stationId);
        return {
          type: 'move_step',
          nextStationId: st?.neighbors[0] ?? player.stationId,
        };
      }
      const best = this.pathfinder.getBestNextStep(
        player.stationId,
        state.destinationStationId,
        candidates
      );
      return {
        type: 'move_step',
        nextStationId: best ?? candidates[0],
      };
    }

    if (state.phase === 'property_buy') {
      const station = this.stationMap.get(player.stationId);
      if (!station || !station.properties) {
        return { type: 'skip_buy' };
      }

      let budget = Math.floor(player.money * 0.8);
      const buyIds: string[] = [];
      const upgradeIds: string[] = [];

      // 未購入物件を安い順または高い順に検討（今回は収益効率と買いやすさでソート）
      const unowned = station.properties
        .filter((p) => !state.ownedProperties[p.id])
        .sort((a, b) => b.price - a.price);

      for (const prop of unowned) {
        if (budget >= prop.price) {
          buyIds.push(prop.id);
          budget -= prop.price;
        }
      }

      // すでに自分が持っている物件の増資も検討
      const ownProps = station.properties.filter((p) => {
        const owned: OwnedProperty | undefined = state.ownedProperties[p.id];
        return owned && owned.ownerId === player.id && owned.level < 3;
      });
      for (const prop of ownProps) {
        const upgradeCost = Math.floor(prop.price * 0.8);
        if (budget >= upgradeCost) {
          upgradeIds.push(prop.id);
          budget -= upgradeCost;
        }
      }

      if (buyIds.length > 0 || upgradeIds.length > 0) {
        return { type: 'buy_properties', propertyIds: buyIds, upgradeIds };
      }
      return { type: 'skip_buy' };
    }

    if (state.phase === 'card_shop') {
      if (player.cards.length >= 8) return { type: 'skip_card_shop' };
      const prefer = ['super_express', 'express_3', 'shield', 'express_2'];
      for (const cid of prefer) {
        const card = this.cardMap.get(cid);
        const price = card?.price ?? 1500;
        if (card && player.money >= price + 1000) {
          return { type: 'buy_card_shop', cardId: cid };
        }
      }
      return { type: 'skip_card_shop' };
    }

    return { type: 'skip_buy' };
  }
}
