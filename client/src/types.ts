export type StationType =
  | 'property'
  | 'plus'
  | 'minus'
  | 'card'
  | 'nice_card'
  | 'shop'
  | 'warp'
  | 'lottery'
  | 'dubbing'
  | 'shuyu'
  | 'steal_station'
  | 'minus10';

export interface PropertyDef {
  id: string;
  name: string;
  category: string;
  price: number;
  rate: number;
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
  category: 'dice' | 'fixed_move' | 'warp' | 'attack' | 'defense' | 'economy' | 'devil';
  description: string;
  icon: string;
  price?: number;
  diceCount?: number;
  fixedSteps?: number;
  cashAmount?: number;
  multiUse?: boolean;
  canActAgain?: boolean;
  unsellable?: boolean;
  requiresTarget: boolean;
  passive?: boolean;
  rarity: 'common' | 'uncommon' | 'rare';
}

export interface NuisanceActionDef {
  id: string;
  title: string;
  description: string;
  type: 'money_loss' | 'sell_property' | 'discard_card' | 'warp_away';
  minAmount?: number;
  maxAmount?: number;
}

export interface StampDef {
  id: string;
  label: string;
  icon: string;
  color: string;
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
  stamps: StampDef[];
}

export interface OwnedProperty {
  propertyId: string;
  stationId: string;
  ownerId: string;
  level: number;
  curseRate?: number;
  curseRemainingSettlements?: number;
}

export type TurnPhase =
  | 'lobby'
  | 'action_select'
  | 'moving'
  | 'property_buy'
  | 'card_shop'
  | 'debt_sell'
  | 'settlement'
  | 'finished';

export interface PlayerPublicState {
  id: string;
  seatIndex: number;
  name: string;
  color: string;
  avatar: string;
  isCpu: boolean;
  isConnected: boolean;
  isMasterOverrideCpu: boolean;
  stationId: string;
  prevStationId: string | null;
  money: number;
  cardCount: number;
  hasNuisance: boolean;
  skipNextTurn?: boolean;
  zekkochoTurns?: number;
  sealTurns?: number;
  cowWalkTurns?: number;
  heccharaTurns?: number;
  yellowTurns?: number;
  unchiPassTurns?: number;
  allSixNext?: boolean;
  discountMode?: 'silver' | 'gold' | 'platinum' | 'cinderella' | null;
  homeStationId?: string;
  distanceToDest: number;
  totalAssets: number;
  rank: number;
}

export interface GameConfig {
  totalYears: number;
  initialMoney: number;
  cpuCount: number;
  maxPlayers: number;
  exactDestination?: boolean;
  enableRateCurse?: boolean;
  enableEconomyCycle?: boolean;
  enablePickpocket?: boolean;
}

export type LocalRuleTrigger =
  | 'every_turn_end'
  | 'month_change'
  | 'on_dice_roll'
  | 'on_destination'
  | 'on_plus_station'
  | 'on_minus_station'
  | 'on_specific_station'
  | 'on_station_type'
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
  triggerValue?: number;
  targetStationId?: string;
  targetStationType?: StationType;
  probability: number;
  target: LocalRuleTarget;
  effect: LocalRuleEffect;
  effectAmount?: number;
  effectCardId?: string;
  message: string;
}

export type NuisanceForm =
  | 'normal'
  | 'mini'
  | 'pokon'
  | 'king'
  | 'destroy'
  | 'rate_curse'
  | 'bakuretsu'
  | 'devil'
  | 'minus10'
  | 'happy';
export type EconomyPhase = 'boom' | 'normal' | 'recession';

export interface PublicGameState {
  roomId: string;
  status: 'waiting' | 'playing' | 'paused' | 'finished';
  config: GameConfig;
  currentYear: number;
  currentMonth: number;
  currentTurnPlayerId: string;
  phase: TurnPhase;
  destinationStationId: string;
  remainingSteps: number;
  availableNextStations: string[];
  recommendedNextStations: string[];
  undoStationId: string | null;
  players: PlayerPublicState[];
  ownedProperties: Record<string, OwnedProperty>;
  nuisanceTargetPlayerId: string | null;
  nuisanceForm: NuisanceForm;
  bakuretsuSteps: number;
  economyPhase: EconomyPhase;
  unchiStations: Record<string, number>;
  minus10Stations: Record<string, number>;
  lastEventMessage: string;
  eventLogs: string[];
  localRules: LocalRuleDef[];
  turnCount: number;
  canRollback: boolean;
  cardUsedThisTurn: boolean;
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
    | 'monopoly_achieved'
    | 'property_bought'
    | 'shop_traded'
    | 'nuisance_attach'
    | 'nuisance_action'
    | 'rate_curse_roulette'
    | 'card_used'
    | 'random_event'
    | 'admin_message'
    | 'year_settlement'
    | 'game_finished';
  playerId: string;
  payload: Record<string, unknown>;
}

export interface StampBroadcast {
  id: string;
  playerId: string;
  playerName: string;
  playerColor: string;
  stamp: StampDef;
}

export interface CommentBroadcast {
  id: string;
  playerId: string;
  playerName: string;
  playerColor: string;
  playerAvatar: string;
  text: string;
}

export interface SaveFileInfo {
  fileName: string;
  label: string;
  savedAt: string;
  year: number;
  month: number;
}
