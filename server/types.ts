export type StationType = 'property' | 'plus' | 'minus' | 'card' | 'nice_card' | 'shop' | 'warp';

export interface PropertyDef {
  id: string;
  name: string;
  category: string;
  price: number; // 万円単位
  rate: number;  // 収益率 (例: 0.6 = 60%)
}

export interface HeroDef {
  id: string;
  name: string;
  icon: string;
  effectType: 'cash_gift' | 'steal_money_all' | 'give_express' | 'shield_gift' | 'move_closer';
  description: string;
}

export interface StationDef {
  id: string;
  name: string;
  region: string;
  type: StationType;
  x: number;
  y: number;
  neighbors: string[];
  isDestinationCandidate: boolean;
  properties?: PropertyDef[];
  hero?: HeroDef;
}

export interface CardDef {
  id: string;
  name: string;
  category: 'dice' | 'fixed_move' | 'warp' | 'attack' | 'defense' | 'economy';
  description: string;
  icon: string;
  price?: number; // カード売り場での購入価格（万円）
  diceCount?: number;
  fixedSteps?: number;
  cashAmount?: number;
  requiresTarget: boolean;
  passive?: boolean;
  rarity: 'common' | 'uncommon' | 'rare';
}

export interface NuisanceActionDef {
  id: string;
  title: string;
  description: string;
  type:
    | 'money_loss'
    | 'money_gain'
    | 'treat_everyone'
    | 'sell_property'
    | 'downgrade_property'
    | 'discard_card'
    | 'give_card_rival'
    | 'buy_random_card'
    | 'warp_away'
    | 'nothing';
  minAmount?: number;
  maxAmount?: number;
  perPlayerAmount?: number;
  weight?: number;
}

export interface SeasonalEventDef {
  id: string;
  months: number[];
  title: string;
  icon: string;
  description: string;
  effectType: 'all_cash_bonus' | 'all_cash_loss' | 'category_bonus';
  amount?: number;
  categories?: string[];
  bonusRate?: number;
}

export interface RandomEventDef {
  id: string;
  title: string;
  icon: string;
  effectType:
    | 'property_hit'
    | 'category_hit'
    | 'free_upgrade'
    | 'lottery'
    | 'pickpocket'
    | 'free_card'
    | 'express_card'
    | 'cash_bonus'
    | 'cash_loss';
  amount?: number;
  categories?: string[];
  weight?: number;
}

export interface EventsData {
  nuisanceCharacter: {
    name: string;
    icon: string;
    actions: NuisanceActionDef[];
  };
  stationValues: {
    plusBase: number[];
    minusBase: number[];
    destinationBonusBase: number;
  };
  seasonalEvents?: SeasonalEventDef[];
  randomEvents?: RandomEventDef[];
  stamps: {
    id: string;
    label: string;
    icon: string;
    color: string;
  }[];
}

export interface OwnedProperty {
  propertyId: string;
  stationId: string;
  ownerId: string;
  level: number; // 1: 通常, 2: 増資1, 3: 増資2
}

export type TurnPhase =
  | 'lobby'
  | 'action_select'     // サイコロ or カード選択待ち
  | 'moving'            // マスタップ移動待ち
  | 'property_buy'      // 物件購入モーダル待ち
  | 'card_shop'         // カード売り場モーダル待ち
  | 'settlement'        // 年度末決算表示中
  | 'finished';         // ゲーム終了

export interface PlayerPublicState {
  id: string;
  seatIndex: number;
  name: string;
  color: string;
  avatar: string;
  isCpu: boolean;
  isConnected: boolean;
  isMasterOverrideCpu: boolean; // 管理者によりCPU代打中か
  stationId: string;
  prevStationId: string | null; // 直前にいた駅（逆戻り制限や表示用）
  money: number; // 万円
  cardCount: number;
  hasNuisance: boolean;
  skipNextTurn?: boolean;
  distanceToDest: number;
  totalAssets: number;
  rank: number;
}

export interface PlayerInternalState extends PlayerPublicState {
  token: string;
  socketId: string | null;
  cards: string[]; // cardDef.id の配列（最大8枚）
}

export interface GameConfig {
  totalYears: number;
  initialMoney: number;
  cpuCount: number;
  maxPlayers: number;
}

export type LocalRuleTrigger =
  | 'every_turn_end'
  | 'month_change'
  | 'on_dice_roll'
  | 'on_destination'
  | 'on_plus_station'
  | 'on_minus_station'
  | 'on_debt';

export type LocalRuleTarget = 'actor' | 'all' | 'top' | 'last';

export type LocalRuleEffect =
  | 'cash_delta'
  | 'give_card'
  | 'discard_card'
  | 'warp_random'
  | 'attach_nuisance'
  | 'clear_nuisance'
  | 'message_only';

export interface LocalRuleDef {
  id: string;
  name: string;
  enabled: boolean;
  trigger: LocalRuleTrigger;
  triggerValue?: number; // 対象月(1-12)やサイコロ指定出目(1-6/合計, 0=ゾロ目)など
  probability: number;   // 発動確率 (1-100)
  target: LocalRuleTarget;
  effect: LocalRuleEffect;
  effectAmount?: number; // 金額(万円)
  effectCardId?: string; // 支給カードID (空ならランダム)
  message: string;       // 発動時メッセージ ({player} で社長名に置換)
}

export interface PublicGameState {
  roomId: string;
  status: 'waiting' | 'playing' | 'paused' | 'finished';
  config: GameConfig;
  currentYear: number;
  currentMonth: number; // 4, 5, ..., 12, 1, 2, 3
  currentTurnPlayerId: string;
  phase: TurnPhase;
  destinationStationId: string;
  remainingSteps: number;
  availableNextStations: string[]; // 進行・戻りが可能な隣接駅IDリスト
  recommendedNextStations: string[]; // 目的地への最短経路となる隣接駅IDリスト
  undoStationId: string | null;    // 今ターン1歩前にいた駅（タップで歩数+1して戻れる）
  players: PlayerPublicState[];
  ownedProperties: Record<string, OwnedProperty>; // key: propertyId
  nuisanceTargetPlayerId: string | null;
  lastEventMessage: string;
  eventLogs: string[];
  localRules: LocalRuleDef[];
  turnCount: number;
  canRollback: boolean;
}

export interface GameEventSeqItem {
  type:
    | 'turn_start'
    | 'turn_fade'
    | 'warp_move'
    | 'dice_roll'
    | 'step_move'
    | 'station_effect'
    | 'destination_reached'
    | 'nuisance_attach'
    | 'nuisance_action'
    | 'card_used'
    | 'random_event'
    | 'year_settlement'
    | 'game_finished';
  playerId: string;
  payload: Record<string, unknown>;
}

export interface SavedGameSnapshot {
  version: number;
  savedAt: string;
  label?: string;
  roomId: string;
  status: 'waiting' | 'playing' | 'paused' | 'finished';
  config: GameConfig;
  currentYear: number;
  currentMonth: number;
  currentTurnIndex: number;
  phase: TurnPhase;
  destinationStationId: string;
  remainingSteps: number;
  visitedPathThisTurn: string[];
  players: PlayerInternalState[];
  ownedProperties: Record<string, OwnedProperty>;
  nuisanceTargetPlayerId: string | null;
  lastEventMessage: string;
  turnCount: number;
}
