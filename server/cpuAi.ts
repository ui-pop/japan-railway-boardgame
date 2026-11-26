import { getCardShopPrice, getYearInflationMult } from './gameEngine';
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
  | { type: 'start_duel'; opponentId: string; bet: number }
  | { type: 'skip_duel' }
  | { type: 'sell_debt_properties'; propertyIds: string[] };

interface CpuPersona {
  level: number; // 1 (まめ鬼) .. 6 (さくま)
  buyBudgetRatio: number;
  upgradeEnabled: boolean;
  attackChance: number;
  duelRiskRatio: number;
}

function getCpuPersona(name: string): CpuPersona {
  if (name.includes('まめ鬼')) {
    return { level: 1, buyBudgetRatio: 0.55, upgradeEnabled: false, attackChance: 0.2, duelRiskRatio: 0.1 };
  }
  if (name.includes('赤鬼') || name.includes('餓鬼')) {
    return { level: 2, buyBudgetRatio: 0.72, upgradeEnabled: true, attackChance: 0.4, duelRiskRatio: 0.15 };
  }
  if (name.includes('風神')) {
    return { level: 3, buyBudgetRatio: 0.8, upgradeEnabled: true, attackChance: 0.55, duelRiskRatio: 0.2 };
  }
  if (name.includes('あしゅら')) {
    return { level: 4, buyBudgetRatio: 0.88, upgradeEnabled: true, attackChance: 0.7, duelRiskRatio: 0.25 };
  }
  if (name.includes('えんま')) {
    return { level: 5, buyBudgetRatio: 0.93, upgradeEnabled: true, attackChance: 0.8, duelRiskRatio: 0.3 };
  }
  if (name.includes('さくま')) {
    return { level: 6, buyBudgetRatio: 0.96, upgradeEnabled: true, attackChance: 0.9, duelRiskRatio: 0.35 };
  }
  return { level: 3, buyBudgetRatio: 0.8, upgradeEnabled: true, attackChance: 0.5, duelRiskRatio: 0.2 };
}

export class CpuAi {
  private pathfinder: Pathfinder;
  private cardMap: Map<string, CardDef>;
  private stationMap: Map<string, StationDef>;
  private lastMoveTurnCount = -1;
  private avoidedAfterUndo = new Set<string>();

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
      // カード封印中またはカード使用済みならサイコロ
      if (state.cardUsedThisTurn || (player.sealTurns ?? 0) > 0) return { type: 'roll_dice' };

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

      // 6. 攻撃カード（トップのライバルを狙う・CPUの強さに応じて積極性が変化）
      const persona = getCpuPersona(player.name);
      if (topRival && topRival.rank < player.rank && Math.random() < persona.attackChance) {
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
          if (!card || card.passive || card.category === 'devil') continue;
          if (card.category === 'economy' && card.id !== 'shuffle_all' && card.id !== 'summon_all') {
            return { type: 'use_card', cardIndex: i };
          }
        }
      }

      return { type: 'roll_dice' };
    }

    if (state.phase === 'moving') {
      if (this.lastMoveTurnCount !== state.turnCount) {
        this.lastMoveTurnCount = state.turnCount;
        this.avoidedAfterUndo.clear();
      }
      const rawCandidates = state.availableNextStations;
      const forwardOnly = rawCandidates.filter(
        (id) => id !== state.undoStationId && !this.avoidedAfterUndo.has(id)
      );
      const candidates =
        forwardOnly.length > 0
          ? forwardOnly
          : rawCandidates.filter((id) => id !== state.undoStationId);
      const effectiveCandidates = candidates.length > 0 ? candidates : rawCandidates;
      if (effectiveCandidates.length === 0) {
        const st = this.stationMap.get(player.stationId);
        return {
          type: 'move_step',
          nextStationId: st?.neighbors[0] ?? player.stationId,
        };
      }
      // 残り1マスで目的地に隣接していれば必ずぴったりゴール！
      if (state.remainingSteps === 1 && effectiveCandidates.includes(state.destinationStationId)) {
        return { type: 'move_step', nextStationId: state.destinationStationId };
      }
      const blocked =
        (player.unchiPassTurns ?? 0) > 0
          ? undefined
          : new Set(
              Object.keys(state.unchiStations ?? {}).filter((id) => (state.unchiStations[id] ?? 0) > 0)
            );
      // 残り2マス以上で目的地通過や行き止まり（隣接1駅または封鎖で実質1駅）に入るのを避ける
      const filtered =
        state.remainingSteps > 1 && effectiveCandidates.length > 1
          ? effectiveCandidates.filter((id) => {
              if (id === state.destinationStationId) return false;
              const nbs = this.stationMap.get(id)?.neighbors ?? [];
              const openNbs = blocked ? nbs.filter((nb) => !blocked.has(nb)) : nbs;
              return openNbs.length > 1;
            })
          : effectiveCandidates;
      const pool = filtered.length > 0 ? filtered : effectiveCandidates;
      const best = this.pathfinder.getBestNextStep(
        player.stationId,
        state.destinationStationId,
        pool,
        blocked
      );
      const chosen = best ?? pool[0];
      if (chosen === state.undoStationId) {
        this.avoidedAfterUndo.add(player.stationId);
      }
      return {
        type: 'move_step',
        nextStationId: chosen,
      };
    }

    if (state.phase === 'debt_sell') {
      // 農林物件は売却対象外。独占していない安い物件から順に借金解消まで売却
      const mine = Object.values(state.ownedProperties).filter((o) => {
        if (o.ownerId !== player.id) return false;
        const st = this.stationMap.get(o.stationId);
        const def = st?.properties?.find((x) => x.id === o.propertyId);
        return def?.category !== '農林';
      });
      const scored = mine.map((o) => {
        const st = this.stationMap.get(o.stationId);
        const def = st?.properties?.find((x) => x.id === o.propertyId);
        const value = (def?.price ?? 1000) * (o.level || 1);
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

      const persona = getCpuPersona(player.name);
      let budget = Math.floor(player.money * persona.buyBudgetRatio);
      const buyIds: string[] = [];
      const upgradeIds: string[] = [];

      // 未購入物件を購入（高ランクCPUは独占を狙いやすく、高収益物件も重視）
      const unowned = station.properties
        .filter((p) => !state.ownedProperties[p.id])
        .sort((a, b) =>
          persona.level >= 4 ? b.rate * b.price - a.rate * a.price : b.price - a.price
        );

      for (const prop of unowned) {
        if (budget >= prop.price) {
          buyIds.push(prop.id);
          budget -= prop.price;
        }
      }

      // Lv2以上のCPUは余剰資金で所有物件を積極的に増資（Lv1→Lv3）
      if (persona.upgradeEnabled && budget > 0) {
        const upgradeCandidates = station.properties
          .filter((p) => {
            const owned = state.ownedProperties[p.id];
            return owned && owned.ownerId === player.id && owned.level < 3;
          })
          .sort((a, b) => b.rate - a.rate || b.price - a.price);

        for (const prop of upgradeCandidates) {
          if (budget >= prop.price) {
            upgradeIds.push(prop.id);
            budget -= prop.price;
          }
        }
      }

      if (buyIds.length > 0 || upgradeIds.length > 0) {
        return { type: 'buy_properties', propertyIds: buyIds, upgradeIds };
      }
      return { type: 'skip_buy' };
    }

    if (state.phase === 'duel_setup') {
      const rivals = state.players
        .filter((p) => p.id !== player.id)
        .sort((a, b) => b.money - a.money);
      if (rivals.length === 0) return { type: 'skip_duel' };
      const persona = getCpuPersona(player.name);
      const infl = getYearInflationMult(state.currentYear);
      const minBet = Math.round((1000 * infl) / 100) * 100;
      // 借金中かつ低レベルCPUは決闘を見送ることがある
      if (player.money < 0 && persona.level <= 2 && Math.random() < 0.5) {
        return { type: 'skip_duel' };
      }
      const target = rivals[0];
      const desiredBet =
        player.money > minBet
          ? Math.round((player.money * persona.duelRiskRatio) / 100) * 100
          : minBet;
      const bet = Math.max(minBet, desiredBet);
      return { type: 'start_duel', opponentId: target.id, bet };
    }

    if (state.phase === 'card_shop') {
      if (player.cards.length >= 5) return { type: 'skip_card_shop' };
      const availableStock = new Set(
        state.shopStockIds && state.shopStockIds.length > 0
          ? state.shopStockIds
          : ['nozomi_express', 'super_express', 'express_3', 'shield', 'express_2']
      );
      const prefer = [
        'nozomi_express',
        'super_express',
        'express_3',
        'special_move',
        'shield',
        'hecchara',
        'express_2',
      ];
      for (const cid of prefer) {
        if (!availableStock.has(cid)) continue;
        const card = this.cardMap.get(cid);
        const price = getCardShopPrice(card?.price, state.currentYear);
        if (card && player.money >= price + 1000) {
          return { type: 'buy_card_shop', cardId: cid };
        }
      }
      return { type: 'skip_card_shop' };
    }

    return { type: 'skip_buy' };
  }
}
