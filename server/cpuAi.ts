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
  | { type: 'skip_card_shop' }
  | { type: 'sell_debt_properties'; propertyIds: string[] };

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
      // カードは1ターン1枚まで。使用済みならサイコロ
      if (state.cardUsedThisTurn) return { type: 'roll_dice' };

      const dist = this.pathfinder.getShortestDistance(
        player.stationId,
        state.destinationStationId
      );
      const findCard = (ids: string[]): number => {
        for (const cid of ids) {
          const idx = player.cards.indexOf(cid);
          if (idx !== -1) return idx;
        }
        return -1;
      };
      const others = state.players
        .filter((p) => p.id !== player.id)
        .sort((a, b) => a.rank - b.rank);
      const topRival = others[0];

      // 1. ピンポイント移動カードでゴールできるなら使う
      for (let i = 0; i < player.cards.length; i++) {
        const card = this.cardMap.get(player.cards[i]);
        if (card?.category === 'fixed_move' && card.fixedSteps === dist) {
          return { type: 'use_card', cardIndex: i };
        }
      }
      if (dist >= 1 && dist <= 6) {
        const sp = findCard(['special_move']);
        if (sp !== -1) return { type: 'use_card', cardIndex: sp };
      }

      // 2. 借金・お邪魔キャラへの対処
      if (player.money < 0) {
        const idx = findCard(['debt_relief', 'billion_card', 'gold_cash', 'angel_card', 'bonus_cash']);
        if (idx !== -1) return { type: 'use_card', cardIndex: idx };
      }
      if (player.hasNuisance) {
        const exIdx = findCard(['super_exorcise', 'exorcise_nuisance']);
        if (exIdx !== -1) return { type: 'use_card', cardIndex: exIdx };
        const passIdx = findCard(['pass_nuisance']);
        if (passIdx !== -1 && topRival) {
          return { type: 'use_card', cardIndex: passIdx, targetPlayerId: topRival.id };
        }
      }

      // 3. 目的地が遠ければワープ系
      if (dist >= 12) {
        const idx = findCard(['warp_near_dest', 'goal_half_warp']);
        if (idx !== -1) return { type: 'use_card', cardIndex: idx };
      }

      // 4. 遠ければ急行系（強い順）
      if (dist >= 7) {
        const idx = findCard([
          'super_linear',
          'nozomi_shuyu',
          'linear_express',
          'shinkansen_shuyu',
          'nozomi_express',
          'super_shuyu',
          'super_express',
          'express_shuyu',
          'express_3',
          'express_2',
        ]);
        if (idx !== -1) return { type: 'use_card', cardIndex: idx };
      }

      // 5. 収入系カード（手札が多いとき or 資金不足のとき）
      if (player.cards.length >= 6 || player.money < 5000) {
        const idx = findCard([
          'billion_card',
          'gold_cash',
          'angel_card',
          'property_boom',
          'vampire_card',
          'lucky_slot',
          'tax_collect',
          'bonus_cash',
          'card_pack',
        ]);
        if (idx !== -1) return { type: 'use_card', cardIndex: idx };
      }

      // 6. 攻撃カード（トップのライバルを狙う）
      if (topRival && topRival.rank < player.rank && Math.random() < 0.5) {
        const idx = findCard([
          'takeover_prop',
          'devil_attack',
          'rob_money',
          'king_bomb_card',
          'cow_walk',
          'freeze_rival',
          'burn_card',
          'fastball_card',
          'steal_card',
        ]);
        if (idx !== -1) {
          return { type: 'use_card', cardIndex: idx, targetPlayerId: topRival.id };
        }
      }

      // 7. 手札が満杯なら何か1枚消化する
      if (player.cards.length >= 8) {
        for (let i = 0; i < player.cards.length; i++) {
          const card = this.cardMap.get(player.cards[i]);
          if (!card || card.passive) continue;
          if (card.category === 'economy' && card.id !== 'shuffle_all' && card.id !== 'summon_all') {
            return { type: 'use_card', cardIndex: i };
          }
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
      // 残り1マスで目的地に隣接していれば必ずぴったりゴール！
      if (state.remainingSteps === 1 && candidates.includes(state.destinationStationId)) {
        return { type: 'move_step', nextStationId: state.destinationStationId };
      }
      // 残り2マス以上で目的地通過や行き止まり（隣接1駅）に入るのを避ける
      const filtered =
        state.remainingSteps > 1 && candidates.length > 1
          ? candidates.filter((id) => {
              if (id === state.destinationStationId) return false;
              const nbLen = this.stationMap.get(id)?.neighbors.length ?? 0;
              return nbLen > 1;
            })
          : candidates;
      const pool = filtered.length > 0 ? filtered : candidates;
      const best = this.pathfinder.getBestNextStep(
        player.stationId,
        state.destinationStationId,
        pool
      );
      return {
        type: 'move_step',
        nextStationId: best ?? pool[0],
      };
    }

    if (state.phase === 'debt_sell') {
      // 独占していない安い物件から順に、借金が解消するまで売却リストを作成
      const mine = Object.values(state.ownedProperties).filter((o) => o.ownerId === player.id);
      const scored = mine.map((o) => {
        const st = this.stationMap.get(o.stationId);
        const def = st?.properties?.find((x) => x.id === o.propertyId);
        const value = (def?.price ?? 1000) * o.level;
        const isMono =
          st?.properties && st.properties.length > 0
            ? st.properties.every((p) => state.ownedProperties[p.id]?.ownerId === player.id)
            : false;
        return { id: o.propertyId, value, refund: Math.floor(value * 0.5), mono: isMono ? 1 : 0 };
      });
      scored.sort((a, b) => a.mono - b.mono || a.value - b.value);
      const toSell: string[] = [];
      let bal = player.money;
      for (const item of scored) {
        if (bal >= 0) break;
        toSell.push(item.id);
        bal += item.refund;
      }
      return { type: 'sell_debt_properties', propertyIds: toSell };
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
        const upgradeCost = prop.price;
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
      if (player.cards.length >= 5) return { type: 'skip_card_shop' };
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
