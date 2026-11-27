import { v4 as uuidv4 } from 'uuid';
import { Pathfinder } from './pathfinder';
import { SaveManager } from './saveManager';
import {
  CardDef,
  EconomyPhase,
  EventsData,
  GameConfig,
  GameEventSeqItem,
  LocalRuleDef,
  LocalRuleTrigger,
  NuisanceForm,
  OwnedProperty,
  PlayerInternalState,
  PlayerPublicState,
  PublicGameState,
  SavedGameSnapshot,
  StationDef,
  StationOverride,
  StationType,
  TurnPhase,
} from './types';

const PLAYER_COLORS = [
  '#ef4444', // Red
  '#3b82f6', // Blue
  '#10b981', // Emerald
  '#f59e0b', // Amber
  '#8b5cf6', // Violet
  '#ec4899', // Pink
  '#06b6d4', // Cyan
  '#f97316', // Orange
];

const PLAYER_AVATARS = ['🚄', '🚂', '🚈', '🚇', '🚋', '🚝', '🚀', '🛸'];

// カード売り場のデフォルト品揃え（管理者が新規に売り場化した駅などのフォールバック）
export const SHOP_STOCK_IDS = [
  'express_2',
  'express_3',
  'super_express',
  'warp_near',
  'star_warp',
  'hecchara',
  'shield',
  'shredder_card',
  'vacuum_card',
  'unchi_card',
];

// 本家準拠：地域ごとのカード売り場品揃え（辺境の売り場ほどレア・徳政令0円が並ぶ）
export const SHOP_STOCK_BY_STATION: Record<string, string[]> = {
  // 関東（大宮・東京間）：序盤の基本移動＆防御
  route_153: [
    'express_2',
    'express_3',
    'warp_near',
    'shield',
    'hecchara',
    'unchi_card',
    'vacuum_card',
  ],
  // 近畿（京都・大阪間）：バランス型
  route_224: [
    'express_2',
    'express_3',
    'super_express',
    'star_warp',
    'hecchara',
    'shield',
    'steal_card',
    'shredder_card',
  ],
  // 中国（尾道・広島間）：攻撃・妨害特化
  route_263: [
    'express_3',
    'warp_near',
    'steal_card',
    'swap_pos',
    'pass_nuisance',
    'shredder_card',
    'unchi_card',
    'vacuum_card',
  ],
  // 九州（熊本・鹿児島間）：長距離移動＆逆転（徳政令あり）
  route_327: [
    'express_3',
    'super_express',
    'nozomi_express',
    'star_warp',
    'pass_nuisance',
    'shredder_card',
    'debt_relief',
  ],
  // 北海道（旭川・札幌間）：北のハイグレード売り場
  route_21: [
    'express_3',
    'super_express',
    'nozomi_express',
    'special_move',
    'hecchara',
    'shield',
    'card_pack',
  ],
  // 沖縄（那覇・石垣島間）：最果てレア売り場（徳政令・千載一遇・スペシャル）
  route_350: [
    'nozomi_express',
    'senzai_ichigu',
    'special_move',
    'swap_pos',
    'pass_nuisance',
    'card_pack',
    'debt_relief',
  ],
};

export function getShopStockForStation(stationId: string): string[] {
  return SHOP_STOCK_BY_STATION[stationId] ?? SHOP_STOCK_IDS;
}

// 物件の評価額（桃鉄2準拠：増資3段階・購入額×Lv）
function investedValue(price: number, level = 1): number {
  return price * level;
}

// 物件の年間収益（桃鉄2準拠：増資ごとに収益率+5%、独占で2倍）
function calcAnnualIncome(price: number, rate: number, level: number, isMonopolized: boolean): number {
  const effectiveRate = rate + (level - 1) * 0.05;
  const monoMult = isMonopolized ? 2.0 : 1.0;
  return Math.round(price * level * effectiveRate * monoMult);
}

// 本家エンジン準拠：物件価格は固定のまま、フロー（青/赤マス・目的地・貧乏神被害）のみ年数テーブルでスケール
export function getYearInflationMult(year: number): number {
  const y = Math.max(1, Math.floor(year));
  if (y === 1) return 1.0;
  if (y === 2) return 1.2;
  if (y === 3) return 1.5;
  if (y === 4) return 1.8;
  if (y === 5) return 2.2;
  if (y <= 10) return Number((2.5 + (y - 6) * 0.5).toFixed(2));
  if (y <= 20) return Number((5.0 + (y - 11) * 0.8).toFixed(2));
  if (y <= 50) return Number((13.0 + (y - 21) * 1.2).toFixed(2));
  return Number((50.0 + (y - 51) * 2.0).toFixed(2));
}

// カード売り場価格の年数倍率（短期戦でも買いやすい緩やかな上昇）
export function getCardShopPriceMultiplier(year = 1): number {
  const y = Math.max(1, Math.floor(year));
  return Number((1 + (y - 1) * 0.15).toFixed(2));
}

// カード売り場価格（0円の徳政令カードは常に0円）
export function getCardShopPrice(basePrice: number | undefined, year = 1): number {
  if (basePrice === 0) return 0;
  const base = basePrice ?? 1500;
  return Math.round((base * getCardShopPriceMultiplier(year)) / 100) * 100;
}

export class GameEngine {
  public roomId: string;
  public status: 'waiting' | 'playing' | 'paused' | 'finished' = 'waiting';
  public config: GameConfig;
  public currentYear = 1;
  public currentMonth = 4; // 4月スタート
  public currentTurnIndex = 0;
  public phase: TurnPhase = 'lobby';
  public destinationStationId = 'sapporo';
  public remainingSteps = 0;
  public visitedPathThisTurn: string[] = [];
  // 1ターンに使えるカードは1枚まで（無限連鎖防止）
  public cardUsedThisTurn = false;
  // 借金売却フェーズの復帰先（ターン開始前 or ターン終了前）
  private debtSellContext: 'turn_start' | 'turn_end' = 'turn_end';
  // 連続目的地到着ボーナス管理
  private lastDestinationWinnerId: string | null = null;
  private consecutiveDestCount = 0;
  public players: PlayerInternalState[] = [];
  public ownedProperties: Record<string, OwnedProperty> = {};
  public nuisanceTargetPlayerId: string | null = null;
  public nuisanceForm: NuisanceForm = 'normal';
  public nuisanceTurnCount = 0;
  public nuisanceFormRemainingTurns = 0;
  public currentDestOriginDistance = 16;
  public bakuretsuSteps = 0;
  public economyPhase: EconomyPhase = 'normal';
  public unchiStations: Record<string, number> = {};
  public minus10Stations: Record<string, number> = {};
  public assetHistory: { year: number; assets: Record<string, number> }[] = [];
  private playerStats: Record<
    string,
    {
      destReached: number;
      bombyTurns: number;
      duelWins: number;
      duelLosses: number;
      maxDebt: number;
      monopolies: number;
    }
  > = {};
  private milestoneWinners: Record<number, string> = {};
  private dropUnchiAfterMove = false;
  private pendingSameStationDuelIds: string[] = [];
  private activeDuelOpponentIds: string[] | null = null;
  private _lastEventMessage = 'ゲーム開始を待っています…';
  public eventLogs: string[] = [];
  public localRules: LocalRuleDef[] = [];
  public turnCount = 0;

  public get lastEventMessage(): string {
    return this._lastEventMessage;
  }

  public set lastEventMessage(msg: string) {
    this._lastEventMessage = msg;
    const tag = `[${this.currentYear}年${this.currentMonth}月] ${msg}`;
    if (this.eventLogs[0] !== tag) {
      this.eventLogs.unshift(tag);
      if (this.eventLogs.length > 30) {
        this.eventLogs.pop();
      }
    }
  }

  private previousTurnSnapshot: SavedGameSnapshot | null = null;
  private baseStations: StationDef[];
  public stations: StationDef[];
  private stationMap: Map<string, StationDef>;
  private stationOverrides: Record<string, StationOverride> = {};
  private cards: CardDef[];
  private cardMap: Map<string, CardDef>;
  private eventsData: EventsData;
  public pathfinder: Pathfinder;
  private saveManager: SaveManager;

  constructor(
    roomId: string,
    stations: StationDef[],
    cards: CardDef[],
    eventsData: EventsData,
    saveManager: SaveManager,
    config?: Partial<GameConfig>
  ) {
    this.roomId = roomId;
    this.baseStations = JSON.parse(JSON.stringify(stations));
    this.stations = JSON.parse(JSON.stringify(stations));
    this.stationMap = new Map(this.stations.map((s) => [s.id, s]));
    this.cards = cards;
    this.cardMap = new Map(cards.map((c) => [c.id, c]));
    this.eventsData = eventsData;
    this.saveManager = saveManager;
    this.localRules = saveManager.loadLocalRules();
    this.stationOverrides = saveManager.loadStationOverrides();
    this.applyAllStationOverrides();
    this.pathfinder = new Pathfinder(this.stations);
    this.config = {
      totalYears: config?.totalYears ?? 3,
      initialMoney: config?.initialMoney ?? 10000, // 1億円 (10,000万円)
      cpuCount: config?.cpuCount ?? 0,
      maxPlayers: config?.maxPlayers ?? 8,
      exactDestination: config?.exactDestination ?? true,
      enableRateCurse: config?.enableRateCurse ?? true,
      enableEconomyCycle: config?.enableEconomyCycle ?? true,
      enablePickpocket: config?.enablePickpocket ?? true,
    };
  }

  private applyStationOverrideToDef(st: StationDef, ov: StationOverride): void {
    st.type = ov.type;
    if (ov.name && ov.name.trim()) {
      st.name = ov.name.trim();
    }
    if (st.type === 'property') {
      st.isDestinationCandidate = true;
      if (!st.properties || st.properties.length === 0) {
        const cleanName = st.name.replace(/\(.*?\)/g, '').trim() || 'ご当地';
        st.properties = [
          { id: `${st.id}_p1`, name: `${cleanName}名物食堂`, category: '食品', price: 1000, rate: 0.7 },
          { id: `${st.id}_p2`, name: `${cleanName}観光ホテル`, category: '観光', price: 4000, rate: 0.2 },
          { id: `${st.id}_p3`, name: `${cleanName}駅前デパート`, category: '商業', price: 10000, rate: 0.12 },
        ];
      }
    } else {
      st.isDestinationCandidate = false;
    }
  }

  private applyAllStationOverrides(): void {
    for (const ov of Object.values(this.stationOverrides)) {
      const st = this.stationMap.get(ov.stationId);
      if (st) this.applyStationOverrideToDef(st, ov);
    }
  }

  public resetGame(newConfig: Partial<GameConfig>): void {
    this.config = {
      totalYears: newConfig.totalYears ?? this.config.totalYears,
      initialMoney: newConfig.initialMoney ?? this.config.initialMoney,
      cpuCount: newConfig.cpuCount ?? 0,
      maxPlayers: 8,
      exactDestination: newConfig.exactDestination ?? this.config.exactDestination ?? true,
      enableRateCurse: newConfig.enableRateCurse ?? this.config.enableRateCurse ?? true,
      enableEconomyCycle: newConfig.enableEconomyCycle ?? this.config.enableEconomyCycle ?? true,
      enablePickpocket: newConfig.enablePickpocket ?? this.config.enablePickpocket ?? true,
    };
    this.status = 'waiting';
    this.currentYear = 1;
    this.currentMonth = 4;
    this.currentTurnIndex = 0;
    this.phase = 'lobby';
    this.destinationStationId = this.pickRandomDestination('tokyo', { minDist: 10, maxDist: 22 });
    this.currentDestOriginDistance = this.pathfinder.getShortestDistance('tokyo', this.destinationStationId) || 16;
    this.remainingSteps = 0;
    this.visitedPathThisTurn = [];
    this.cardUsedThisTurn = false;
    this.debtSellContext = 'turn_end';
    this.lastDestinationWinnerId = null;
    this.consecutiveDestCount = 0;
    this.players = [];
    this.ownedProperties = {};
    this.nuisanceTargetPlayerId = null;
    this.nuisanceForm = 'normal';
    this.nuisanceTurnCount = 0;
    this.nuisanceFormRemainingTurns = 0;
    this.bakuretsuSteps = 0;
    this.economyPhase = 'normal';
    this.unchiStations = {};
    this.minus10Stations = {};
    this.assetHistory = [];
    this.playerStats = {};
    this.milestoneWinners = {};
    this.dropUnchiAfterMove = false;
    this.pendingSameStationDuelIds = [];
    this.activeDuelOpponentIds = null;
    this.lastEventMessage = '新しいゲームが作成されました！参加者を待っています。';
    this.turnCount = 0;
    this.previousTurnSnapshot = null;

    // 初期設定のCPU人数分をロビーに追加
    for (let i = 0; i < this.config.cpuCount; i++) {
      this.addCpuPlayer();
    }
  }

  private formatPresidentName(raw: string, fallbackIdx: number): string {
    const base = raw.trim().slice(0, 10) || `プレイヤー${fallbackIdx + 1}`;
    return base.endsWith('社長') ? base : `${base}社長`;
  }

  public addCpuPlayer(): { ok: boolean; error?: string } {
    if (this.status !== 'waiting') {
      return { ok: false, error: 'ゲーム開始後はCPUを追加できません。' };
    }
    if (this.players.length >= this.config.maxPlayers) {
      return { ok: false, error: '満員です（最大8名まで）。' };
    }

    const cpuNames = ['まめ鬼社長', '赤鬼社長', '餓鬼社長', '風神社長', 'あしゅら社長', 'えんま社長', 'さくま社長'];
    const existingNames = new Set(this.players.map((p) => p.name));
    const availableName =
      cpuNames.find((n) => !existingNames.has(n)) ?? `CPU${this.players.length + 1}社長`;

    const seatIndex = this.players.length;
    this.players.push({
      id: `cpu_${uuidv4().slice(0, 8)}`,
      seatIndex,
      name: availableName,
      color: PLAYER_COLORS[seatIndex % PLAYER_COLORS.length],
      avatar: '🤖',
      isCpu: true,
      isConnected: true,
      isMasterOverrideCpu: false,
      stationId: 'tokyo',
      prevStationId: null,
      money: this.config.initialMoney,
      cardCount: 2,
      hasNuisance: false,
      distanceToDest: 0,
      totalAssets: this.config.initialMoney,
      rank: 1,
      token: uuidv4(),
      socketId: null,
      cards: ['express_2', 'warp_near'],
    });

    this.recalculateRankingsAndDistances();
    return { ok: true };
  }

  public removePlayer(playerId: string): boolean {
    if (this.status !== 'waiting') return false;
    const idx = this.players.findIndex((p) => p.id === playerId);
    if (idx === -1) return false;
    this.players.splice(idx, 1);
    this.players.forEach((p, i) => {
      p.seatIndex = i;
      p.color = PLAYER_COLORS[i % PLAYER_COLORS.length];
    });
    this.recalculateRankingsAndDistances();
    return true;
  }

  public joinPlayer(
    name: string,
    socketId: string,
    existingToken?: string
  ): { player: PlayerInternalState; isReconnect: boolean } | { error: string } {
    // 再接続チェック
    if (existingToken) {
      const found = this.players.find((p) => p.token === existingToken);
      if (found) {
        found.socketId = socketId;
        found.isConnected = true;
        return { player: found, isReconnect: true };
      }
    }

    if (this.status !== 'waiting') {
      return { error: 'ゲームはすでに進行中です。管理者に席の割り当てを確認してください。' };
    }

    if (this.players.length >= this.config.maxPlayers) {
      return { error: '満員です（最大8名まで参加可能です）。' };
    }

    const seatIndex = this.players.length;
    const token = uuidv4();
    const newPlayer: PlayerInternalState = {
      id: `p_${uuidv4().slice(0, 8)}`,
      seatIndex,
      name: this.formatPresidentName(name, seatIndex),
      color: PLAYER_COLORS[seatIndex % PLAYER_COLORS.length],
      avatar: PLAYER_AVATARS[seatIndex % PLAYER_AVATARS.length],
      isCpu: false,
      isConnected: true,
      isMasterOverrideCpu: false,
      stationId: 'tokyo',
      prevStationId: null,
      money: this.config.initialMoney,
      cardCount: 2,
      hasNuisance: false,
      distanceToDest: 0,
      totalAssets: this.config.initialMoney,
      rank: 1,
      token,
      socketId,
      cards: ['express_2', 'warp_near'],
    };

    this.players.push(newPlayer);
    this.recalculateRankingsAndDistances();
    return { player: newPlayer, isReconnect: false };
  }

  public renamePlayer(playerId: string, newName: string): { ok: boolean; error?: string } {
    if (this.status !== 'waiting') {
      return { ok: false, error: 'ゲーム開始後は名前を変更できません。' };
    }
    const p = this.players.find((x) => x.id === playerId);
    if (!p) return { ok: false, error: 'プレイヤーが見つかりません。' };
    p.name = this.formatPresidentName(newName, p.seatIndex);
    return { ok: true };
  }

  public leavePlayer(playerId: string): boolean {
    if (this.status !== 'waiting') return false;
    return this.removePlayer(playerId);
  }

  public reclaimDisconnectedPlayer(
    playerId: string,
    socketId: string
  ): { player: PlayerInternalState } | { error: string } {
    const p = this.players.find((x) => x.id === playerId);
    if (!p || p.isCpu) {
      return { error: '指定されたプレイヤー席が見つかりません。' };
    }
    if (p.isConnected) {
      return { error: 'この席はすでに接続中です。' };
    }
    p.socketId = socketId;
    p.isConnected = true;
    p.isMasterOverrideCpu = false;
    return { player: p };
  }

  public disconnectSocket(socketId: string): PlayerInternalState | null {
    const player = this.players.find((p) => p.socketId === socketId);
    if (!player) return null;
    player.isConnected = false;
    player.socketId = null;
    return player;
  }

  public startGame(): { ok: boolean; error?: string; events: GameEventSeqItem[] } {
    if (this.status !== 'waiting') {
      return { ok: false, error: '待機状態ではありません。', events: [] };
    }

    if (this.players.length < 1) {
      return { ok: false, error: 'プレイヤーが1人もいません。「＋CPUを追加」またはスマホから参加してください。', events: [] };
    }

    // 席順を整理
    this.players.forEach((p, idx) => {
      p.seatIndex = idx;
      p.stationId = 'tokyo';
      p.prevStationId = null;
    });

    this.destinationStationId = this.pickRandomDestination('tokyo', { minDist: 10, maxDist: 22 });
    this.currentDestOriginDistance = this.pathfinder.getShortestDistance('tokyo', this.destinationStationId) || 16;
    this.status = 'playing';
    this.currentYear = 1;
    this.currentMonth = 4;
    this.currentTurnIndex = 0;
    this.phase = 'action_select';
    this.turnCount = 1;
    this.cardUsedThisTurn = false;
    this.lastEventMessage = `ゲームスタート！最初の目的地は「${this.getStationName(this.destinationStationId)}」です！`;

    this.recalculateRankingsAndDistances();
    // 開始時点（0年目）の資産履歴と統計を初期化
    this.playerStats = {};
    const initialAssets: Record<string, number> = {};
    for (const p of this.players) {
      this.playerStats[p.id] = {
        destReached: 0,
        bombyTurns: 0,
        duelWins: 0,
        duelLosses: 0,
        maxDebt: 0,
        monopolies: 0,
      };
      initialAssets[p.id] = p.totalAssets;
    }
    this.assetHistory = [{ year: 0, assets: initialAssets }];
    this.previousTurnSnapshot = this.createSnapshot();
    this.saveManager.saveAutosave(this.previousTurnSnapshot);

    const first = this.getCurrentPlayer();
    const startEvents: GameEventSeqItem[] = first
      ? [
          {
            type: 'turn_start',
            playerId: first.id,
            payload: {
              year: this.currentYear,
              month: this.currentMonth,
              playerName: first.name,
              avatar: first.avatar,
              color: first.color,
              distanceToDest: first.distanceToDest,
              isNewMonth: true,
            },
          },
        ]
      : [];

    return { ok: true, events: startEvents };
  }

  public getCurrentPlayer(): PlayerInternalState | undefined {
    return this.players[this.currentTurnIndex];
  }

  public rollDice(playerId: string, diceCount = 1): { ok: boolean; error?: string; events: GameEventSeqItem[] } {
    if (this.status !== 'playing' || this.phase !== 'action_select') {
      return { ok: false, error: '現在はサイコロを振れません。', events: [] };
    }
    const player = this.getCurrentPlayer();
    if (!player || player.id !== playerId) {
      return { ok: false, error: 'あなたのターンではありません。', events: [] };
    }

    // 牛歩中は1マス固定、絶好調中はサイコロ3個、オール6発動中はすべて6！
    let actualCount = diceCount;
    if ((player.cowWalkTurns ?? 0) > 0) {
      actualCount = 1;
    } else if ((player.zekkochoTurns ?? 0) > 0) {
      actualCount = Math.max(diceCount, 3);
    }

    const rolls: number[] = [];
    for (let i = 0; i < actualCount; i++) {
      if ((player.cowWalkTurns ?? 0) > 0) {
        rolls.push(1);
      } else if (player.allSixNext) {
        rolls.push(6);
      } else {
        rolls.push(Math.floor(Math.random() * 6) + 1);
      }
    }
    if (player.allSixNext) player.allSixNext = false;
    const total = rolls.reduce((a, b) => a + b, 0);

    this.remainingSteps = total;
    this.visitedPathThisTurn = [player.stationId];
    this.phase = 'moving';
    this.lastEventMessage = `${player.name}がサイコロを振った！ 出目: ${rolls.join(' + ')} = ${total}`;

    const events: GameEventSeqItem[] = [
      {
        type: 'dice_roll',
        playerId: player.id,
        payload: { rolls, total },
      },
    ];

    const lrEvents = this.evaluateLocalRules('on_dice_roll', player, { rolls, total });
    return { ok: true, events: [...events, ...lrEvents] };
  }

  public useCard(
    playerId: string,
    cardIndex: number,
    targetPlayerId?: string
  ): { ok: boolean; error?: string; events: GameEventSeqItem[] } {
    if (this.status !== 'playing' || this.phase !== 'action_select') {
      return { ok: false, error: '現在はカードを使えません。', events: [] };
    }
    const player = this.getCurrentPlayer();
    if (!player || player.id !== playerId) {
      return { ok: false, error: 'あなたのターンではありません。', events: [] };
    }

    const cardId = player.cards[cardIndex];
    if (!cardId) {
      return { ok: false, error: '指定されたカードが見つかりません。', events: [] };
    }
    const card = this.cardMap.get(cardId);
    if (!card) {
      return { ok: false, error: 'カード定義が見つかりません。', events: [] };
    }
    if (card.passive) {
      return { ok: false, error: 'このカードは持っているだけで自動発動します。', events: [] };
    }
    if ((player.sealTurns ?? 0) > 0) {
      return { ok: false, error: `カード封印中（あと${player.sealTurns}ターン）はカードを使えません。`, events: [] };
    }
    if (this.cardUsedThisTurn && !card.canActAgain) {
      return { ok: false, error: 'カードは1ターンに1枚までです。サイコロを振ってください。', events: [] };
    }
    if (!card.canActAgain) {
      this.cardUsedThisTurn = true;
    }

    // カード消費（multiUse周遊系は内部の残り回数5〜7回を確定管理し、周遊駅で全回復）
    player.cards.splice(cardIndex, 1);
    let keptMsg = '';
    if (card.multiUse && player.cards.length < 8) {
      player.shuyuUses = player.shuyuUses ?? {};
      const currentUses = player.shuyuUses[card.id] ?? 5 + Math.floor(Math.random() * 3);
      const remainingUses = currentUses - 1;
      if (remainingUses > 0) {
        player.shuyuUses[card.id] = remainingUses;
        player.cards.push(card.id);
        keptMsg = `（周遊カードは手元に残った！ 残りあと${remainingUses}回）`;
      } else {
        delete player.shuyuUses[card.id];
        keptMsg = '（周遊カードを使い切った！）';
      }
    }
    player.cardCount = player.cards.length;

    const events: GameEventSeqItem[] = [
      {
        type: 'card_used',
        playerId: player.id,
        payload: { cardId: card.id, cardName: card.name, icon: card.icon, targetPlayerId },
      },
    ];

    if (card.category === 'dice') {
      const baseCount = card.diceCount ?? 2;
      const count = (player.zekkochoTurns ?? 0) > 0 ? Math.max(baseCount, 3) : baseCount;
      const rolls: number[] = [];
      for (let i = 0; i < count; i++) {
        rolls.push(player.allSixNext ? 6 : Math.floor(Math.random() * 6) + 1);
      }
      if (player.allSixNext) player.allSixNext = false;
      const total = rolls.reduce((a, b) => a + b, 0);
      this.remainingSteps = total;
      this.visitedPathThisTurn = [player.stationId];
      this.dropUnchiAfterMove = card.id === 'morechauzo';
      this.phase = 'moving';

      this.lastEventMessage = `${player.name}が「${card.name}」を使用！ 出目: ${rolls.join(' + ')} = ${total}${keptMsg}`;
      events.push({ type: 'dice_roll', playerId: player.id, payload: { rolls, total } });
      return { ok: true, events };
    }

    if (card.category === 'fixed_move') {
      let steps = card.fixedSteps ?? 1;
      if (card.id === 'special_move' || card.id === 'specials_move') {
        const dist = this.pathfinder.getShortestDistance(
          player.stationId,
          this.destinationStationId
        );
        steps = dist >= 1 && dist <= 6 ? dist : 6;
      }
      this.remainingSteps = steps;
      this.visitedPathThisTurn = [player.stationId];
      this.phase = 'moving';
      this.lastEventMessage = `${player.name}が「${card.name}」を使用！ ぴったり${steps}マス進みます！${keptMsg}`;
      events.push({ type: 'dice_roll', playerId: player.id, payload: { rolls: [steps], total: steps, isFixed: true } });
      return { ok: true, events };
    }

    // 時限爆弾カードは「つかう」で他社長へ押し付けられる！
    if (card.id === 'time_bomb') {
      const target = this.players.find((p) => p.id === targetPlayerId && p.id !== player.id);
      if (target && target.cards.length < 8) {
        target.cards.push('time_bomb');
        target.cardCount = target.cards.length;
        this.lastEventMessage = `⏰ ${player.name}が時限爆弾カードを ${target.name} に押し付けた！`;
      } else {
        this.lastEventMessage = `⏰ ${player.name}は時限爆弾カードを投げ捨てた！`;
      }
      const endEvents = this.finishTurn(player);
      return { ok: true, events: [...events, ...endEvents] };
    }

    if (card.category === 'economy') {
      if (card.id === 'nearest_station') {
        const distMap = this.pathfinder.getAllDistancesFrom(player.stationId);
        const props = this.stations
          .filter((s) => s.type === 'property' && s.id !== player.stationId)
          .sort((a, b) => (distMap.get(a.id) ?? 999) - (distMap.get(b.id) ?? 999));
        if (props[0]) {
          player.prevStationId = player.stationId;
          player.stationId = props[0].id;
          this.lastEventMessage = `🚉 ${player.name}が最寄りの駅「${props[0].name}」へ移動！（再行動可）`;
          events.push({
            type: 'warp_move',
            playerId: player.id,
            payload: { stationId: props[0].id, stationName: props[0].name },
          });
        }
      } else if (card.id === 'all_six') {
        player.allSixNext = true;
        this.lastEventMessage = `🎲 ${player.name}がオール6カード発動！次のサイコロはすべて6！（再行動可）`;
      } else if (card.id === 'russell_car') {
        player.russellTurns = Math.max(player.russellTurns ?? 0, 12);
        this.lastEventMessage = `❄️ ${player.name}がラッセル車カード発動！1年間マイナス駅無効！（再行動可）`;
      } else if (card.id === 'hecchara') {
        player.heccharaTurns = Math.max(player.heccharaTurns ?? 0, 20);
        this.lastEventMessage = `🛡️ ${player.name}がへっちゃらカード発動！約2年間マイナス駅・10倍駅無効！（再行動可）`;
      } else if (card.id === 'yellow_card') {
        player.yellowTurns = Math.max(player.yellowTurns ?? 0, 6);
        this.lastEventMessage = `🟨 ${player.name}がイエローカード発動！半年間プラス/マイナス駅がカード駅化！（再行動可）`;
      } else if (card.id === 'zekkocho_card') {
        player.zekkochoTurns = Math.max(player.zekkochoTurns ?? 0, 5);
        this.lastEventMessage = `⚡ ${player.name}が絶好調カードで絶好調に突入！！（再行動可）`;
      } else if (card.id === 'unchi_totsunyu') {
        player.unchiPassTurns = Math.max(player.unchiPassTurns ?? 0, 12);
        this.lastEventMessage = `🚜 ${player.name}がうんち突入カード発動！1年間うんちを通過できる！（再行動可）`;
      } else if (card.id === 'silver_card') {
        player.discountMode = 'silver';
        this.lastEventMessage = `🥈 ${player.name}がシルバーカード発動！次の物件購入が半額に！（再行動可）`;
      } else if (card.id === 'gold_cash') {
        player.discountMode = 'gold';
        this.lastEventMessage = `🥇 ${player.name}がゴールドカード発動！次の物件購入が1/10価格に！（再行動可）`;
      } else if (card.id === 'platinum_card') {
        player.discountMode = 'platinum';
        this.lastEventMessage = `💎 ${player.name}がプラチナカード発動！次の物件駅の全物件が1/10価格に！（再行動可）`;
      } else if (card.id === 'cinderella_card') {
        player.discountMode = 'cinderella';
        this.lastEventMessage = `👠 ${player.name}がシンデレラカード発動！次の物件購入が無料に！（再行動可）`;
      } else if (card.id === 'diamond_card') {
        const gain = 100000 * this.currentYear;
        player.money += gain;
        this.lastEventMessage = `💠 ${player.name}がダイヤモンドカードを換金！ +${gain.toLocaleString()}万円！`;
        this.recalculateRankingsAndDistances();
        return { ok: true, events: [...events, ...this.finishTurn(player)] };
      } else if (card.id === 'kattekimasu') {
        const unowned: { st: StationDef; prop: NonNullable<StationDef['properties']>[number] }[] = [];
        for (const st of this.stations) {
          for (const prop of st.properties ?? []) {
            if (!this.ownedProperties[prop.id] && player.money >= prop.price) {
              unowned.push({ st, prop });
            }
          }
        }
        unowned.sort((a, b) => b.prop.price - a.prop.price);
        if (unowned[0]) {
          const { st, prop } = unowned[0];
          player.money -= prop.price;
          this.ownedProperties[prop.id] = {
            propertyId: prop.id,
            stationId: st.id,
            ownerId: player.id,
            level: 1,
          };
          this.lastEventMessage = `🛍️ 買って来ますカード発動！${st.name}の「${prop.name}」を購入！`;
        } else {
          this.lastEventMessage = `🛍️ 買って来ますカードを使ったが買える物件がなかった！`;
        }
        this.recalculateRankingsAndDistances();
        return { ok: true, events: [...events, ...this.finishTurn(player)] };
      } else if (card.id === 'tairanomasa') {
        const sum = this.players.reduce((a, p) => a + p.money, 0);
        const avg = Math.round(sum / Math.max(1, this.players.length) / 100) * 100;
        this.players.forEach((p) => (p.money = avg));
        this.lastEventMessage = `⚖️ たいらのまさカード発動！全社長の持ち金が ${avg.toLocaleString()}万円 で均等になった！`;
        this.recalculateRankingsAndDistances();
        return { ok: true, events: [...events, ...this.finishTurn(player)] };
      } else if (card.id === 'bozu_marumoke') {
        let taken = 0;
        this.players.forEach((p) => {
          if (p.id !== player.id && p.money > 0) {
            taken += p.money;
            p.money = 0;
          }
        });
        player.money += taken;
        this.lastEventMessage = `🧘 坊主丸儲けカード発動！全員から合計 +${taken.toLocaleString()}万円 を総取りした！！`;
        this.recalculateRankingsAndDistances();
        return { ok: true, events: [...events, ...this.finishTurn(player)] };
      } else if (card.id === 'oya_soudori') {
        const d1 = Math.floor(Math.random() * 6) + 1;
        const d2 = Math.floor(Math.random() * 6) + 1;
        if (d1 + d2 >= 10) {
          let taken = 0;
          this.players.forEach((p) => {
            if (p.id !== player.id && p.money > 0) {
              taken += p.money;
              p.money = 0;
            }
          });
          player.money += taken;
          this.lastEventMessage = `🎰 親の総取り成功（${d1}+${d2}=${d1 + d2}）！全員から +${taken.toLocaleString()}万円 総取り！`;
        } else {
          this.lastEventMessage = `🎰 親の総取り失敗（${d1}+${d2}=${d1 + d2}）…10以上が出なかった！`;
        }
      } else if (card.id === 'fastball_card') {
        let broken = 0;
        this.players.forEach((p) => {
          if (p.id !== player.id) {
            for (let i = 0; i < 2; i++) {
              if (p.cards.length > 0) {
                p.cards.splice(Math.floor(Math.random() * p.cards.length), 1);
                broken++;
              }
            }
            p.cardCount = p.cards.length;
          }
        });
        this.lastEventMessage = `⚾ 豪速球カード発動！他社長全員のカードを計${broken}枚粉砕！`;
        return { ok: true, events: [...events, ...this.finishTurn(player)] };
      } else if (card.id === 'fuuin_card') {
        this.players.forEach((p) => {
          if (p.id !== player.id) p.sealTurns = Math.max(p.sealTurns ?? 0, 3);
        });
        this.lastEventMessage = `🔒 ふういんカード発動！他社長全員を3ターンカード封印！`;
        return { ok: true, events: [...events, ...this.finishTurn(player)] };
      } else if (card.id === 'freeze_rival') {
        this.players.forEach((p) => {
          if (p.id !== player.id) p.skipNextTurn = true;
        });
        this.lastEventMessage = `❄️ 冬眠カード発動！他社長全員を1回休みにした！`;
        return { ok: true, events: [...events, ...this.finishTurn(player)] };
      } else if (card.id === 'kyushi_issho') {
        this.nuisanceForm = 'normal';
        this.bakuretsuSteps = 0;
        this.lastEventMessage = `⛩️ 九死に一生カード発動！変身ボンビーを通常の貧乏神に戻した！`;
        return { ok: true, events: [...events, ...this.finishTurn(player)] };
      } else if (card.id === 'king_bomb_card') {
        if (this.nuisanceTargetPlayerId) {
          const isKing = Math.random() < 0.7;
          this.nuisanceForm = isKing ? 'king' : 'mini';
          this.lastEventMessage = isKing
            ? `🔥 キングに！カード発動！貧乏神がキングボンビーに変身した！！`
            : `👶 キングに！カード発動…おっとミニボンビーに変身した！`;
        } else {
          this.lastEventMessage = `🔥 キングに！カードを使ったが貧乏神がまだいなかった！`;
        }
        return { ok: true, events: [...events, ...this.finishTurn(player)] };
      } else if (card.id === 'shuyu_kinshi') {
        let downgraded = 0;
        const mapDown: Record<string, string> = {
          express_shuyu: 'express_2',
          super_shuyu: 'express_3',
          shinkansen_shuyu: 'super_express',
          nozomi_shuyu: 'nozomi_express',
          hayabusa_shuyu: 'hayabusa',
          super_linear: 'linear_express',
        };
        this.players.forEach((p) => {
          if (p.id !== player.id) {
            p.cards = p.cards.map((cid) => {
              if (mapDown[cid]) {
                downgraded++;
                return mapDown[cid];
              }
              return cid;
            });
          }
        });
        this.lastEventMessage = `🚫 周遊禁止カード発動！他社長の周遊カード${downgraded}枚を通常カードに格下げ！`;
        return { ok: true, events: [...events, ...this.finishTurn(player)] };
      } else if (card.id === 'change_dest_card') {
        this.destinationStationId = this.pickRandomDestination(this.destinationStationId);
        this.recalculateRankingsAndDistances();
        this.lastEventMessage = `🚩 目的地変更カード発動！新しい目的地は「${this.getStationName(this.destinationStationId)}」に！`;
        return { ok: true, events: [...events, ...this.finishTurn(player)] };
      } else if (card.id === 'shredder_card') {
        const before = player.cards.length;
        player.cards = player.cards.filter((cid) => this.cardMap.get(cid)?.category !== 'devil');
        player.cardCount = player.cards.length;
        this.lastEventMessage = `🗑️ シュレッダーカード発動！デビル系カード${before - player.cards.length}枚を完全消去！`;
        return { ok: true, events: [...events, ...this.finishTurn(player)] };
      } else if (card.id === 'vacuum_card') {
        const count = Object.keys(this.unchiStations).length;
        this.unchiStations = {};
        this.lastEventMessage = `🧹 バキュームカード発動！マップ上のうんち${count}個をすべて撤去！${keptMsg}`;
        return { ok: true, events: [...events, ...this.finishTurn(player)] };
      } else if (card.id === 'extend_shuyu') {
        player.shuyuUses = player.shuyuUses ?? {};
        const multiCards = player.cards.filter((cid) => this.cardMap.get(cid)?.multiUse);
        for (const cid of multiCards) {
          player.shuyuUses[cid] = 7;
        }
        this.lastEventMessage =
          multiCards.length > 0
            ? `🔋 期間延長カード発動！周遊系カード（${multiCards.length}枚）の残り回数が最大（7回）まで全回復した！`
            : `🔋 期間延長カードを使ったが、所持中の周遊系カードがなかった。`;
        return { ok: true, events: [...events, ...this.finishTurn(player)] };
      } else if (card.id === 'kimi_ga_subete') {
        const valid = player.cards
          .map((cid) => this.cardMap.get(cid))
          .filter((c): c is CardDef => Boolean(c && c.category !== 'devil'))
          .sort((a, b) => (b.price ?? 0) - (a.price ?? 0));
        if (valid[0]) {
          player.cards = player.cards.map(() => valid[0].id);
          this.lastEventMessage = `💫 君がすべて！カード発動！手持ちカードがすべて「${valid[0].name}」になった！`;
        }
        return { ok: true, events: [...events, ...this.finishTurn(player)] };
      } else if (card.id === 'unchi_card') {
        this.unchiStations[player.stationId] = 8;
        this.lastEventMessage = `💩 うんちカード発動！${this.getStationName(player.stationId)}にうんちを落とした！`;
        return { ok: true, events: [...events, ...this.finishTurn(player)] };
      } else if (card.id === 'unchi_stalker') {
        const stId = player.prevStationId ?? player.stationId;
        this.unchiStations[stId] = 10;
        this.lastEventMessage = `💩 うんちストーカード発動！${this.getStationName(stId)}にうんちを設置！`;
        return { ok: true, events: [...events, ...this.finishTurn(player)] };
      } else if (card.id === 'unchi_3year') {
        this.unchiStations[player.stationId] = 36;
        this.lastEventMessage = `💩 3年うんちカード発動！${this.getStationName(player.stationId)}に3年間消えないうんちを落とした！`;
        return { ok: true, events: [...events, ...this.finishTurn(player)] };
      } else if (card.id === 'bachiatari') {
        this.unchiStations[this.destinationStationId] = 24;
        this.lastEventMessage = `💩 ばちあたりカード発動！目的地「${this.getStationName(this.destinationStationId)}」に殿様うんちを落とした！`;
        return { ok: true, events: [...events, ...this.finishTurn(player)] };
      } else if (card.id === 'hikikaeken' || card.id === 'card_bank_card') {
        if (player.cards.length < 8) {
          const good = this.cards.filter((c) => c.category === 'dice' || c.category === 'warp');
          const pick = good[Math.floor(Math.random() * good.length)];
          if (pick) {
            player.cards.push(pick.id);
            player.cardCount = player.cards.length;
            this.lastEventMessage = `🎫 ${card.name}で「${pick.name}」を入手した！`;
          }
        }
        return { ok: true, events: [...events, ...this.finishTurn(player)] };
      } else if (card.id === 'saikai_card') {
        const isLast = player.rank === this.players.length && this.players.length > 1;
        if (isLast) {
          player.zekkochoTurns = 5;
          player.money += 30000;
          if (player.cards.length < 8) {
            player.cards.push('shinkansen_shuyu');
            player.cardCount = player.cards.length;
          }
          this.lastEventMessage = `🔥 最下位カード大逆転発動！絶好調＋3億円＋新幹線周遊カード獲得！！`;
        } else {
          player.money += 5000;
          this.lastEventMessage = `🔥 最下位カードを使用！資金+5,000万円を獲得！`;
        }
        this.recalculateRankingsAndDistances();
        return { ok: true, events: [...events, ...this.finishTurn(player)] };
      } else if (card.id === 'shuffle_all') {
        const positions = this.players.map((p) => p.stationId);
        for (let i = positions.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [positions[i], positions[j]] = [positions[j], positions[i]];
        }
        this.players.forEach((p, idx) => {
          p.prevStationId = p.stationId;
          p.stationId = positions[idx];
        });
        this.lastEventMessage = `🔀 ${player.name}がシャッフルカードを使用！全社長の位置が入れ替わった！`;
        this.recalculateRankingsAndDistances();
        const endEvents = this.finishTurn(player);
        return { ok: true, events: [...events, ...endEvents] };
      } else if (card.id === 'typhoon_card') {
        const dmg = Math.round((2500 * getYearInflationMult(this.currentYear)) / 100) * 100;
        this.players.forEach((p) => {
          if (p.id !== player.id) p.money -= dmg;
        });
        this.lastEventMessage = `🌀 ${player.name}が台風発生カードを使用！ライバル全員に-${dmg.toLocaleString()}万円の被害！`;
      } else if (card.id === 'vampire_card') {
        let totalDrained = 0;
        this.players.forEach((p) => {
          if (p.id !== player.id && p.money > 0) {
            const drain = Math.round((p.money * 0.15) / 100) * 100;
            p.money -= drain;
            totalDrained += drain;
          }
        });
        player.money += totalDrained;
        this.lastEventMessage = `🧛 ${player.name}が吸血鬼カードを使用！全員から所持金の15%（合計 +${totalDrained.toLocaleString()}万円）を吸い取った！`;
      } else if (card.id === 'reverse_rank') {
        const mult = getYearInflationMult(this.currentYear);
        const sorted = [...this.players].sort((a, b) => a.rank - b.rank);
        const top = sorted[0];
        const isLast = player.rank === this.players.length && this.players.length > 1;
        if (isLast && top && top.id !== player.id) {
          const minSteal = Math.round((5000 * mult) / 100) * 100;
          const pctSteal = top.money > 0 ? Math.round((top.money * 0.25) / 100) * 100 : 0;
          const steal = Math.max(minSteal, pctSteal);
          top.money -= steal;
          player.money += steal;
          this.lastEventMessage = `⚔️ 下剋上発動！最下位の${player.name}が1位${top.name}から ${steal.toLocaleString()}万円を奪った！`;
        } else {
          const gain = Math.round((2000 * mult) / 100) * 100;
          player.money += gain;
          this.lastEventMessage = `⚔️ ${player.name}が下剋上カードで+${gain.toLocaleString()}万円を獲得！`;
        }
      } else if (card.id === 'big_dubbing') {
        const copied: string[] = [];
        for (let i = 0; i < 2; i++) {
          if (player.cards.length > 0 && player.cards.length < 8) {
            const cid = player.cards[Math.floor(Math.random() * player.cards.length)];
            player.cards.push(cid);
            copied.push(this.cardMap.get(cid)?.name ?? 'カード');
          }
        }
        player.cardCount = player.cards.length;
        this.lastEventMessage = `📑 ${player.name}がダブルダビングで ${copied.join('・') || '複製なし'} を増やした！`;
      } else if (card.id === 'property_boom') {
        let annualTotal = 0;
        for (const owned of Object.values(this.ownedProperties)) {
          if (owned.ownerId !== player.id) continue;
          const st = this.stationMap.get(owned.stationId);
          const prop = st?.properties?.find((p) => p.id === owned.propertyId);
          if (!prop) continue;
          const isMono = this.isStationMonopolizedBy(owned.stationId, player.id);
          annualTotal += calcAnnualIncome(prop.price, prop.rate, owned.level, isMono);
        }
        const minBonus = Math.round((1000 * getYearInflationMult(this.currentYear)) / 100) * 100;
        const bonus = Math.max(minBonus, Math.round((annualTotal * 0.5) / 100) * 100);
        player.money += bonus;
        this.lastEventMessage = `📈 全物件好景気！${player.name}は年間総収益の50% ＝ +${bonus.toLocaleString()}万円の臨時配当を獲得！`;
      } else if (card.id === 'lucky_slot') {
        const mult = getYearInflationMult(this.currentYear);
        const prizes = [2000, 5000, 10000, 20000];
        const win = Math.round((prizes[Math.floor(Math.random() * prizes.length)] * mult) / 100) * 100;
        player.money += win;
        this.lastEventMessage = `🎰 スロット大当たり！${player.name}は +${win.toLocaleString()}万円を獲得！`;
      } else if (card.id === 'super_exorcise') {
        if (player.hasNuisance) {
          player.hasNuisance = false;
          this.nuisanceTargetPlayerId = null;
          this.nuisanceForm = 'normal';
        }
        if (player.cards.length < 8) {
          player.cards.push('shield');
          player.cardCount = player.cards.length;
        }
        const shieldName = this.cardMap.get('shield')?.name ?? 'パトカード';
        this.lastEventMessage = `⛩️✨ ${player.name}が大お祓いカードでケチケチ大王を撃退＆${shieldName}獲得！`;
      } else if (card.id === 'angel_card') {
        const gain = Math.round((5000 * getYearInflationMult(this.currentYear)) / 100) * 100;
        player.money += gain;
        const safePool = this.cards.filter((c) => c.category !== 'devil');
        if (player.cards.length < 8 && safePool.length > 0) {
          const rc = safePool[Math.floor(Math.random() * safePool.length)];
          player.cards.push(rc.id);
          player.cardCount = player.cards.length;
        }
        this.lastEventMessage = `👼 ${player.name}がエンジェルカードを使用！+${gain.toLocaleString()}万円＆カード1枚獲得！`;
      } else if (card.id === 'summon_all') {
        this.players.forEach((p) => {
          if (p.id !== player.id) {
            p.prevStationId = p.stationId;
            p.stationId = player.stationId;
          }
        });
        this.lastEventMessage = `📢 ${player.name}が「サミットカード」を発動！全社長が${this.getStationName(player.stationId)}へ集合！`;
        events.push({
          type: 'warp_move',
          playerId: player.id,
          payload: {
            stationId: player.stationId,
            stationName: this.getStationName(player.stationId),
          },
        });
        this.recalculateRankingsAndDistances();
        const endEvents = this.finishTurn(player);
        return { ok: true, events: [...events, ...endEvents] };
      } else if (card.id === 'debt_relief') {
        const cleared: string[] = [];
        for (const p of this.players) {
          if (p.money < 0) {
            p.money = 0;
            cleared.push(p.name);
          }
        }
        if (cleared.length > 0) {
          this.lastEventMessage = `📜 ${player.name}が徳政令カードを発動！ ${cleared.join('・')} の借金がすべてチャラになった！`;
        } else {
          this.lastEventMessage = `📜 ${player.name}は徳政令カードを使ったが借金のある社長はいなかった。`;
        }
      } else if (card.id === 'exorcise_nuisance') {
        if (player.hasNuisance) {
          player.hasNuisance = false;
          this.nuisanceTargetPlayerId = null;
          this.lastEventMessage = `⛩️ ${player.name}がお祓いカードでケチケチ大王を追い払った！`;
        } else {
          this.lastEventMessage = `⛩️ ${player.name}はお祓いカードを使ったが憑いていなかった。`;
        }
      } else if (card.id === 'dubbing_card') {
        const copyable = player.cards.filter((cid) => this.cardMap.get(cid)?.category !== 'devil');
        if (copyable.length > 0 && player.cards.length < 8) {
          const copyId = copyable[Math.floor(Math.random() * copyable.length)];
          player.cards.push(copyId);
          player.cardCount = player.cards.length;
          const cname = this.cardMap.get(copyId)?.name ?? 'カード';
          this.lastEventMessage = `📋 ${player.name}がダビングカードで「${cname}」を複製した！`;
        } else {
          this.lastEventMessage = `📋 ${player.name}はダビングできなかった！`;
        }
      } else if (card.id === 'tax_collect') {
        const per =
          Math.round(((card.cashAmount ?? 1500) * getYearInflationMult(this.currentYear)) / 100) * 100;
        const others = this.players.filter((p) => p.id !== player.id);
        let collected = 0;
        others.forEach((o) => {
          o.money -= per;
          collected += per;
        });
        player.money += collected;
        this.lastEventMessage = `${player.name}が「${card.name}」を使用！ 全社長から合計 +${collected.toLocaleString()}万円を徴収！`;
      } else if (card.id === 'card_pack') {
        const gained: string[] = [];
        const safePool = this.cards.filter((c) => c.category !== 'devil');
        for (let i = 0; i < 2; i++) {
          if (player.cards.length < 8 && safePool.length > 0) {
            const rc = safePool[Math.floor(Math.random() * safePool.length)];
            player.cards.push(rc.id);
            gained.push(rc.name);
          }
        }
        player.cardCount = player.cards.length;
        this.lastEventMessage = `${player.name}が「${card.name}」を開封！ ${gained.join('、') || '手札満杯'} を入手！`;
      } else {
        const amount =
          Math.round(((card.cashAmount ?? 3000) * getYearInflationMult(this.currentYear)) / 100) * 100;
        player.money += amount;
        this.lastEventMessage = `${player.name}が「${card.name}」を使用！ 資金 +${amount.toLocaleString()}万円！`;
      }
      this.recalculateRankingsAndDistances();
      return { ok: true, events };
    }

    if (card.category === 'warp') {
      if (card.id === 'galaxy_rail') {
        const infl = getYearInflationMult(this.currentYear);
        const galaxyCash = Math.round((50000 * infl) / 100) * 100;
        const arrivedId = this.destinationStationId;
        const arrivedStation = this.stationMap.get(arrivedId);
        const arrivedName = this.getStationName(arrivedId);
        player.money += galaxyCash;
        player.prevStationId = player.stationId;
        player.stationId = arrivedId;

        if (this.lastDestinationWinnerId === player.id) {
          this.consecutiveDestCount += 1;
        } else {
          this.lastDestinationWinnerId = player.id;
          this.consecutiveDestCount = 1;
        }
        const streakMult =
          this.consecutiveDestCount >= 3 ? 2.0 : this.consecutiveDestCount === 2 ? 1.5 : 1.0;
        const destBonus =
          Math.round((this.eventsData.stationValues.destinationBonusBase * infl * streakMult) / 100) * 100;
        player.money += destBonus;
        this.ensurePlayerStats(player.id).destReached += 1;

        const nextDestId = this.pickRandomDestination(arrivedId);
        this.currentDestOriginDistance =
          this.pathfinder.getShortestDistance(arrivedId, nextDestId) || 20;
        this.destinationStationId = nextDestId;
        const nextDestName = this.getStationName(nextDestId);
        this.recalculateRankingsAndDistances();

        this.lastEventMessage = `🌌 銀河鉄道カード発動！+${galaxyCash.toLocaleString()}万円＆目的地「${arrivedName}」ゴール（+${destBonus.toLocaleString()}万円）！次の目的地は「${nextDestName}」！`;
        events.push({
          type: 'warp_move',
          playerId: player.id,
          payload: { stationId: arrivedId, stationName: arrivedName },
        });
        events.push({
          type: 'destination_reached',
          playerId: player.id,
          payload: {
            stationId: arrivedId,
            stationName: arrivedName,
            bonus: destBonus,
            streak: this.consecutiveDestCount,
            nextDestName,
          },
        });
        if (this.players.length > 1) {
          const others = this.players.filter((p) => p.id !== player.id);
          others.sort((a, b) => b.distanceToDest - a.distanceToDest);
          const unlucky = others[0];
          this.players.forEach((p) => (p.hasNuisance = false));
          unlucky.hasNuisance = true;
          this.nuisanceTargetPlayerId = unlucky.id;
          this.nuisanceForm = 'normal';
          this.nuisanceTurnCount = 0;
          this.nuisanceFormRemainingTurns = 0;
          this.bakuretsuSteps = 0;
          events.push({
            type: 'nuisance_attach',
            playerId: unlucky.id,
            payload: {
              targetName: unlucky.name,
              nuisanceName: this.eventsData.nuisanceCharacter.name,
              icon: this.eventsData.nuisanceCharacter.icon,
            },
          });
        }
        if (arrivedStation?.type === 'property' && arrivedStation.properties?.length) {
          this.phase = 'property_buy';
          return { ok: true, events };
        }
        const endEvents = this.finishTurn(player);
        return { ok: true, events: [...events, ...endEvents] };
      }
      if (card.id === 'ashibumi') {
        this.lastEventMessage = `👣 ${player.name}が足踏みカードで「${this.getStationName(player.stationId)}」をもう一度踏んだ！`;
        return { ok: true, events: [...events, ...this.resolveWarpArrival(player, player.stationId)] };
      }

      let candidates = this.stations.filter(
        (s) => s.type === 'property' && s.id !== player.stationId && s.id !== this.destinationStationId
      );
      if (card.id === 'star_warp' || card.id === 'star_warp_shuyu') {
        const shops = this.stations.filter((s) => s.type === 'shop');
        if (shops.length > 0) candidates = shops;
      } else if (card.id === 'heliport_card') {
        const warps = this.stations.filter((s) => s.type === 'warp');
        if (warps.length > 0) candidates = warps;
      } else if (card.id === 'lottery_warp') {
        const lots = this.stations.filter((s) => s.type === 'lottery');
        if (lots.length > 0) candidates = lots;
      } else if (card.id === 'satogaeri') {
        const home = this.stationMap.get(player.homeStationId ?? 'tokyo');
        if (home) candidates = [home];
      } else if (card.id === 'bookmark_card') {
        const majors = ['tokyo', 'osaka', 'kyoto', 'sapporo', 'hakata']
          .map((id) => this.stationMap.get(id))
          .filter((s): s is StationDef => Boolean(s && s.id !== player.stationId));
        if (majors.length > 0) candidates = majors;
      } else if (card.id === 'prop_warp' || card.id === 'prop_warp_shuyu') {
        const buyable = candidates.filter((s) => this.canBuyOrUpgradeAtStation(player, s.id));
        if (buyable.length > 0) candidates = buyable;
      } else if (card.id === 'rob_warp' || card.id === 'rob_warp_shuyu') {
        const rivalOwned = Object.values(this.ownedProperties).filter((o) => o.ownerId !== player.id);
        if (rivalOwned.length > 0) {
          const pick = rivalOwned[Math.floor(Math.random() * rivalOwned.length)];
          const st = this.stationMap.get(pick.stationId);
          pick.ownerId = player.id;
          if (st) {
            player.prevStationId = player.stationId;
            player.stationId = st.id;
            const pName = st.properties?.find((p) => p.id === pick.propertyId)?.name ?? '物件';
            this.lastEventMessage = `🏴‍☠️ ${player.name}が強奪飛びで「${st.name}」へ飛び「${pName}」を強奪した！${keptMsg}`;
            events.push({
              type: 'warp_move',
              playerId: player.id,
              payload: { stationId: st.id, stationName: st.name },
            });
            this.recalculateRankingsAndDistances();
            return { ok: true, events: [...events, ...this.finishTurn(player)] };
          }
        }
      } else if (card.id === 'warp_near_dest') {
        const distMap = this.pathfinder.getAllDistancesFrom(this.destinationStationId);
        const adj = this.stations.filter((s) => (distMap.get(s.id) ?? 999) === 1);
        if (adj.length > 0) candidates = adj;
      } else if (card.id === 'senzai_ichigu') {
        const distMap = this.pathfinder.getAllDistancesFrom(this.destinationStationId);
        const near = this.stations.filter((s) => {
          const d = distMap.get(s.id) ?? 999;
          return d >= 1 && d <= 9 && s.id !== player.stationId;
        });
        if (near.length > 0) candidates = near;
      } else if (card.id === 'warp_north') {
        const cur = this.stationMap.get(player.stationId);
        const north = candidates.filter((s) => (cur ? s.y < cur.y : s.region === '北海道' || s.region === '東北'));
        if (north.length > 0) {
          candidates = north;
        } else {
          // すでに最北端付近の場合は北寄り上位5都市から選ぶ
          candidates = [...candidates].sort((a, b) => a.y - b.y).slice(0, 5);
        }
      } else if (card.id === 'warp_west') {
        const cur = this.stationMap.get(player.stationId);
        const west = candidates.filter((s) => (cur ? s.x < cur.x : s.region === '近畿' || s.region === '中国' || s.region === '四国'));
        if (west.length > 0) {
          candidates = west;
        } else {
          // すでに最西端付近の場合は西寄り上位5都市から選ぶ
          candidates = [...candidates].sort((a, b) => a.x - b.x).slice(0, 5);
        }
      }
      const dest = candidates[Math.floor(Math.random() * candidates.length)];
      if (dest) {
        player.prevStationId = player.stationId;
        player.stationId = dest.id;
        this.lastEventMessage = `${player.name}が「${card.name}」を使用！ ${dest.name}へワープ！`;
        events.push({
          type: 'warp_move',
          playerId: player.id,
          payload: { stationId: dest.id, stationName: dest.name },
        });
        this.recalculateRankingsAndDistances();
        return {
          ok: true,
          events: [
            ...events,
            ...this.resolveWarpArrival(player, dest.id, card.id === 'heliport_card'),
          ],
        };
      }
      this.recalculateRankingsAndDistances();
      const endEvents = this.finishTurn(player);
      return { ok: true, events: [...events, ...endEvents] };
    }

    if (card.category === 'attack') {
      const target = this.players.find((p) => p.id === targetPlayerId && p.id !== player.id);
      if (!target) {
        this.lastEventMessage = `${player.name}が「${card.name}」を使ったが対象が見つからなかった。`;
        const endEvents = this.finishTurn(player);
        return { ok: true, events: [...events, ...endEvents] };
      }

      // パトカード / パトカーズチェック
      const defense = this.consumeDefenseCard(target);
      if (defense) {
        this.lastEventMessage = `${defense.icon} ${player.name}の「${card.name}」を${target.name}が「${defense.name}」で防いだ！`;
        const endEvents = this.finishTurn(player);
        return { ok: true, events: [...events, ...endEvents] };
      }

      if (card.id === 'tokkaekko') {
        const tmp = player.money;
        player.money = target.money;
        target.money = tmp;
        this.lastEventMessage = `🔄 とっかえっこカード発動！${player.name}と${target.name}の持ち金が丸ごと入れ替わった！`;
      } else if (card.id === 'vampire_card') {
        const drain = target.money > 0 ? Math.round((target.money * 0.25) / 100) * 100 : 0;
        target.money -= drain;
        player.money += drain;
        this.lastEventMessage = `🧛 ベビキュラーカード発動！${target.name}から +${drain.toLocaleString()}万円 を吸い取った！`;
      } else if (card.id === 'money_zero') {
        target.money = 0;
        this.lastEventMessage = `0️⃣ 持ち金ゼロカード発動！${target.name}の持ち金が0円になった！`;
      } else if (card.id === 'pittari_card') {
        player.prevStationId = player.stationId;
        player.stationId = target.stationId;
        this.lastEventMessage = `🧲 ぴったりカード発動！${target.name}と同じ「${this.getStationName(target.stationId)}」へ移動！`;
        events.push({
          type: 'warp_move',
          playerId: player.id,
          payload: { stationId: target.stationId, stationName: this.getStationName(target.stationId) },
        });
        this.recalculateRankingsAndDistances();
        return { ok: true, events: [...events, ...this.resolveWarpArrival(player, target.stationId)] };
      } else if (card.id === 'unchi_target') {
        this.unchiStations[target.stationId] = 10;
        this.lastEventMessage = `💩 指定うんち！カード発動！${target.name}のいる「${this.getStationName(target.stationId)}」にうんちを落とした！`;
      } else if (card.id === 'tobichiri') {
        const st = this.stationMap.get(target.stationId);
        const nbs = (st?.neighbors ?? []).slice(0, 3);
        nbs.forEach((id) => (this.unchiStations[id] = 8));
        this.lastEventMessage = `💩 とびちりカード発動！${target.name}の周囲${nbs.length}マスにうんちをばら撒いた！`;
      } else if (card.id === 'devil_attack') {
        const devils = ['little_devil', 'devil_card', 'king_devil'];
        for (let i = 0; i < 2; i++) {
          const d = devils[Math.floor(Math.random() * devils.length)];
          if (target.cards.length < 8) target.cards.push(d);
          else target.cards[Math.floor(Math.random() * target.cards.length)] = d;
        }
        target.cardCount = target.cards.length;
        this.lastEventMessage = `😈 デビル派遣カード発動！${target.name}にデビル系カードを2枚送りつけた！`;
      } else if (card.id === 'cow_walk') {
        target.cowWalkTurns = Math.max(target.cowWalkTurns ?? 0, 3);
        this.lastEventMessage = `🐄 牛歩カード発動！${target.name}は3ターン1マスずつしか進めなくなった！`;
      } else if (card.id === 'takeover_prop' || card.id === 'takeover_shuyu') {
        const targetProps = Object.values(this.ownedProperties).filter((o) => o.ownerId === target.id);
        if (targetProps.length > 0) {
          const pick = targetProps[Math.floor(Math.random() * targetProps.length)];
          pick.ownerId = player.id;
          const st = this.stationMap.get(pick.stationId);
          const pName = st?.properties?.find((x) => x.id === pick.propertyId)?.name ?? '物件';
          this.lastEventMessage = `🏴‍☠️ ${player.name}が乗っ取りで${target.name}の「${pName}」を奪い取った！${keptMsg}`;
        } else {
          this.lastEventMessage = `🏴‍☠️ ${target.name}は物件を持っていなかった！`;
        }
      } else if (card.id === 'kogun_funto' || card.id === 'oyakugomen') {
        target.money -= 5000;
        this.lastEventMessage = `🚧 ${player.name}の「${card.name}」！${target.name}の戦略を妨害し-5,000万円！`;
      } else if (card.id === 'summon_rival') {
        target.prevStationId = target.stationId;
        target.stationId = player.stationId;
        this.lastEventMessage = `${player.name}が「${card.name}」で${target.name}を${this.getStationName(player.stationId)}へ召喚した！`;
      } else if (card.id === 'swap_pos') {
        const tmp = player.stationId;
        player.stationId = target.stationId;
        target.stationId = tmp;
        this.lastEventMessage = `${player.name}が「${card.name}」で${target.name}と場所を入れ替えた！`;
      } else if (card.id === 'rob_money') {
        const stolen = target.money > 0 ? Math.round((target.money * 0.25) / 100) * 100 : 0;
        target.money -= stolen;
        player.money += stolen;
        this.lastEventMessage = `${player.name}が${target.name}から所持金の25%（${stolen.toLocaleString()}万円）を奪った！`;
      } else if (card.id === 'steal_card') {
        if (target.cards.length > 0 && player.cards.length < 8) {
          const rIdx = Math.floor(Math.random() * target.cards.length);
          const stolenCardId = target.cards.splice(rIdx, 1)[0];
          target.cardCount = target.cards.length;
          player.cards.push(stolenCardId);
          player.cardCount = player.cards.length;
          const stolenName = this.cardMap.get(stolenCardId)?.name ?? 'カード';
          this.lastEventMessage = `${player.name}が刀狩りで${target.name}から「${stolenName}」を奪った！`;
        } else {
          this.lastEventMessage = `${player.name}は刀狩りを使ったが奪えなかった！`;
        }
      } else if (card.id === 'pass_nuisance') {
        if (player.hasNuisance) {
          player.hasNuisance = false;
          target.hasNuisance = true;
          this.nuisanceTargetPlayerId = target.id;
          this.lastEventMessage = `👹 ${player.name}がケチケチ大王を${target.name}へなすりつけた！`;
          events.push({
            type: 'nuisance_attach',
            playerId: target.id,
            payload: {
              targetName: target.name,
              nuisanceName: this.eventsData.nuisanceCharacter.name,
              icon: this.eventsData.nuisanceCharacter.icon,
              passedFrom: player.name,
            },
          });
        } else {
          this.lastEventMessage = `${player.name}にはケチケチ大王が憑いていなかった！`;
        }
      } else if (card.id === 'freeze_rival') {
        target.skipNextTurn = true;
        this.lastEventMessage = `❄️ ${player.name}が冬眠カードで${target.name}を次のターン1回休みにした！`;
      } else if (card.id === 'cow_walk') {
        const dmg = Math.round((2000 * getYearInflationMult(this.currentYear)) / 100) * 100;
        target.skipNextTurn = true;
        target.money -= dmg;
        this.lastEventMessage = `🐄 ${player.name}の牛歩カード！${target.name}は1回休み＆-${dmg.toLocaleString()}万円！`;
      } else if (card.id === 'teleport_rival') {
        player.prevStationId = player.stationId;
        player.stationId = target.stationId;
        this.lastEventMessage = `🌀 ${player.name}がテレポートで${target.name}のいる${this.getStationName(target.stationId)}へ飛んだ！`;
        events.push({
          type: 'warp_move',
          playerId: player.id,
          payload: {
            stationId: target.stationId,
            stationName: this.getStationName(target.stationId),
          },
        });
        this.recalculateRankingsAndDistances();
        return { ok: true, events: [...events, ...this.resolveWarpArrival(player, target.stationId)] };
      } else if (card.id === 'fastball_card') {
        let destroyed = 0;
        for (let i = 0; i < 2; i++) {
          if (target.cards.length > 0) {
            target.cards.splice(Math.floor(Math.random() * target.cards.length), 1);
            destroyed++;
          }
        }
        target.cardCount = target.cards.length;
        this.lastEventMessage = `⚾ ${player.name}の豪速球で${target.name}のカードを${destroyed}枚粉砕！`;
      } else if (card.id === 'fart_blow') {
        const cands = this.stations.filter((s) => s.type === 'property' && s.id !== target.stationId);
        const blown = cands[Math.floor(Math.random() * cands.length)];
        if (blown) {
          target.prevStationId = target.stationId;
          target.stationId = blown.id;
          this.lastEventMessage = `💨 ${player.name}のオナラカードで${target.name}が${blown.name}へ吹き飛んだ！`;
        }
      } else if (card.id === 'devil_attack') {
        const dmg = Math.round((4000 * getYearInflationMult(this.currentYear)) / 100) * 100;
        target.money -= dmg;
        this.lastEventMessage = `😈 ${player.name}がデビルを派遣！${target.name}は${dmg.toLocaleString()}万円の損害！`;
      } else if (card.id === 'king_bomb_card') {
        const dmg = Math.round((3500 * getYearInflationMult(this.currentYear)) / 100) * 100;
        this.players.forEach((p) => (p.hasNuisance = false));
        target.hasNuisance = true;
        this.nuisanceTargetPlayerId = target.id;
        this.nuisanceForm = 'king';
        target.money -= dmg;
        this.lastEventMessage = `🔥 ${player.name}がキング召喚！${target.name}にキングケチケチ憑依＆-${dmg.toLocaleString()}万円！`;
      } else if (card.id === 'burn_card') {
        let burned = 0;
        for (let i = 0; i < 3; i++) {
          if (target.cards.length > 0) {
            target.cards.splice(Math.floor(Math.random() * target.cards.length), 1);
            burned++;
          }
        }
        target.cardCount = target.cards.length;
        this.lastEventMessage = `🔥 ${player.name}の焼き払いカード！${target.name}のカードを${burned}枚焼却！`;
      } else if (card.id === 'takeover_prop') {
        const targetProps = Object.values(this.ownedProperties).filter((o) => o.ownerId === target.id);
        if (targetProps.length > 0) {
          const pick = targetProps[Math.floor(Math.random() * targetProps.length)];
          pick.ownerId = player.id;
          const st = this.stationMap.get(pick.stationId);
          const pName = st?.properties?.find((x) => x.id === pick.propertyId)?.name ?? '物件';
          this.lastEventMessage = `🏴‍☠️ ${player.name}が乗っ取りカードで${target.name}の「${pName}」を奪い取った！`;
        } else {
          this.lastEventMessage = `🏴‍☠️ ${target.name}は物件を持っていなかった！`;
        }
      }

      this.recalculateRankingsAndDistances();
      const endEvents = this.finishTurn(player);
      return { ok: true, events: [...events, ...endEvents] };
    }

    return { ok: true, events };
  }

  public moveStep(playerId: string, nextStationId: string): { ok: boolean; error?: string; events: GameEventSeqItem[] } {
    if (this.status !== 'playing' || this.phase !== 'moving') {
      return { ok: false, error: '現在は移動フェーズではありません。', events: [] };
    }
    const player = this.getCurrentPlayer();
    if (!player || player.id !== playerId) {
      return { ok: false, error: 'あなたのターンではありません。', events: [] };
    }

    const available = this.getAvailableNextStations(player);
    if (!available.includes(nextStationId)) {
      return { ok: false, error: 'その駅へは進めません。', events: [] };
    }

    // 直前に通ったマスへ戻る（Undo移動：残り歩数を+1回復して選び直せる）
    const undoId = this.getUndoStationId();
    if (undoId && nextStationId === undoId) {
      this.visitedPathThisTurn.pop();
      player.prevStationId = player.stationId;
      player.stationId = nextStationId;
      this.remainingSteps += 1;
      this.recalculateRankingsAndDistances();
      return {
        ok: true,
        events: [
          {
            type: 'step_move',
            playerId: player.id,
            payload: {
              stationId: nextStationId,
              stationName: this.getStationName(nextStationId),
              remainingSteps: this.remainingSteps,
              isUndo: true,
            },
          },
        ],
      };
    }

    player.prevStationId = player.stationId;
    player.stationId = nextStationId;
    this.visitedPathThisTurn.push(nextStationId);
    this.remainingSteps -= 1;

    // 到着時にうんちを落とす（もれちゃうぞカード）
    if (this.remainingSteps === 0 && this.dropUnchiAfterMove) {
      this.dropUnchiAfterMove = false;
      this.unchiStations[nextStationId] = 8;
    }

    const events: GameEventSeqItem[] = [
      {
        type: 'step_move',
        playerId: player.id,
        payload: {
          stationId: nextStationId,
          stationName: this.getStationName(nextStationId),
          remainingSteps: this.remainingSteps,
        },
      },
    ];

    // バクレツボンビー：7マス移動で大爆発！！
    if (player.hasNuisance && this.nuisanceForm === 'bakuretsu') {
      this.bakuretsuSteps += 1;
      if (this.bakuretsuSteps >= 7) {
        this.bakuretsuSteps = 0;
        const distMap = this.pathfinder.getAllDistancesFrom(nextStationId);
        const victims: string[] = [];
        const bakuretsuPenalty =
          Math.round((5000 * getYearInflationMult(this.currentYear)) / 100) * 100;
        for (const p of this.players) {
          if (p.id === player.id || (distMap.get(p.stationId) ?? 99) <= 2) {
            p.money = Math.min(0, p.money) - bakuretsuPenalty;
            p.cards = [];
            p.cardCount = 0;
            victims.push(p.name);
          }
        }
        this.nuisanceForm = 'normal';
        this.nuisanceFormRemainingTurns = 0;
        this.lastEventMessage = `💣 バクレツボンビー大爆発！！ ${victims.join('・')} の持ち金とカードが吹き飛んだ！！`;
        events.push({
          type: 'nuisance_action',
          playerId: player.id,
          payload: {
            blocked: false,
            title: '💣 バクレツボンビー大爆発！！',
            description: `7マス移動でカウント0！${victims.join('・')}の持ち金とカードが全消滅＋修理費-${bakuretsuPenalty.toLocaleString()}万円！！`,
            icon: '💣',
          },
        });
      }
    }

    // いただきますカード（自動）：他社長と同じマスを通過・停車で1枚奪う
    if (player.cards.includes('itadakimasu') && player.cards.length < 8) {
      const rival = this.players.find(
        (p) => p.id !== player.id && p.stationId === nextStationId && p.cards.length > 0
      );
      if (rival) {
        const stolenId = rival.cards.splice(Math.floor(Math.random() * rival.cards.length), 1)[0];
        rival.cardCount = rival.cards.length;
        const itadaIdx = player.cards.indexOf('itadakimasu');
        if (itadaIdx !== -1) player.cards.splice(itadaIdx, 1);
        player.cards.push(stolenId);
        player.cardCount = player.cards.length;
        const cName = this.cardMap.get(stolenId)?.name ?? 'カード';
        this.lastEventMessage = `🙏 いただきますカード発動！${player.name}が${rival.name}から「${cName}」を奪った！`;
      }
    }

    // 目的地到達チェック（exactDestination ONなら残り歩数0必須、OFFなら通過でも到達）
    const mustBeExact = this.config.exactDestination !== false;
    if (nextStationId === this.destinationStationId && (!mustBeExact || this.remainingSteps === 0)) {
      this.remainingSteps = 0;
      if (this.lastDestinationWinnerId === player.id) {
        this.consecutiveDestCount += 1;
      } else {
        this.lastDestinationWinnerId = player.id;
        this.consecutiveDestCount = 1;
      }
      const streakMult =
        this.consecutiveDestCount >= 3 ? 2.0 : this.consecutiveDestCount === 2 ? 1.5 : 1.0;
      const distMult = Math.max(
        0.8,
        Math.min(2.5, Math.round((Math.max(10, this.currentDestOriginDistance) / 20) * 10) / 10)
      );
      const baseBonus =
        this.eventsData.stationValues.destinationBonusBase * getYearInflationMult(this.currentYear);
      let bonus = Math.round((baseBonus * distMult * streakMult) / 100) * 100;

      // 骨折り損カード所持で0円、虎につばさカード所持で2倍！
      const honeIdx = player.cards.indexOf('honeori_zon');
      const toraIdx = player.cards.indexOf('tora_tsubasa');
      if (honeIdx !== -1) {
        player.cards.splice(honeIdx, 1);
        player.cardCount = player.cards.length;
        bonus = 0;
      } else if (toraIdx !== -1) {
        player.cards.splice(toraIdx, 1);
        player.cardCount = player.cards.length;
        bonus *= 2;
      }
      player.money += bonus;

      // お殿様カード所持の他社長にも同額の援助金が入る！
      for (const other of this.players) {
        if (other.id !== player.id && other.cards.includes('tonosama_card') && bonus > 0) {
          other.money += bonus;
        }
      }

    const stats = this.ensurePlayerStats(player.id);
    stats.destReached += 1;

    // 次の目的地を先に決定して演出に表示する
      const arrivedName = this.getStationName(nextStationId);
      const arrivedStation = this.stationMap.get(nextStationId);
      const nextDestId = this.pickRandomDestination(nextStationId);
      this.currentDestOriginDistance =
        this.pathfinder.getShortestDistance(nextStationId, nextDestId) || 20;
      this.destinationStationId = nextDestId;
      const nextDestName = this.getStationName(this.destinationStationId);
      this.recalculateRankingsAndDistances();

      const streakLabel =
        this.consecutiveDestCount >= 2 ? `（${this.consecutiveDestCount}回連続到着ボーナス！）` : '';
      this.lastEventMessage = `🎉 ${player.name}が目的地「${arrivedName}」にぴったり到着！ 援助金 +${bonus.toLocaleString()}万円！${streakLabel} 次の目的地は「${nextDestName}」！`;

      events.push({
        type: 'destination_reached',
        playerId: player.id,
        payload: {
          stationId: nextStationId,
          stationName: arrivedName,
          bonus,
          streak: this.consecutiveDestCount,
          nextDestName,
        },
      });
      events.push(...this.evaluateLocalRules('on_destination', player));
      events.push(
        ...this.evaluateLocalRules('on_specific_station', player, {
          stationId: nextStationId,
          stationType: arrivedStation?.type,
        })
      );
      if (arrivedStation) {
        events.push(
          ...this.evaluateLocalRules('on_station_type', player, {
            stationId: nextStationId,
            stationType: arrivedStation.type,
          })
        );
      }

      // お邪魔キャラ憑依判定：一番目的地から遠いプレイヤー（複数なら所持金が少ない方など）に憑く
      if (this.players.length > 1) {
        const candidates = this.players.filter((p) => p.id !== player.id);
        candidates.sort((a, b) => b.distanceToDest - a.distanceToDest);
        const unlucky = candidates[0];
        this.players.forEach((p) => (p.hasNuisance = false));
        unlucky.hasNuisance = true;
        this.nuisanceTargetPlayerId = unlucky.id;
        // 本家準拠：目的地到着で貧乏神が移動したときは通常形態へリセット
        this.nuisanceForm = 'normal';
        this.nuisanceTurnCount = 0;
        this.nuisanceFormRemainingTurns = 0;
        this.bakuretsuSteps = 0;
        events.push({
          type: 'nuisance_attach',
          playerId: unlucky.id,
          payload: {
            targetName: unlucky.name,
            nuisanceName: this.eventsData.nuisanceCharacter.name,
            icon: this.eventsData.nuisanceCharacter.icon,
          },
        });
      }

      // 到着駅が物件駅なら購入可否に関わらず必ず購入画面を出す
      const sameAtDest = this.players
        .filter((p) => p.id !== player.id && p.stationId === nextStationId)
        .map((p) => p.id);
      if (sameAtDest.length > 0) {
        this.pendingSameStationDuelIds = sameAtDest;
      }
      if (arrivedStation?.type === 'property' && arrivedStation.properties?.length) {
        this.phase = 'property_buy';
        return { ok: true, events };
      }

      const endEvents = this.finishTurn(player);
      return { ok: true, events: [...events, ...endEvents] };
    }

    // お邪魔キャラのなすりつけ（同じ駅を通過・到着した時）
    if (player.hasNuisance) {
      const otherAtSameStation = this.players.find(
        (p) => p.id !== player.id && p.stationId === nextStationId
      );
      if (otherAtSameStation) {
        player.hasNuisance = false;
        otherAtSameStation.hasNuisance = true;
        this.nuisanceTargetPlayerId = otherAtSameStation.id;
        events.push({
          type: 'nuisance_attach',
          playerId: otherAtSameStation.id,
          payload: {
            targetName: otherAtSameStation.name,
            nuisanceName: this.eventsData.nuisanceCharacter.name,
            icon: this.eventsData.nuisanceCharacter.icon,
            passedFrom: player.name,
          },
        });
      }
    }

    this.recalculateRankingsAndDistances();

    // 残り歩数があれば継続
    if (this.remainingSteps > 0) {
      return { ok: true, events };
    }

    // 到着マスイベント処理
    const arrivalEvents = this.resolveStationArrival(player, nextStationId);
    return { ok: true, events: [...events, ...arrivalEvents] };
  }

  // ワープ後の到着処理（通常ワープ駅の無限連鎖は防ぎつつ、ヘリポートカード等からの1段ワープは許可）
  private resolveWarpArrival(
    player: PlayerInternalState,
    stationId: string,
    allowWarpStation = false
  ): GameEventSeqItem[] {
    const st = this.stationMap.get(stationId);
    if (!st || (st.type === 'warp' && !allowWarpStation)) return this.finishTurn(player);
    return this.resolveStationArrival(player, stationId);
  }

  private resolveStationArrival(player: PlayerInternalState, stationId: string): GameEventSeqItem[] {
    const station = this.stationMap.get(stationId);
    if (!station) return this.finishTurn(player);

    const events: GameEventSeqItem[] = [];
    const yearMultiplier = getYearInflationMult(this.currentYear);
    const isSummer = this.currentMonth >= 6 && this.currentMonth <= 8;
    const isWinter = this.currentMonth >= 10 || this.currentMonth <= 3; // 桃鉄2仕様：10〜3月が冬期

    // 特定駅・特定マス種別のカスタムローカルルール評価
    const stationLocalRules = [
      ...this.evaluateLocalRules('on_specific_station', player, {
        stationId: station.id,
        stationType: station.type,
      }),
      ...this.evaluateLocalRules('on_station_type', player, {
        stationId: station.id,
        stationType: station.type,
      }),
    ];

    // イエローカード発動中はプラス・マイナス駅がカード駅化！
    let effectiveType: StationType = station.type;
    if ((player.yellowTurns ?? 0) > 0 && (effectiveType === 'plus' || effectiveType === 'minus')) {
      effectiveType = 'card';
    }
    if ((this.minus10Stations[station.id] ?? 0) > 0) {
      effectiveType = 'minus10';
    }

    // 同じマスに他の社長が止まっている場合は、マス効果後に鉢合わせチンチロ決闘を発生させる
    if (effectiveType !== 'duel' && effectiveType !== 'warp' && this.players.length > 1) {
      const sameHere = this.players
        .filter((p) => p.id !== player.id && p.stationId === stationId)
        .map((p) => p.id);
      if (sameHere.length > 0) {
        this.pendingSameStationDuelIds = sameHere;
      }
    }

    if (effectiveType === 'plus') {
      const baseList = this.eventsData.stationValues.plusBase;
      const base = baseList[Math.floor(Math.random() * baseList.length)];
      const seasonMult = isSummer ? 1.5 : isWinter ? 0.6 : 1.0;
      const econMult = this.economyPhase === 'boom' ? 1.5 : 1.0;
      const zekkoMult = (player.zekkochoTurns ?? 0) > 0 ? 3.0 : 1.0;
      const seasonTag = [
        isSummer ? '☀️ 夏のボーナス' : isWinter ? '❄️ 冬はひかえめ' : '',
        this.economyPhase === 'boom' ? '📈 好景気×1.5' : '',
        zekkoMult > 1 ? '⚡ 絶好調×3倍！' : '',
      ]
        .filter(Boolean)
        .join(' / ');
      const amount =
        Math.round((base * yearMultiplier * seasonMult * econMult * zekkoMult) / 100) * 100;
      player.money += amount;
      this.lastEventMessage = `🔵 ${player.name}がプラス駅「${station.name}」に到着！ +${amount.toLocaleString()}万円！${seasonTag ? ` (${seasonTag})` : ''}`;
      events.push({
        type: 'station_effect',
        playerId: player.id,
        payload: { stationType: 'plus', stationName: station.name, amount, seasonTag },
      });
      events.push(...this.evaluateLocalRules('on_plus_station', player));
      events.push(...stationLocalRules);
      const pickpocketEv = this.maybeTriggerPickpocket(player);
      if (pickpocketEv) events.push(pickpocketEv);
      return [...events, ...this.finishTurn(player)];
    }

    if (effectiveType === 'minus' || effectiveType === 'minus10') {
      // へっちゃらカード / ラッセル車カード効果中ならダメージ0！（発動カード名を正確に表示）
      if ((player.heccharaTurns ?? 0) > 0 || (player.russellTurns ?? 0) > 0) {
        const isHecchara = (player.heccharaTurns ?? 0) > 0;
        const cardName = isHecchara ? 'へっちゃらカード' : 'ラッセル車カード';
        const cardIcon = isHecchara ? '🛡️' : '❄️';
        this.lastEventMessage = `${cardIcon} ${cardName}効果！${player.name}はマイナス駅の被害を完全に防いだ！`;
        events.push({
          type: 'random_event',
          playerId: player.id,
          payload: {
            title: `${cardIcon} ${cardName}発動！`,
            icon: cardIcon,
            description: `${player.name}は${cardName}の効果でマイナス駅の損失を完全に無効化した！`,
            isPositive: true,
          },
        });
        return [...events, ...stationLocalRules, ...this.finishTurn(player)];
      }
      // 冬の福の神（12〜2月マイナス駅で10%逆にプラス！）
      if ((this.currentMonth === 12 || this.currentMonth <= 2) && Math.random() < 0.1) {
        const gift = 3000;
        player.money += gift;
        this.lastEventMessage = `🎅 冬の福の神出現！マイナス駅なのに${player.name}は +${gift.toLocaleString()}万円 を獲得！`;
        events.push({
          type: 'random_event',
          playerId: player.id,
          payload: {
            title: '🎅 冬の福の神 降臨！',
            icon: '🎅',
            description: `マイナス駅なのに奇跡！${player.name}に +${gift.toLocaleString()}万円 のお年玉！`,
            isPositive: true,
          },
        });
        return [...events, ...stationLocalRules, ...this.finishTurn(player)];
      }

      const baseList = this.eventsData.stationValues.minusBase;
      const base = baseList[Math.floor(Math.random() * baseList.length)];
      const seasonMult = isWinter ? 1.8 : isSummer ? 0.6 : 1.0;
      const econMult = this.economyPhase === 'recession' ? 1.5 : 1.0;
      const m10Mult = effectiveType === 'minus10' ? 10.0 : 1.0;
      const beeMult = player.cards.includes('nakittsura') ? 16.0 : 1.0;
      const seasonTag = [
        effectiveType === 'minus10' ? '⚡ マイナス10倍駅！！' : '',
        beeMult > 1 ? '🐝 泣きっ面に蜂×16倍！！' : '',
        isWinter ? '❄️ 冬の厳しい出費' : isSummer ? '☀️ 夏はひかえめ' : '',
        this.economyPhase === 'recession' ? '📉 不景気×1.5' : '',
      ]
        .filter(Boolean)
        .join(' / ');
      const amount =
        Math.round((base * yearMultiplier * seasonMult * econMult * m10Mult * beeMult) / 100) * 100;
      player.money -= amount;
      this.lastEventMessage = `🔴 ${player.name}がマイナス駅「${station.name}」に到着… -${amount.toLocaleString()}万円${seasonTag ? ` (${seasonTag})` : ''}`;
      events.push({
        type: 'station_effect',
        playerId: player.id,
        payload: { stationType: 'minus', stationName: station.name, amount: -amount, seasonTag },
      });
      events.push(...this.evaluateLocalRules('on_minus_station', player));
      events.push(...stationLocalRules);
      const pickpocketEv = this.maybeTriggerPickpocket(player);
      if (pickpocketEv) events.push(pickpocketEv);
      return [...events, ...this.finishTurn(player)];
    }

    if (effectiveType === 'lottery') {
      const r = Math.random();
      const prize = r < 0.08 ? 10000 : r < 0.28 ? 3000 : r < 0.65 ? 1000 : 0;
      const label = prize === 10000 ? '🎊 1等 1億円！！' : prize === 3000 ? '✨ 2等 3,000万円！' : prize === 1000 ? '🎉 3等 1,000万円！' : '😢 残念はずれ…';
      if (prize > 0) player.money += prize;
      this.lastEventMessage = `🎟️ 宝くじ駅！${player.name}の結果は「${label}」`;
      events.push({
        type: 'random_event',
        playerId: player.id,
        payload: {
          title: `🎟️ 宝くじ駅：${label}`,
          icon: '🎟️',
          description: prize > 0 ? `${player.name}は宝くじで +${prize.toLocaleString()}万円 を獲得した！` : '今回ははずれだった…',
          isPositive: prize > 0,
        },
      });
      return [...events, ...stationLocalRules, ...this.finishTurn(player)];
    }

    if (effectiveType === 'dubbing') {
      const copyable = player.cards.filter((cid) => this.cardMap.get(cid)?.category !== 'devil');
      if (copyable.length > 0 && player.cards.length < 8) {
        const pick = copyable[Math.floor(Math.random() * copyable.length)];
        player.cards.push(pick);
        player.cardCount = player.cards.length;
        const cName = this.cardMap.get(pick)?.name ?? 'カード';
        this.lastEventMessage = `📋 ダビング駅！${player.name}は「${cName}」を複製した！`;
        events.push({
          type: 'random_event',
          playerId: player.id,
          payload: {
            title: '📋 ダビング駅 発動！',
            icon: '📋',
            description: `${player.name}の「${cName}」がもう1枚に複製された！`,
            isPositive: true,
          },
        });
      }
      return [...events, ...stationLocalRules, ...this.finishTurn(player)];
    }

    if (effectiveType === 'shuyu') {
      player.shuyuUses = player.shuyuUses ?? {};
      const multiCards = player.cards.filter((cid) => this.cardMap.get(cid)?.multiUse);
      if (multiCards.length > 0) {
        for (const cid of multiCards) {
          player.shuyuUses[cid] = 7;
        }
        this.lastEventMessage = `🔋 周遊駅！${player.name}の周遊系カード（${multiCards.length}枚）の残り回数が全回復した！`;
      } else if (player.cards.length < 8) {
        player.cards.push('express_shuyu');
        player.shuyuUses['express_shuyu'] = 7;
        player.cardCount = player.cards.length;
        this.lastEventMessage = `🔋 周遊駅！${player.name}は「急行周遊カード」を獲得した！`;
      } else {
        this.lastEventMessage = `🔋 周遊駅に到着したが、回復できる周遊カードがなかった！`;
      }
      events.push({
        type: 'random_event',
        playerId: player.id,
        payload: {
          title: '🔋 周遊駅 発動！',
          icon: '🔋',
          description:
            multiCards.length > 0
              ? `${player.name}の周遊カードの使用回数が最大（7回）まで全回復した！`
              : `${player.name}は周遊駅で急行周遊カードを獲得した！（手札満杯時は無効）`,
          isPositive: true,
        },
      });
      return [...events, ...stationLocalRules, ...this.finishTurn(player)];
    }

    if (effectiveType === 'steal_station') {
      const rivals = this.players.filter((p) => p.id !== player.id && p.cards.length > 0);
      if (rivals.length > 0 && player.cards.length < 8) {
        const target = rivals[Math.floor(Math.random() * rivals.length)];
        const stolenId = target.cards.splice(Math.floor(Math.random() * target.cards.length), 1)[0];
        target.cardCount = target.cards.length;
        player.cards.push(stolenId);
        player.cardCount = player.cards.length;
        const cName = this.cardMap.get(stolenId)?.name ?? 'カード';
        this.lastEventMessage = `⚔️ 刀狩り駅！${player.name}が${target.name}から「${cName}」を奪った！`;
        events.push({
          type: 'random_event',
          playerId: player.id,
          payload: {
            title: '⚔️ 刀狩り駅 発動！',
            icon: '⚔️',
            description: `${player.name}が${target.name}から「${cName}」を奪い取った！`,
            isPositive: true,
          },
        });
      }
      return [...events, ...stationLocalRules, ...this.finishTurn(player)];
    }

    if (effectiveType === 'card' || effectiveType === 'nice_card') {
      const isZekko = (player.zekkochoTurns ?? 0) > 0;
      const pool =
        effectiveType === 'nice_card' && isZekko
          ? this.cards.filter((c) => c.rarity === 'rare' && c.category !== 'devil')
          : effectiveType === 'nice_card' || isZekko
            ? this.cards.filter((c) => (c.rarity === 'rare' || c.rarity === 'uncommon') && c.category !== 'devil')
            : this.cards.filter((c) => c.category !== 'devil' || Math.random() < 0.08);
      const randomCard = pool[Math.floor(Math.random() * pool.length)] ?? this.cards[0];
      let gained = false;
      if (randomCard.id === 'nemimi_mizu') {
        this.players.forEach((p) => (p.hasNuisance = false));
        player.hasNuisance = true;
        this.nuisanceTargetPlayerId = player.id;
        this.nuisanceForm = 'normal';
        this.lastEventMessage = `💦 寝耳に水カードを引いた！貧乏神が${player.name}の元へ飛んできた！`;
      } else if (player.cards.length < 8) {
        player.cards.push(randomCard.id);
        player.cardCount = player.cards.length;
        gained = true;
        const prefix =
          effectiveType === 'nice_card' && isZekko
            ? '🌟スーパーカード駅'
            : effectiveType === 'nice_card' || isZekko
              ? '✨ナイスカード駅'
              : '🟡カード駅';
        this.lastEventMessage = `${prefix}で${player.name}が「${randomCard.name}」を獲得！`;
      } else {
        this.lastEventMessage = `🟡 ${player.name}は手札がいっぱい（8枚）のためカードを持てなかった！`;
      }
      events.push({
        type: 'station_effect',
        playerId: player.id,
        payload: {
          stationType: 'card',
          stationName: station.name,
          isNice: effectiveType === 'nice_card' || isZekko,
          cardName: gained ? randomCard.name : null,
          cardIcon: gained ? randomCard.icon : null,
        },
      });
      events.push(...stationLocalRules);
      return [...events, ...this.finishTurn(player)];
    }

    if (station.type === 'shop') {
      events.push(...stationLocalRules);
      // 購入できるアイテムがなくても必ずカード売り場画面を出す
      this.phase = 'card_shop';
      this.lastEventMessage = `🛒 ${player.name}がカード売り場に到着！`;
      return events;
    }

    if (effectiveType === 'duel') {
      events.push(...stationLocalRules);
      if (this.players.length > 1) {
        this.activeDuelOpponentIds = null;
        this.phase = 'duel_setup';
        this.lastEventMessage = `⚔️ ${player.name}が決闘マスに到着！対戦相手と掛け金を選んでチンチロ勝負！`;
        return events;
      }
      return [...events, ...this.finishTurn(player)];
    }

    if (station.type === 'warp') {
      events.push(...stationLocalRules);
      const candidates = this.stations.filter(
        (s) => s.type === 'property' && s.id !== player.stationId && s.id !== this.destinationStationId
      );
      const dest = candidates[Math.floor(Math.random() * candidates.length)];
      if (dest) {
        player.prevStationId = player.stationId;
        player.stationId = dest.id;
        this.recalculateRankingsAndDistances();
        this.lastEventMessage = `🟣 ${player.name}がワープ駅に到着！ ${dest.name}駅へひとっ飛び！`;
        events.push({
          type: 'random_event',
          playerId: player.id,
          payload: {
            title: '🟣 高速ワープ駅発動！',
            icon: '🚀',
            description: `${player.name}は超特急ワープで「${dest.name}駅」へ瞬間移動した！`,
            isPositive: true,
          },
        });
        events.push({
          type: 'warp_move',
          playerId: player.id,
          payload: { stationId: dest.id, stationName: dest.name },
        });
        // ワープ先の物件駅では購入可否に関わらず必ず購入画面を出す
        if (dest.type === 'property' && dest.properties?.length) {
          this.phase = 'property_buy';
          return events;
        }
      }
      return [...events, ...this.finishTurn(player)];
    }

    if (station.type === 'property') {
      events.push(...stationLocalRules);
      if (station.properties && station.properties.length > 0) {
        this.phase = 'property_buy';
        this.lastEventMessage = `🏢 ${player.name}が物件駅「${station.name}」に到着！`;
        return events;
      }
      return [...events, ...this.finishTurn(player)];
    }

    return [...events, ...stationLocalRules, ...this.finishTurn(player)];
  }

  public buyProperties(
    playerId: string,
    propertyIds: string[],
    _upgradeIds: string[] = []
  ): { ok: boolean; error?: string; events: GameEventSeqItem[] } {
    if (this.status !== 'playing' || this.phase !== 'property_buy') {
      return { ok: false, error: '現在は物件購入フェーズではありません。', events: [] };
    }
    const player = this.getCurrentPlayer();
    if (!player || player.id !== playerId) {
      return { ok: false, error: 'あなたのターンではありません。', events: [] };
    }

    const station = this.stationMap.get(player.stationId);
    if (!station || !station.properties) {
      const endEvents = this.finishTurn(player);
      return { ok: true, events: endEvents };
    }

    const propMap = new Map(station.properties.map((p) => [p.id, p]));
    const wasMonopolized = this.isStationMonopolizedBy(station.id, player.id);
    const boughtNames: string[] = [];

    let totalSpent = 0;
    let discountUsed = false;
    for (const pid of propertyIds) {
      const prop = propMap.get(pid);
      if (!prop || this.ownedProperties[pid]) continue;
      let cost = prop.price;
      if (player.discountMode === 'platinum') {
        cost = Math.floor(prop.price * 0.1);
        discountUsed = true;
      } else if (!discountUsed && player.discountMode === 'cinderella') {
        cost = 0;
        discountUsed = true;
      } else if (!discountUsed && player.discountMode === 'gold') {
        cost = Math.floor(prop.price * 0.1);
        discountUsed = true;
      } else if (!discountUsed && player.discountMode === 'silver') {
        cost = Math.floor(prop.price * 0.5);
        discountUsed = true;
      }
      if (player.money >= cost) {
        player.money -= cost;
        totalSpent += cost;
        this.ownedProperties[pid] = {
          propertyId: pid,
          stationId: station.id,
          ownerId: player.id,
          level: 1,
        };
        boughtNames.push(prop.name);
      }
    }
    if (discountUsed) player.discountMode = null;

    for (const pid of _upgradeIds) {
      const prop = propMap.get(pid);
      const owned = this.ownedProperties[pid];
      if (!prop || !owned || owned.ownerId !== player.id || owned.level >= 3) continue;
      const upgradeCost = prop.price;
      if (player.money >= upgradeCost) {
        player.money -= upgradeCost;
        totalSpent += upgradeCost;
        owned.level += 1;
        boughtNames.push(`${prop.name}(Lv${owned.level})`);
      }
    }

    const events: GameEventSeqItem[] = [];
    if (boughtNames.length > 0) {
      this.lastEventMessage = `🏢 ${player.name}が ${boughtNames.join('、')} を購入/増資しました！`;
      events.push({
        type: 'property_bought',
        playerId: player.id,
        payload: {
          stationName: station.name,
          items: boughtNames,
          totalSpent,
        },
      });
      if (!wasMonopolized && this.isStationMonopolizedBy(station.id, player.id)) {
        this.ensurePlayerStats(player.id).monopolies += 1;
        this.lastEventMessage = `👑 ${player.name}が「${station.name}駅」を独占！年間収益が2倍に！`;
        events.push({
          type: 'monopoly_achieved',
          playerId: player.id,
          payload: {
            stationName: station.name,
            heroName: station.hero?.name ?? null,
            heroIcon: station.hero?.icon ?? null,
          },
        });
      }
    } else {
      this.lastEventMessage = `${player.name}は物件を購入しませんでした。`;
    }

    const endEvents = this.finishTurn(player);
    return { ok: true, events: [...events, ...endEvents] };
  }

  public skipBuy(playerId: string): { ok: boolean; error?: string; events: GameEventSeqItem[] } {
    return this.buyProperties(playerId, [], []);
  }

  // パトカード / パトカーズ共通防御判定（発動したカード名を正確に返す）
  private consumeDefenseCard(
    player: PlayerInternalState
  ): { name: string; icon: string; broken: boolean } | null {
    const idx = player.cards.findIndex((id) => id === 'shield' || id === 'patocars');
    if (idx === -1) return null;
    const cardId = player.cards[idx];
    const def = this.cardMap.get(cardId);
    const broken = cardId === 'shield' || Math.random() < 0.35;
    if (broken) {
      player.cards.splice(idx, 1);
      player.cardCount = player.cards.length;
    }
    return {
      name: def?.name ?? 'パトカード',
      icon: def?.icon ?? '🚓',
      broken,
    };
  }

  // 本家名物「スリの銀次」遭遇判定（現金5,000万円以上でプラス/マイナス駅到着時に5%、1/4・1/2・全額の3段階）
  private maybeTriggerPickpocket(player: PlayerInternalState): GameEventSeqItem | null {
    if (this.config.enablePickpocket === false) return null;
    if (player.money < 5000 || Math.random() >= 0.05) return null;
    const defense = this.consumeDefenseCard(player);
    if (defense) {
      this.lastEventMessage = `🕵️ スリの銀次が現れたが、${player.name}は「${defense.name}」で撃退した！`;
      return {
        type: 'random_event',
        playerId: player.id,
        payload: {
          title: `${defense.icon} ${defense.name}発動！`,
          icon: defense.icon,
          description: `スリの銀次が狙ってきたが、${player.name}は${defense.name}で完全に撃退した！`,
          isPositive: true,
        },
      };
    }
    const tierRoll = Math.random();
    const rate = tierRoll < 0.55 ? 0.25 : tierRoll < 0.85 ? 0.5 : 1.0;
    const rateLabel = rate === 1.0 ? '全額' : rate === 0.5 ? '半分（50%）' : '4分の1（25%）';
    const stolen = rate === 1.0 ? player.money : Math.round((player.money * rate) / 100) * 100;
    player.money -= stolen;
    this.recalculateRankingsAndDistances();
    this.lastEventMessage = `🕵️ スリの銀次出現！${player.name}は持ち金の${rateLabel}（-${stolen.toLocaleString()}万円）をすられた！`;
    return {
      type: 'random_event',
      playerId: player.id,
      payload: {
        title: '🕵️ スリの銀次 出現！！',
        icon: '🕵️',
        description: `「へへっ、いただきだ！」${player.name}は現金の${rateLabel}（-${stolen.toLocaleString()}万円）をすられてしまった！`,
        isPositive: false,
      },
    };
  }

  public buyCardFromShop(
    playerId: string,
    cardId: string
  ): { ok: boolean; error?: string; events: GameEventSeqItem[] } {
    if (this.status !== 'playing' || this.phase !== 'card_shop') {
      return { ok: false, error: '現在はカード売り場フェーズではありません。', events: [] };
    }
    const player = this.getCurrentPlayer();
    if (!player || player.id !== playerId) {
      return { ok: false, error: 'あなたのターンではありません。', events: [] };
    }
    const card = this.cardMap.get(cardId);
    const price = getCardShopPrice(card?.price, this.currentYear);
    const stockIds = getShopStockForStation(player.stationId);
    if (!card || !stockIds.includes(card.id) || player.cards.length >= 8 || player.money < price) {
      return { ok: false, error: 'このカードは購入できません。', events: [] };
    }
    player.money -= price;
    player.cards.push(card.id);
    player.cardCount = player.cards.length;
    this.lastEventMessage = `🛒 ${player.name}が「${card.name}」を${price.toLocaleString()}万円で購入しました！`;
    this.recalculateRankingsAndDistances();
    const tradeEvent: GameEventSeqItem = {
      type: 'shop_traded',
      playerId: player.id,
      payload: {
        action: 'buy',
        cardName: card.name,
        cardIcon: card.icon,
        price,
      },
    };

    // 売り場に留まる（「買い物を終える」で終了）
    return { ok: true, events: [tradeEvent] };
  }

  public sellCardAtShop(
    playerId: string,
    cardIndex: number
  ): { ok: boolean; error?: string; events: GameEventSeqItem[] } {
    if (this.status !== 'playing' || this.phase !== 'card_shop') {
      return { ok: false, error: '現在はカード売り場フェーズではありません。', events: [] };
    }
    const player = this.getCurrentPlayer();
    if (!player || player.id !== playerId) {
      return { ok: false, error: 'あなたのターンではありません。', events: [] };
    }
    const cardId = player.cards[cardIndex];
    const card = cardId ? this.cardMap.get(cardId) : undefined;
    if (!card) {
      return { ok: false, error: '指定されたカードが見つかりません。', events: [] };
    }
    if (card.unsellable) {
      return { ok: false, error: 'このデビル系カードは売却できません！シュレッダーカード等で消去してください。', events: [] };
    }
    // 桃鉄スイッチ公式仕様：カード売値は買値の1/4（25%）
    const sellPrice = Math.floor(getCardShopPrice(card.price, this.currentYear) * 0.25);
    player.cards.splice(cardIndex, 1);
    player.cardCount = player.cards.length;
    player.money += sellPrice;
    this.recalculateRankingsAndDistances();
    this.lastEventMessage = `🛒 ${player.name}が「${card.name}」を ${sellPrice.toLocaleString()}万円で売却しました！`;
    return {
      ok: true,
      events: [
        {
          type: 'shop_traded',
          playerId: player.id,
          payload: {
            action: 'sell',
            cardName: card.name,
            cardIcon: card.icon,
            price: sellPrice,
          },
        },
      ],
    };
  }

  public skipCardShop(playerId: string): { ok: boolean; error?: string; events: GameEventSeqItem[] } {
    if (this.status !== 'playing' || this.phase !== 'card_shop') {
      return { ok: false, error: '現在はカード売り場フェーズではありません。', events: [] };
    }
    const player = this.getCurrentPlayer();
    if (!player || player.id !== playerId) {
      return { ok: false, error: 'あなたのターンではありません。', events: [] };
    }
    this.lastEventMessage = `${player.name}はカードを購入しませんでした。`;
    const endEvents = this.finishTurn(player);
    return { ok: true, events: endEvents };
  }

  private evaluateChinchiro(dice: [number, number, number]): {
    rank: number;
    name: string;
    mult: number;
    isHifumi: boolean;
  } {
    const s = [...dice].sort((a, b) => a - b);
    if (s[0] === 1 && s[1] === 1 && s[2] === 1) {
      return { rank: 100, name: 'ピンゾロ (1-1-1)', mult: 5, isHifumi: false };
    }
    if (s[0] === s[1] && s[1] === s[2]) {
      return { rank: 80 + s[0], name: `アラシ (${s[0]}-${s[0]}-${s[0]})`, mult: 3, isHifumi: false };
    }
    if (s[0] === 4 && s[1] === 5 && s[2] === 6) {
      return { rank: 70, name: 'シゴロ (4-5-6)', mult: 2, isHifumi: false };
    }
    if (s[0] === 1 && s[1] === 2 && s[2] === 3) {
      return { rank: -10, name: 'ヒフミ (1-2-3)', mult: 2, isHifumi: true };
    }
    if (s[0] === s[1]) {
      return { rank: 10 + s[2], name: `${s[2]}の目`, mult: 1, isHifumi: false };
    }
    if (s[1] === s[2]) {
      return { rank: 10 + s[0], name: `${s[0]}の目`, mult: 1, isHifumi: false };
    }
    return { rank: 0, name: '目なし', mult: 1, isHifumi: false };
  }

  private rollChinchiro(): {
    dice: [number, number, number];
    tries: number;
    rank: number;
    name: string;
    mult: number;
    isHifumi: boolean;
  } {
    let lastDice: [number, number, number] = [1, 2, 4];
    let lastEval = { rank: 0, name: '目なし', mult: 1, isHifumi: false };
    for (let tries = 1; tries <= 3; tries++) {
      const dice: [number, number, number] = [
        Math.floor(Math.random() * 6) + 1,
        Math.floor(Math.random() * 6) + 1,
        Math.floor(Math.random() * 6) + 1,
      ];
      const ev = this.evaluateChinchiro(dice);
      lastDice = dice;
      lastEval = ev;
      if (ev.rank !== 0) {
        return { dice, tries, ...ev };
      }
    }
    return { dice: lastDice, tries: 3, ...lastEval };
  }

  public resolveDuel(
    playerId: string,
    opponentId: string,
    rawBet: number
  ): { ok: boolean; error?: string; events: GameEventSeqItem[] } {
    if (this.status !== 'playing' || this.phase !== 'duel_setup') {
      return { ok: false, error: '現在は決闘フェーズではありません。', events: [] };
    }
    const challenger = this.getCurrentPlayer();
    if (!challenger || challenger.id !== playerId) {
      return { ok: false, error: 'あなたのターンではありません。', events: [] };
    }
    const opponent = this.players.find(
      (p) =>
        p.id === opponentId &&
        p.id !== challenger.id &&
        (!this.activeDuelOpponentIds || this.activeDuelOpponentIds.includes(p.id))
    );
    if (!opponent) {
      return { ok: false, error: '対戦相手が見つかりません。', events: [] };
    }
    this.activeDuelOpponentIds = null;

    const infl = getYearInflationMult(this.currentYear);
    const minBet = Math.round((1000 * infl) / 100) * 100;
    const maxBet = Math.max(minBet * 5, Math.max(0, challenger.money));
    const safeRaw = Number.isFinite(rawBet) ? rawBet : minBet;
    const bet = Math.max(minBet, Math.min(maxBet, Math.round(safeRaw / 100) * 100));

    const cRoll = this.rollChinchiro();
    const oRoll = this.rollChinchiro();

    let winnerId: string | null = null;
    let loserId: string | null = null;
    let multiplier = 1;
    let payout = 0;

    if (cRoll.rank > oRoll.rank) {
      winnerId = challenger.id;
      loserId = opponent.id;
      multiplier = oRoll.isHifumi ? Math.max(cRoll.mult, 2) : cRoll.mult;
      payout = bet * multiplier;
      challenger.money += payout;
      opponent.money -= payout;
      this.ensurePlayerStats(challenger.id).duelWins += 1;
      this.ensurePlayerStats(opponent.id).duelLosses += 1;
    } else if (oRoll.rank > cRoll.rank) {
      winnerId = opponent.id;
      loserId = challenger.id;
      multiplier = cRoll.isHifumi ? Math.max(oRoll.mult, 2) : oRoll.mult;
      payout = bet * multiplier;
      opponent.money += payout;
      challenger.money -= payout;
      this.ensurePlayerStats(opponent.id).duelWins += 1;
      this.ensurePlayerStats(challenger.id).duelLosses += 1;
    }

    const winnerName =
      winnerId === challenger.id
        ? challenger.name
        : winnerId === opponent.id
          ? opponent.name
          : null;

    this.recalculateRankingsAndDistances();
    this.lastEventMessage = winnerName
      ? `⚔️ チンチロ決闘！${challenger.name}【${cRoll.name}】 vs ${opponent.name}【${oRoll.name}】→ ${winnerName}の勝利！（${multiplier}倍・${payout.toLocaleString()}万円獲得！）`
      : `⚔️ チンチロ決闘！${challenger.name}【${cRoll.name}】 vs ${opponent.name}【${oRoll.name}】→ 引き分け！`;

    const duelEvent: GameEventSeqItem = {
      type: 'duel_result',
      playerId: challenger.id,
      payload: {
        bet,
        multiplier,
        payout,
        winnerId,
        loserId,
        winnerName,
        challenger: {
          id: challenger.id,
          name: challenger.name,
          avatar: challenger.avatar,
          color: challenger.color,
          dice: cRoll.dice,
          tries: cRoll.tries,
          handName: cRoll.name,
          mult: cRoll.mult,
          isHifumi: cRoll.isHifumi,
        },
        opponent: {
          id: opponent.id,
          name: opponent.name,
          avatar: opponent.avatar,
          color: opponent.color,
          dice: oRoll.dice,
          tries: oRoll.tries,
          handName: oRoll.name,
          mult: oRoll.mult,
          isHifumi: oRoll.isHifumi,
        },
      },
    };

    const endEvents = this.finishTurn(challenger);
    return { ok: true, events: [duelEvent, ...endEvents] };
  }

  public skipDuel(playerId: string): { ok: boolean; error?: string; events: GameEventSeqItem[] } {
    if (this.status !== 'playing' || this.phase !== 'duel_setup') {
      return { ok: false, error: '現在は決闘フェーズではありません。', events: [] };
    }
    const player = this.getCurrentPlayer();
    if (!player || player.id !== playerId) {
      return { ok: false, error: 'あなたのターンではありません。', events: [] };
    }
    this.activeDuelOpponentIds = null;
    this.lastEventMessage = `⚔️ ${player.name}は決闘を見送った。`;
    const endEvents = this.finishTurn(player);
    return { ok: true, events: endEvents };
  }

  private getPlayerProperties(playerId: string): OwnedProperty[] {
    return Object.values(this.ownedProperties).filter((o) => o.ownerId === playerId);
  }

  // 桃鉄スイッチ公式仕様：農林物件は借金時でも売却対象外（手放さずに済む）
  private getSellableProperties(playerId: string): OwnedProperty[] {
    return this.getPlayerProperties(playerId).filter((o) => {
      const st = this.stationMap.get(o.stationId);
      const def = st?.properties?.find((p) => p.id === o.propertyId);
      return def?.category !== '農林';
    });
  }

  // 借金返済のためにプレイヤーが選んだ物件を売却する（評価額の半額・農林物件は保護）
  public sellPropertiesForDebt(
    playerId: string,
    propertyIds: string[]
  ): { ok: boolean; error?: string; events: GameEventSeqItem[] } {
    if (this.status !== 'playing' || this.phase !== 'debt_sell') {
      return { ok: false, error: '現在は借金返済の物件売却フェーズではありません。', events: [] };
    }
    const player = this.getCurrentPlayer();
    if (!player || player.id !== playerId) {
      return { ok: false, error: 'あなたのターンではありません。', events: [] };
    }

    const sellable = this.getSellableProperties(player.id);
    if (sellable.length === 0) {
      return this.finishDebtSell(player, []);
    }

    // 選択された物件の売却見込みを計算し、借金解消（または売却可能物件の全売却）を満たしているか検証
    const uniqueIds = Array.from(new Set(propertyIds));
    let previewRefund = 0;
    const validTargets: { owned: OwnedProperty; name: string; refund: number }[] = [];
    for (const pid of uniqueIds) {
      const owned = this.ownedProperties[pid];
      if (!owned || owned.ownerId !== player.id) continue;
      const st = this.stationMap.get(owned.stationId);
      const def = st?.properties?.find((x) => x.id === owned.propertyId);
      if (def?.category === '農林') continue;
      const refund = Math.floor(investedValue(def?.price ?? 1000, owned.level) * 0.5);
      previewRefund += refund;
      validTargets.push({ owned, name: def?.name ?? '物件', refund });
    }

    const willStillHaveDebt = player.money + previewRefund < 0;
    const sellingAll = validTargets.length >= sellable.length;
    if (willStillHaveDebt && !sellingAll) {
      return {
        ok: false,
        error: '借金が0円以上になるまで（または全物件を売るまで）物件を選択してください。',
        events: [],
      };
    }

    const soldNames: string[] = [];
    let refundTotal = 0;
    for (const t of validTargets) {
      player.money += t.refund;
      refundTotal += t.refund;
      delete this.ownedProperties[t.owned.propertyId];
      soldNames.push(t.name);
    }

    this.recalculateRankingsAndDistances();
    const events: GameEventSeqItem[] = [];
    if (soldNames.length > 0) {
      this.lastEventMessage = `💸 ${player.name}は借金返済のため ${soldNames.join('、')} を売却した…`;
      events.push({
        type: 'random_event',
        playerId: player.id,
        payload: {
          title: `💸 ${player.name} 物件売却で借金返済`,
          icon: '💸',
          description: `「${soldNames.join('」「')}」を半額（計 +${refundTotal.toLocaleString()}万円）で売却した！${
            player.money < 0 ? `（残る借金 ${Math.abs(player.money).toLocaleString()}万円）` : ''
          }`,
          isPositive: false,
        },
      });
    }

    return this.finishDebtSell(player, events);
  }

  private finishDebtSell(
    player: PlayerInternalState,
    events: GameEventSeqItem[]
  ): { ok: boolean; events: GameEventSeqItem[] } {
    if (this.debtSellContext === 'turn_start') {
      this.phase = 'action_select';
      this.debtSellContext = 'turn_end';
      return { ok: true, events };
    }
    const nextEvents = this.advanceToNextTurn(player);
    return { ok: true, events: [...events, ...nextEvents] };
  }

  private finishTurn(player: PlayerInternalState, skipped = false): GameEventSeqItem[] {
    const events: GameEventSeqItem[] = [];

    // 同じマスに他の社長と止まった場合、マス処理完了後に鉢合わせ決闘フェーズへ移行
    if (!skipped && this.pendingSameStationDuelIds.length > 0) {
      const validOpponents = this.pendingSameStationDuelIds.filter((id) =>
        this.players.some((p) => p.id === id && p.id !== player.id)
      );
      this.pendingSameStationDuelIds = [];
      if (validOpponents.length > 0) {
        this.activeDuelOpponentIds = validOpponents;
        this.phase = 'duel_setup';
        this.recalculateRankingsAndDistances();
        this.lastEventMessage = `⚔️ ${player.name}が同じマスで鉢合わせ！チンチロ決闘に突入！`;
        return events;
      }
    }

    // お邪魔キャラの変身＆悪行発動チェック（1回休みのターンは何も起きない）
    if (!skipped && player.hasNuisance) {
      this.ensurePlayerStats(player.id).bombyTurns += 1;
      this.nuisanceTurnCount += 1;
      // 本家準拠ステートマシン：憑依経過ターンで変身確率が上昇、年数解禁＋重み付け抽選、持続ターン経過で通常へ戻る
      if (this.nuisanceForm === 'normal') {
        const transformChance = Math.min(0.36, 0.12 + (this.nuisanceTurnCount - 1) * 0.06);
        if (Math.random() < transformChance) {
          const allowRateCurse = this.config.enableRateCurse !== false;
          const weightedPool: { form: NuisanceForm; weight: number }[] =
            this.currentYear <= 2
              ? [
                  { form: 'mini', weight: 55 },
                  { form: 'happy', weight: 15 },
                  { form: 'pokon', weight: 15 },
                  { form: 'devil', weight: 15 },
                ]
              : this.currentYear <= 4
                ? [
                    { form: 'mini', weight: 25 },
                    { form: 'happy', weight: 8 },
                    { form: 'pokon', weight: 18 },
                    { form: 'devil', weight: 15 },
                    { form: 'king', weight: 18 },
                    { form: 'bakuretsu', weight: 15 },
                    ...(allowRateCurse ? [{ form: 'rate_curse' as NuisanceForm, weight: 15 }] : []),
                  ]
                : [
                    { form: 'mini', weight: 15 },
                    { form: 'happy', weight: 6 },
                    { form: 'pokon', weight: 15 },
                    { form: 'devil', weight: 12 },
                    { form: 'king', weight: 25 },
                    { form: 'bakuretsu', weight: 14 },
                    { form: 'destroy', weight: 14 },
                    { form: 'minus10', weight: 12 },
                    ...(allowRateCurse ? [{ form: 'rate_curse' as NuisanceForm, weight: 14 }] : []),
                  ];
          const totalW = weightedPool.reduce((sum, x) => sum + x.weight, 0);
          let roll = Math.random() * totalW;
          let nextForm: NuisanceForm = weightedPool[0].form;
          for (const item of weightedPool) {
            roll -= item.weight;
            if (roll <= 0) {
              nextForm = item.form;
              break;
            }
          }
          this.nuisanceForm = nextForm;
          this.nuisanceFormRemainingTurns = 2 + Math.floor(Math.random() * 3); // 2〜4ターン持続
          this.bakuretsuSteps = 0;
          const formMeta: Record<NuisanceForm, { icon: string; title: string; desc: string; positive?: boolean }> = {
            normal: { icon: '👹', title: '貧乏神に戻った', desc: '元の姿に戻った！' },
            mini: { icon: '👶', title: 'ミニボンビーに変身！', desc: 'かわいいミニボンビーに変身！出費が軽くなりそう！', positive: true },
            pokon: { icon: '💥', title: 'ポコンに変身！！', desc: '物件を吹き飛ばすポコンに変身した！！' },
            king: { icon: '🔥', title: 'キングボンビーに変身！！', desc: '最凶のキングボンビーに変身してしまった！！' },
            destroy: { icon: '🚜', title: 'デストロイ号に変身！！', desc: '通過した駅の物件を無差別破壊するデストロイ号に変身！！' },
            rate_curse: { icon: '📉', title: 'パーセントボンビー（割合ケチケチ）に変身！！', desc: '所有物件の収益率をマイナスにするパーセントボンビーに変身！！' },
            bakuretsu: { icon: '💣', title: 'バクレツボンビーに変身！！', desc: '7マス移動で大爆発するバクレツボンビーに変身！！早く誰かになすりつけろ！' },
            devil: { icon: '😈', title: 'デビルボンビーに変身！！', desc: '毎ターンデビル系カードを押し付けるデビルボンビーに変身！！' },
            minus10: { icon: '⚡', title: 'マイナ～～スボンビーに変身！！', desc: '持ち金ゼロ＆カード封印＆マイナス10倍駅を生み出すマイナ～～スボンビーに変身！！' },
            happy: { icon: '😇', title: 'ハッピー大王に変身！', desc: '奇跡！幸運を運ぶハッピー大王に変身した！', positive: true },
          };
          const m = formMeta[nextForm];
          if (nextForm === 'minus10') {
            player.money = Math.min(0, player.money);
            player.sealTurns = Math.max(player.sealTurns ?? 0, 3);
            const plusSts = this.stations.filter((s) => s.type === 'plus');
            for (let i = 0; i < 4 && plusSts.length > 0; i++) {
              const pick = plusSts[Math.floor(Math.random() * plusSts.length)];
              this.minus10Stations[pick.id] = 8;
            }
          }
          events.push({
            type: m.positive ? 'random_event' : 'nuisance_action',
            playerId: player.id,
            payload: {
              blocked: false,
              title: `${m.icon} ${m.title}`,
              description: m.desc,
              icon: m.icon,
              isPositive: Boolean(m.positive),
            },
          });
        }
      } else {
        this.nuisanceFormRemainingTurns = Math.max(0, this.nuisanceFormRemainingTurns - 1);
        if (this.nuisanceFormRemainingTurns === 0) {
          this.nuisanceForm = 'normal';
          this.bakuretsuSteps = 0;
          this.nuisanceTurnCount = 0;
        }
      }

      const inflMult = getYearInflationMult(this.currentYear);
      if (this.nuisanceForm === 'happy') {
        const bonus =
          Math.round(((Math.floor(Math.random() * 3) + 2) * 1000 * inflMult) / 100) * 100;
        player.money += bonus;
        this.lastEventMessage = `😇 ハッピー大王の祝福！${player.name}に +${bonus.toLocaleString()}万円のプレゼント！`;
        events.push({
          type: 'random_event',
          playerId: player.id,
          payload: {
            title: '😇 ハッピー大王のプレゼント！',
            icon: '😇',
            description: `${player.name}に幸運のおこづかい +${bonus.toLocaleString()}万円をプレゼント！`,
            isPositive: true,
          },
        });
      } else if (this.nuisanceForm === 'mini') {
        const loss =
          Math.round(((Math.floor(Math.random() * 4) + 3) * 100 * inflMult) / 100) * 100;
        player.money -= loss;
        events.push({
          type: 'nuisance_action',
          playerId: player.id,
          payload: {
            blocked: false,
            title: '👶 プチケチのおこづかい',
            description: `プチケチがお菓子を買った！ (-${loss.toLocaleString()}万円)`,
            icon: '👶',
          },
        });
      } else {
        // 本家準拠：パトカードはスリ・攻撃カード専用であり、貧乏神の悪行は防がない（レガシー king_shield のみ対応）
        const shieldIdx = player.cards.findIndex((id) => id === 'king_shield');
        if (shieldIdx !== -1) {
          const shieldId = player.cards.splice(shieldIdx, 1)[0];
          player.cardCount = player.cards.length;
          const shieldCard = this.cardMap.get(shieldId);
          const shieldName = shieldCard?.name ?? 'キングバリアカード';
          events.push({
            type: 'nuisance_action',
            playerId: player.id,
            payload: {
              blocked: true,
              title: `${shieldCard?.icon ?? '🛡️'} ${shieldName}発動！`,
              description: `${player.name}は${shieldName}で${
                this.nuisanceForm === 'king'
                  ? 'キングボンビー'
                  : this.nuisanceForm === 'rate_curse'
                    ? 'パーセントボンビー'
                    : this.eventsData.nuisanceCharacter.name
              }の悪行を防いだ！`,
            },
          });
        } else if (this.nuisanceForm === 'rate_curse') {
          // 割合ケチケチ：サイコロ2個を振り、合計件数の所持物件の収益率を -10/-50/-80/-100% のルーレットで期間限定マイナス化！
          const d1 = Math.floor(Math.random() * 6) + 1;
          const d2 = Math.floor(Math.random() * 6) + 1;
          const totalCount = d1 + d2;
          const rateOptions = [-0.1, -0.5, -0.8, -1.0];
          const chosenRate = rateOptions[Math.floor(Math.random() * rateOptions.length)];
          const chosenPercent = Math.round(chosenRate * 100);
          const myProps = this.getPlayerProperties(player.id);

          if (myProps.length > 0) {
            // シャッフルして最大 totalCount 件を呪う（決算2回分）
            const shuffled = [...myProps].sort(() => Math.random() - 0.5);
            const targets = shuffled.slice(0, Math.min(totalCount, shuffled.length));
            const affectedNames: string[] = [];
            for (const owned of targets) {
              owned.curseRate = chosenRate;
              owned.curseRemainingSettlements = 2;
              const st = this.stationMap.get(owned.stationId);
              const def = st?.properties?.find((p) => p.id === owned.propertyId);
              affectedNames.push(`${st?.name ?? ''}・${def?.name ?? '物件'}`);
            }
            this.lastEventMessage = `📉 割合ケチケチ発動！サイコロ[${d1}+${d2}=${totalCount}件]→ ${targets.length}件の収益率が2期連続で ${chosenPercent}% に！！`;
            events.push({
              type: 'rate_curse_roulette',
              playerId: player.id,
              payload: {
                dice: [d1, d2],
                total: totalCount,
                affectedCount: targets.length,
                curseRate: chosenRate,
                cursePercent: chosenPercent,
                affectedNames,
                remainingSettlements: 2,
              },
            });
          } else {
            const penalty = totalCount * 200;
            player.money -= penalty;
            this.lastEventMessage = `📉 割合ケチケチ発動！物件がなかったためサイコロ[${d1}+${d2}=${totalCount}]×200万＝-${penalty.toLocaleString()}万円を奪われた！`;
            events.push({
              type: 'rate_curse_roulette',
              playerId: player.id,
              payload: {
                dice: [d1, d2],
                total: totalCount,
                affectedCount: 0,
                curseRate: chosenRate,
                cursePercent: chosenPercent,
                affectedNames: [],
                fallbackPenalty: penalty,
              },
            });
          }
        } else if (this.nuisanceForm === 'pokon') {
          const myProps = this.getSellableProperties(player.id);
          if (myProps.length > 0) {
            const pick = myProps[Math.floor(Math.random() * myProps.length)];
            const st = this.stationMap.get(pick.stationId);
            const def = st?.properties?.find((p) => p.id === pick.propertyId);
            delete this.ownedProperties[pick.propertyId];
            events.push({
              type: 'nuisance_action',
              playerId: player.id,
              payload: {
                blocked: false,
                title: '💥 ポコンの物件吹き飛ばし！！',
                description: `ポコンが「${def?.name ?? '物件'}」を空の彼方へ吹き飛ばした！！`,
                icon: '💥',
              },
            });
          } else {
            const pokonLoss = Math.round((2000 * inflMult) / 100) * 100;
            player.money -= pokonLoss;
            events.push({
              type: 'nuisance_action',
              playerId: player.id,
              payload: {
                blocked: false,
                title: '💥 ポコンが大暴れ！',
                description: `吹き飛ばす物件がなかったので現金${pokonLoss.toLocaleString()}万円を奪われた！`,
                icon: '💥',
              },
            });
          }
        } else if (this.nuisanceForm === 'destroy') {
          let cur = player.stationId;
          const destroyed: string[] = [];
          for (let step = 0; step < 3; step++) {
            const st = this.stationMap.get(cur);
            if (!st || st.neighbors.length === 0) break;
            cur = st.neighbors[Math.floor(Math.random() * st.neighbors.length)];
            const propsHere = Object.values(this.ownedProperties).filter((o) => o.stationId === cur);
            if (propsHere.length > 0) {
              const victim = propsHere[0];
              const vst = this.stationMap.get(victim.stationId);
              const def = vst?.properties?.find((p) => p.id === victim.propertyId);
              delete this.ownedProperties[victim.propertyId];
              destroyed.push(`${vst?.name ?? ''}・${def?.name ?? '物件'}`);
            }
          }
          player.prevStationId = player.stationId;
          player.stationId = cur;
          events.push({
            type: 'nuisance_action',
            playerId: player.id,
            payload: {
              blocked: false,
              title: '🚜 デストロイ号 暴走！！',
              description:
                destroyed.length > 0
                  ? `${this.getStationName(cur)}まで暴走し「${destroyed.join('」「')}」を無差別破壊！！`
                  : `${this.getStationName(cur)}まで暴走移動した！（物件被害なし）`,
              icon: '🚜',
            },
          });
        } else if (this.nuisanceForm === 'devil') {
          const devils = ['little_devil', 'devil_card', 'king_devil', 'time_bomb', 'torikaeshi'];
          const added: string[] = [];
          for (let i = 0; i < 2; i++) {
            const dId = devils[Math.floor(Math.random() * devils.length)];
            if (player.cards.length < 8) player.cards.push(dId);
            else player.cards[Math.floor(Math.random() * player.cards.length)] = dId;
            added.push(this.cardMap.get(dId)?.name ?? 'デビル');
          }
          player.cardCount = player.cards.length;
          events.push({
            type: 'nuisance_action',
            playerId: player.id,
            payload: {
              blocked: false,
              title: '😈 デビルボンビーの悪魔配布！！',
              description: `「${added.join('」「')}」を強制的に押し付けられた！！`,
              icon: '😈',
            },
          });
        } else if (this.nuisanceForm === 'bakuretsu') {
          events.push({
            type: 'nuisance_action',
            playerId: player.id,
            payload: {
              blocked: false,
              title: `💣 バクレツボンビー カウントダウン！`,
              description: `爆発まであと ${Math.max(1, 7 - this.bakuretsuSteps)} マス！！急いで他社長へなすりつけろ！`,
              icon: '💣',
            },
          });
        } else if (this.nuisanceForm === 'minus10') {
          const plusSts = this.stations.filter((s) => s.type === 'plus');
          if (plusSts.length > 0) {
            const pick = plusSts[Math.floor(Math.random() * plusSts.length)];
            this.minus10Stations[pick.id] = 8;
          }
          events.push({
            type: 'nuisance_action',
            playerId: player.id,
            payload: {
              blocked: false,
              title: '⚡ マイナ～～スボンビーの呪い！',
              description: `マップ上のプラス駅がさらに「マイナス10倍駅」に変化した！！`,
              icon: '⚡',
            },
          });
        } else if (this.nuisanceForm === 'king') {
          const kingRoll = Math.random();
          if (kingRoll < 0.45) {
            const dice = Array.from({ length: 5 }, () => Math.floor(Math.random() * 6) + 1);
            const sum = dice.reduce((a, b) => a + b, 0);
            const unit = Math.round((500 * inflMult) / 100) * 100;
            const loss = sum * unit;
            player.money -= loss;
            events.push({
              type: 'nuisance_action',
              playerId: player.id,
              payload: {
                blocked: false,
                title: '🔥 キングのサイコロ5個大出費！！',
                description: `サイコロ5個の出目は [${dice.join('・')}]＝合計${sum}！ ×${unit.toLocaleString()}万で -${loss.toLocaleString()}万円を吹き飛ばされた！！`,
                icon: '🔥',
              },
            });
          } else if (kingRoll < 0.75 && player.cards.length > 0) {
            const destroyCount = Math.min(3, player.cards.length);
            for (let i = 0; i < destroyCount; i++) {
              player.cards.splice(Math.floor(Math.random() * player.cards.length), 1);
            }
            player.cardCount = player.cards.length;
            events.push({
              type: 'nuisance_action',
              playerId: player.id,
              payload: {
                blocked: false,
                title: '🔥 キングのカード大粉砕！！',
                description: `キングケチケチの炎で、${player.name}の手持ちカードが ${destroyCount}枚 焼き払われた！！`,
                icon: '🔥',
              },
            });
          } else {
            // 本家準拠：農林物件はキングボンビーの物件破壊からも保護
            const myProps = this.getSellableProperties(player.id);
            if (myProps.length > 0) {
              const target = myProps[Math.floor(Math.random() * myProps.length)];
              const st = this.stationMap.get(target.stationId);
              const def = st?.properties?.find((p) => p.id === target.propertyId);
              delete this.ownedProperties[target.propertyId];
              events.push({
                type: 'nuisance_action',
                playerId: player.id,
                payload: {
                  blocked: false,
                  title: '🔥 キングの物件破壊！！',
                  description: `キングボンビーが「${def?.name ?? '物件'}」を勝手に手放してしまった！！（売却金ゼロ！）`,
                  icon: '🔥',
                },
              });
            } else {
              const loss = Math.round((4000 * inflMult) / 100) * 100;
              player.money -= loss;
              events.push({
                type: 'nuisance_action',
                playerId: player.id,
                payload: {
                  blocked: false,
                  title: '🔥 キングの豪遊！！',
                  description: `キングボンビーが宇宙旅行へ行った！ (-${loss.toLocaleString()}万円)`,
                  icon: '🔥',
                },
              });
            }
          }
        } else {
        const actions = this.eventsData.nuisanceCharacter.actions;
        const act = this.pickWeighted(actions);
        let detail = act.description;
        let nuisanceWarpTo: StationDef | null = null;

        if (act.type === 'money_loss') {
          const min = act.minAmount ?? 1000;
          const max = act.maxAmount ?? 4000;
          const loss =
            Math.round(((min + Math.random() * (max - min)) * inflMult) / 100) * 100;
          player.money -= loss;
          detail = `${act.description} (-${loss.toLocaleString()}万円)`;
        } else if (act.type === 'money_gain') {
          const min = act.minAmount ?? 1000;
          const max = act.maxAmount ?? 1500;
          const gain =
            Math.round(((min + Math.random() * (max - min)) * inflMult) / 100) * 100;
          player.money += gain;
          detail = `${act.description} (+${gain.toLocaleString()}万円)`;
        } else if (act.type === 'treat_everyone') {
          const others = this.players.filter((p) => p.id !== player.id);
          const per = Math.round(((act.perPlayerAmount ?? 800) * inflMult) / 100) * 100;
          if (others.length > 0) {
            const totalPaid = per * others.length;
            player.money -= totalPaid;
            others.forEach((o) => (o.money += per));
            detail = `他の社長全員に${per.toLocaleString()}万円ずつおごった！（合計 -${totalPaid.toLocaleString()}万円）`;
          } else {
            const selfLoss = Math.round((1200 * inflMult) / 100) * 100;
            player.money -= selfLoss;
            detail = `1人で豪華ディナーを食べてしまった！ (-${selfLoss.toLocaleString()}万円)`;
          }
        } else if (act.type === 'sell_property') {
          const myProps = Object.values(this.ownedProperties).filter((o) => o.ownerId === player.id);
          if (myProps.length > 0) {
            const target = myProps[Math.floor(Math.random() * myProps.length)];
            const st = this.stationMap.get(target.stationId);
            const propDef = st?.properties?.find((p) => p.id === target.propertyId);
            const refund = Math.floor((propDef?.price ?? 1000) * 0.5);
            player.money += refund;
            delete this.ownedProperties[target.propertyId];
            detail = `${propDef?.name ?? '物件'}を半額(${refund.toLocaleString()}万円)で勝手に売却された！`;
          } else {
            player.money -= 1500;
            detail = `売る物件がなかったので現金1,500万円を奪われた！`;
          }
        } else if (act.type === 'downgrade_property') {
          const upgraded = Object.values(this.ownedProperties).filter(
            (o) => o.ownerId === player.id && o.level > 1
          );
          if (upgraded.length > 0) {
            const target = upgraded[Math.floor(Math.random() * upgraded.length)];
            target.level -= 1;
            const st = this.stationMap.get(target.stationId);
            const propDef = st?.properties?.find((p) => p.id === target.propertyId);
            detail = `${propDef?.name ?? '物件'}のレベルが Lv.${target.level} に下がってしまった！`;
          } else {
            player.money -= 1800;
            detail = `増資物件がなかったのでリフォーム費1,800万円を請求された！`;
          }
        } else if (act.type === 'discard_card') {
          if (player.cards.length > 0) {
            const idx = Math.floor(Math.random() * player.cards.length);
            const removedId = player.cards.splice(idx, 1)[0];
            player.cardCount = player.cards.length;
            const cName = this.cardMap.get(removedId)?.name ?? 'カード';
            detail = `「${cName}」を破り捨てられた！`;
          } else {
            player.money -= 1000;
            detail = `カードがなかったので1,000万円を奪われた！`;
          }
        } else if (act.type === 'give_card_rival') {
          const others = this.players.filter((p) => p.id !== player.id && p.cards.length < 8);
          if (player.cards.length > 0 && others.length > 0) {
            const idx = Math.floor(Math.random() * player.cards.length);
            const givenId = player.cards.splice(idx, 1)[0];
            player.cardCount = player.cards.length;
            const receiver = others[Math.floor(Math.random() * others.length)];
            receiver.cards.push(givenId);
            receiver.cardCount = receiver.cards.length;
            const cName = this.cardMap.get(givenId)?.name ?? 'カード';
            detail = `「${cName}」を勝手に ${receiver.name} へプレゼントしてしまった！`;
          } else {
            player.money -= 1200;
            detail = `渡せるカードがなかったので1,200万円を奪われた！`;
          }
        } else if (act.type === 'buy_random_card') {
          const cost = act.minAmount ?? 2000;
          player.money -= cost;
          if (player.cards.length < 8) {
            const randCard = this.cards[Math.floor(Math.random() * this.cards.length)];
            player.cards.push(randCard.id);
            player.cardCount = player.cards.length;
            detail = `${cost.toLocaleString()}万円で「${randCard.name}」を勝手に買ってきた！`;
          } else {
            detail = `${cost.toLocaleString()}万円を無駄遣いした！（手札満杯で受け取れず）`;
          }
        } else if (act.type === 'warp_away') {
          const farStations = this.stations.filter(
            (s) => s.type === 'property' && s.id !== player.stationId && s.id !== this.destinationStationId
          );
          const dest = farStations[Math.floor(Math.random() * farStations.length)];
          if (dest) {
            player.prevStationId = player.stationId;
            player.stationId = dest.id;
            detail = `${dest.name}駅へ勝手に飛ばされた！`;
            nuisanceWarpTo = dest;
          }
        } else if (act.type === 'nothing') {
          detail = act.description;
        }

        events.push({
          type: 'nuisance_action',
          playerId: player.id,
          payload: {
            blocked: false,
            title: act.title,
            description: detail,
            icon: this.eventsData.nuisanceCharacter.icon,
          },
        });
        if (nuisanceWarpTo) {
          events.push({
            type: 'warp_move',
            playerId: player.id,
            payload: { stationId: nuisanceWarpTo.id, stationName: nuisanceWarpTo.name },
          });
        }
      }
      }
    }

    // ご当地歴史ヒーロー発動チェック（本家準拠：1位独走を防ぐため14%に調整）
    if (!skipped && !player.hasNuisance && Math.random() < 0.14) {
      const heroEv = this.triggerHistoryHero(player);
      if (heroEv) events.push(heroEv);
    }

    // ランダム突発イベント（平時：お邪魔キャラ悪行が起きなかった場合に16%の確率で発動）
    if (!skipped && !player.hasNuisance && events.length === 0 && this.eventsData.randomEvents?.length && Math.random() < 0.16) {
      const ev = this.triggerRandomEvent(player);
      if (ev) events.push(ev);
    }

    // カスタムローカルルール評価（毎ターン終了 / 借金時）
    if (!skipped) {
      events.push(...this.evaluateLocalRules('every_turn_end', player));
      if (player.money < 0) {
        events.push(...this.evaluateLocalRules('on_debt', player));
      }
    }

    // デビル系カードの月次被害＆自然消滅チェック
    if (!skipped && player.cards.length > 0) {
      let devilLoss = 0;
      const devilNotes: string[] = [];
      const toRemove: number[] = [];
      player.cards.forEach((cid, idx) => {
        if (cid === 'little_devil') {
          devilLoss += 500;
          if (Math.random() < 0.25) toRemove.push(idx);
        } else if (cid === 'devil_card') {
          devilLoss += 1500;
          if (Math.random() < 0.22) toRemove.push(idx);
        } else if (cid === 'king_devil') {
          devilLoss += 4000;
          if (Math.random() < 0.18) toRemove.push(idx);
        } else if (cid === 'torikaeshi' && Math.random() < 0.2) {
          devilLoss += 5000;
          toRemove.push(idx);
        } else if (cid === 'time_bomb' && Math.random() < 0.2) {
          devilLoss += 6000;
          toRemove.push(idx);
        } else if (cid === 'oitekebori') {
          const nonDevilIdx = player.cards.findIndex(
            (x, i) => i !== idx && !toRemove.includes(i) && this.cardMap.get(x)?.category !== 'devil'
          );
          if (nonDevilIdx !== -1) {
            toRemove.push(nonDevilIdx);
            devilNotes.push(`おいてけ堀で「${this.cardMap.get(player.cards[nonDevilIdx])?.name ?? 'カード'}」を失った`);
          } else {
            devilLoss += 1000;
          }
          if (Math.random() < 0.25) toRemove.push(idx);
        } else if (cid === 'hitori_warai') {
          if (Math.random() < 0.35) {
            toRemove.push(idx);
            devilNotes.push('ひとり笑いカードが消滅した！');
          } else {
            player.skipNextTurn = true;
            devilNotes.push('ひとり笑いカードで次ターン1回休み…');
          }
        } else if (cid === 'ichi_derumade') {
          const roll = Math.floor(Math.random() * 6) + 1;
          if (roll === 1) {
            toRemove.push(idx);
            devilNotes.push('1が出るまでカード：出目1で解除！');
          } else {
            player.skipNextTurn = true;
            devilNotes.push(`1が出るまでカード：出目${roll}で次ターン休み…`);
          }
        } else if (cid === 'card_128') {
          if (Math.random() < 0.15) toRemove.push(idx);
        } else if (cid === 'card_999') {
          if (Math.random() < 0.08) toRemove.push(idx);
        }
      });
      const uniqueRemove = Array.from(new Set(toRemove)).sort((a, b) => b - a);
      for (const idx of uniqueRemove) {
        player.cards.splice(idx, 1);
      }
      player.cardCount = player.cards.length;
      if (devilLoss > 0 || devilNotes.length > 0) {
        if (devilLoss > 0) player.money -= devilLoss;
        const msgParts = [
          devilLoss > 0 ? `-${devilLoss.toLocaleString()}万円を失った` : '',
          ...devilNotes,
        ].filter(Boolean);
        events.push({
          type: 'random_event',
          playerId: player.id,
          payload: {
            title: '😈 デビル系カードの悪さ！',
            icon: '😈',
            description: `${player.name}：${msgParts.join(' / ')}`,
            isPositive: false,
          },
        });
      }
    }

    // 連帯保証人カード（パッシブ）：借金時に0円で踏みとどまり不足分を他社長へ押し付ける！
    if (!skipped && player.money < 0 && player.cards.includes('rentai_hoshonin')) {
      const rIdx = player.cards.indexOf('rentai_hoshonin');
      player.cards.splice(rIdx, 1);
      player.cardCount = player.cards.length;
      const deficit = Math.abs(player.money);
      player.money = 0;
      const others = this.players.filter((p) => p.id !== player.id);
      if (others.length > 0) {
        const per = Math.round(deficit / others.length / 100) * 100 || deficit;
        others.forEach((o) => {
          o.money -= per;
        });
        this.lastEventMessage = `📝 連帯保証人カード発動！${player.name}の借金${deficit.toLocaleString()}万円を他社長全員で肩代わり（1人-${per.toLocaleString()}万円）！`;
        events.push({
          type: 'random_event',
          playerId: player.id,
          payload: {
            title: '📝 連帯保証人カード発動！',
            icon: '📝',
            description: `${player.name}は0円で踏みとどまり、不足分 ${deficit.toLocaleString()}万円をライバル全員に肩代わりさせた！`,
            isPositive: true,
          },
        });
      }
    }

    // プレイヤーの状態タイマーを1ターン減少
    if ((player.zekkochoTurns ?? 0) > 0) player.zekkochoTurns = (player.zekkochoTurns ?? 1) - 1;
    if ((player.sealTurns ?? 0) > 0) player.sealTurns = (player.sealTurns ?? 1) - 1;
    if ((player.cowWalkTurns ?? 0) > 0) player.cowWalkTurns = (player.cowWalkTurns ?? 1) - 1;
    if ((player.heccharaTurns ?? 0) > 0) player.heccharaTurns = (player.heccharaTurns ?? 1) - 1;
    if ((player.russellTurns ?? 0) > 0) player.russellTurns = (player.russellTurns ?? 1) - 1;
    if ((player.yellowTurns ?? 0) > 0) player.yellowTurns = (player.yellowTurns ?? 1) - 1;
    if ((player.unchiPassTurns ?? 0) > 0) player.unchiPassTurns = (player.unchiPassTurns ?? 1) - 1;

    // 10億 / 100億 / 1000億 / 1兆突破一番乗りチェック
    this.recalculateRankingsAndDistances();
    for (const threshold of [100000, 1000000, 10000000, 100000000]) {
      if (!this.milestoneWinners[threshold] && player.totalAssets >= threshold) {
        this.milestoneWinners[threshold] = player.id;
        if (player.cards.length < 8) {
          player.cards.push('shinkansen_shuyu');
          player.cardCount = player.cards.length;
        }
        const label =
          threshold >= 100000000
            ? '1兆円'
            : `${(threshold / 10000).toLocaleString()}億円`;
        events.push({
          type: 'random_event',
          playerId: player.id,
          payload: {
            title: `🏆 総資産 ${label} 突破一番乗り！`,
            icon: '🏆',
            description: `${player.name}が一番乗りで総資産${label}を達成！記念に「新幹線周遊カード」を獲得！`,
            isPositive: true,
          },
        });
        break;
      }
    }

    // 借金を抱えていて売却できる物件（農林以外）がある場合は、自分で売る物件を選ぶフェーズへ
    if (!skipped && player.money < 0 && this.getSellableProperties(player.id).length > 0) {
      this.phase = 'debt_sell';
      this.debtSellContext = 'turn_end';
      this.recalculateRankingsAndDistances();
      this.lastEventMessage = `💸 ${player.name}は借金返済のため、売却する物件を選択してください！`;
      return events;
    }

    return [...events, ...this.advanceToNextTurn(player)];
  }

  private advanceToNextTurn(player: PlayerInternalState): GameEventSeqItem[] {
    const events: GameEventSeqItem[] = [];

    // 次のプレイヤーへ
    const prevMonth = this.currentMonth;
    this.currentTurnIndex += 1;
    if (this.currentTurnIndex >= this.players.length) {
      this.currentTurnIndex = 0;
      this.currentMonth += 1;
      if (this.currentMonth === 13) {
        this.currentMonth = 1;
      } else if (this.currentMonth === 4) {
        // 年度末決算（3月終了 → 4月へ）
        const settlementData = this.runYearEndSettlement();
        events.push({
          type: 'year_settlement',
          playerId: player.id,
          payload: settlementData,
        });

        if (this.currentYear >= this.config.totalYears) {
          this.status = 'finished';
          this.phase = 'finished';
          this.recalculateRankingsAndDistances();
          this.lastEventMessage = `🏆 ${this.config.totalYears}年間の戦いが終了しました！優勝は ${this.players.find((p) => p.rank === 1)?.name} です！`;
          events.push({
            type: 'game_finished',
            playerId: player.id,
            payload: {
              rankings: this.getPublicState().players,
              assetHistory: this.assetHistory,
              awards: this.computeSpecialAwards(),
            },
          });
          this.saveManager.saveAutosave(this.createSnapshot());
          return events;
        } else {
          this.currentYear += 1;
          // 新年度に景気変動抽選（好景気30% / 通常45% / 不景気25%）
          if (this.config.enableEconomyCycle !== false) {
            const er = Math.random();
            const nextEcon: EconomyPhase = er < 0.3 ? 'boom' : er < 0.75 ? 'normal' : 'recession';
            if (nextEcon !== this.economyPhase) {
              this.economyPhase = nextEcon;
              const econTitle =
                nextEcon === 'boom'
                  ? '📈 日本列島・好景気に突入！'
                  : nextEcon === 'recession'
                    ? '📉 日本列島・不景気に突入…'
                    : '📊 景気が通常へ戻りました';
              const econDesc =
                nextEcon === 'boom'
                  ? 'プラス駅1.5倍＆物件収益1.2倍のチャンス！'
                  : nextEcon === 'recession'
                    ? 'マイナス駅1.5倍＆物件収益0.8倍…慎重に進もう！'
                    : '経済は安定した通常状態へ戻りました。';
              this.lastEventMessage = econTitle;
              events.push({
                type: 'random_event',
                playerId: player.id,
                payload: {
                  title: econTitle,
                  icon: nextEcon === 'boom' ? '📈' : nextEcon === 'recession' ? '📉' : '📊',
                  description: econDesc,
                  isPositive: nextEcon !== 'recession',
                },
              });
            }
          }
        }
      }

      // 月替わり季節イベントの抽選（45%の確率で発生）
      const seasonalEv = this.triggerSeasonalEvent(this.currentMonth);
      if (seasonalEv) {
        events.push(seasonalEv);
      }

      // 月替わりカスタムローカルルール評価
      events.push(
        ...this.evaluateLocalRules('month_change', player, { month: this.currentMonth })
      );
    }

    this.turnCount += 1;
    this.remainingSteps = 0;
    this.visitedPathThisTurn = [];
    this.cardUsedThisTurn = false;
    this.recalculateRankingsAndDistances();

    // 次のプレイヤーが冬眠（1回休み）なら自動で1ターン飛ばす
    const nextPlayer = this.getCurrentPlayer();
    if (nextPlayer && nextPlayer.skipNextTurn && this.players.length > 1) {
      nextPlayer.skipNextTurn = false;
      this.lastEventMessage = `❄️ ${nextPlayer.name}は冬眠中のため1回休み！`;
      events.push({
        type: 'random_event',
        playerId: nextPlayer.id,
        payload: {
          title: '❄️ 冬眠中…',
          icon: '❄️',
          description: `${nextPlayer.name}は冬眠カードの効果で1回休み！`,
          isPositive: false,
        },
      });
      const skipEvents = this.finishTurn(nextPlayer, true);
      return [...events, ...skipEvents];
    }

    // 他社長の攻撃等で借金になっていた場合はターン開始前に売却選択フェーズへ（農林は保護）
    if (nextPlayer && nextPlayer.money < 0 && this.getSellableProperties(nextPlayer.id).length > 0) {
      this.phase = 'debt_sell';
      this.debtSellContext = 'turn_start';
    } else {
      this.phase = 'action_select';
      this.debtSellContext = 'turn_end';
    }

    // マップ上のうんち＆マイナス10倍駅のタイマーを減少
    for (const k of Object.keys(this.unchiStations)) {
      this.unchiStations[k] -= 1;
      if (this.unchiStations[k] <= 0) delete this.unchiStations[k];
    }
    for (const k of Object.keys(this.minus10Stations)) {
      this.minus10Stations[k] -= 1;
      if (this.minus10Stations[k] <= 0) delete this.minus10Stations[k];
    }

    // 次のプレイヤーの行動開始イベント（本家準拠ラバーバンディング：下位ほど絶好調に入りやすい / 持ち金2倍マンは超低確率＆上限あり）
    if (nextPlayer && this.phase === 'action_select') {
      const zekkoChance =
        nextPlayer.rank <= 1 ? 0.01 : nextPlayer.rank === 2 ? 0.03 : nextPlayer.rank === 3 ? 0.06 : 0.09;
      const isLast = this.players.length > 1 && nextPlayer.rank >= this.players.length;
      const doubleChance = isLast ? 0.006 : 0.003;
      if (this.currentYear >= 2 && (nextPlayer.zekkochoTurns ?? 0) === 0 && Math.random() < zekkoChance) {
        nextPlayer.zekkochoTurns = 5;
        events.push({
          type: 'random_event',
          playerId: nextPlayer.id,
          payload: {
            title: `⚡ ${nextPlayer.name}が絶好調に突入！！`,
            icon: '⚡',
            description: `サイコロ最低3個＆プラス駅3倍＆カード駅パワーアップの大チャンス！（5ターン）`,
            isPositive: true,
          },
        });
      } else if (nextPlayer.money > 0 && Math.random() < doubleChance) {
        const cap = Math.round((50000 * getYearInflationMult(this.currentYear)) / 100) * 100;
        const gain = Math.min(nextPlayer.money, cap);
        nextPlayer.money += gain;
        events.push({
          type: 'random_event',
          playerId: nextPlayer.id,
          payload: {
            title: '💰 持ち金2倍マン 登場！！',
            icon: '💰',
            description: `奇跡！${nextPlayer.name}の持ち金が +${gain.toLocaleString()}万円（計 ${nextPlayer.money.toLocaleString()}万円）になった！！`,
            isPositive: true,
          },
        });
      }
    }

    // ロールバック用スナップショット保存 & オートセーブ
    const snap = this.createSnapshot();
    this.previousTurnSnapshot = snap;
    this.saveManager.saveAutosave(snap);

    // ターン終了後の余韻＆暗転フェード → 次ターンアイキャッチを必ずキュー末尾に追加
    if (nextPlayer) {
      events.push({
        type: 'turn_fade',
        playerId: player.id,
        payload: {},
      });
      events.push({
        type: 'turn_start',
        playerId: nextPlayer.id,
        payload: {
          year: this.currentYear,
          month: this.currentMonth,
          playerName: nextPlayer.name,
          avatar: nextPlayer.avatar,
          color: nextPlayer.color,
          distanceToDest: nextPlayer.distanceToDest,
          isNewMonth: this.currentMonth !== prevMonth,
        },
      });
    }

    return events;
  }

  private isStationMonopolizedBy(stationId: string, playerId: string): boolean {
    const st = this.stationMap.get(stationId);
    if (!st || !st.properties || st.properties.length === 0) return false;
    return st.properties.every((p) => this.ownedProperties[p.id]?.ownerId === playerId);
  }

  private triggerHistoryHero(player: PlayerInternalState): GameEventSeqItem | null {
    const myHeroes = this.stations.filter(
      (s) => s.hero && this.isStationMonopolizedBy(s.id, player.id)
    );
    if (myHeroes.length === 0) return null;
    const st = myHeroes[Math.floor(Math.random() * myHeroes.length)];
    const hero = st.hero!;

    let desc = '';
    const heroMult = getYearInflationMult(this.currentYear);
    if (hero.effectType === 'cash_gift') {
      const bonus = Math.round((3000 * heroMult) / 100) * 100;
      player.money += bonus;
      desc = `${st.name}の偉人「${hero.name}」が軍資金 +${bonus.toLocaleString()}万円を授けてくれた！`;
    } else if (hero.effectType === 'steal_money_all') {
      const others = this.players.filter((p) => p.id !== player.id);
      if (others.length === 0) return null;
      const per = Math.round((1000 * heroMult) / 100) * 100;
      let total = 0;
      others.forEach((o) => {
        o.money -= per;
        total += per;
      });
      player.money += total;
      desc = `${st.name}の偉人「${hero.name}」がライバル全員から${per.toLocaleString()}万円ずつ（計+${total.toLocaleString()}万円）徴収してくれた！`;
    } else if (hero.effectType === 'give_express') {
      if (player.cards.length >= 8) return null;
      const pool = this.cards.filter((c) => c.category === 'dice');
      const card = pool[Math.floor(Math.random() * pool.length)];
      if (!card) return null;
      player.cards.push(card.id);
      player.cardCount = player.cards.length;
      desc = `${st.name}の偉人「${hero.name}」が「${card.name}」を授けてくれた！`;
    } else if (hero.effectType === 'shield_gift') {
      if (player.cards.length >= 8) return null;
      player.cards.push('shield');
      player.cardCount = player.cards.length;
      const shieldName = this.cardMap.get('shield')?.name ?? 'パトカード';
      desc = `${st.name}の偉人「${hero.name}」が「${shieldName}」を授けてくれた！`;
    } else if (hero.effectType === 'move_closer') {
      const distMap = this.pathfinder.getAllDistancesFrom(this.destinationStationId);
      const near = this.stations.filter((s) => {
        const d = distMap.get(s.id) ?? 999;
        return d >= 2 && d <= 5 && s.id !== player.stationId;
      });
      if (near.length === 0) return null;
      const dest = near[Math.floor(Math.random() * near.length)];
      player.prevStationId = player.stationId;
      player.stationId = dest.id;
      desc = `${st.name}の偉人「${hero.name}」が海援隊の船で目的地近くの「${dest.name}」へ運んでくれた！`;
    }

    this.lastEventMessage = `${hero.icon} 歴史ヒーロー「${hero.name}」発動！ ${desc}`;
    return {
      type: 'random_event',
      playerId: player.id,
      payload: {
        title: `${hero.icon} 歴史ヒーロー「${hero.name}」参上！`,
        icon: hero.icon,
        description: desc,
        isPositive: true,
      },
    };
  }

  private runYearEndSettlement(): Record<string, unknown> {
    const incomes: Record<string, number> = {};
    const propAssets: Record<string, number> = {};
    this.players.forEach((p) => {
      incomes[p.id] = 0;
      propAssets[p.id] = 0;
    });

    const econMult =
      this.economyPhase === 'boom' ? 1.2 : this.economyPhase === 'recession' ? 0.8 : 1.0;

    for (const owned of Object.values(this.ownedProperties)) {
      const station = this.stationMap.get(owned.stationId);
      const prop = station?.properties?.find((p) => p.id === owned.propertyId);
      if (!prop) continue;
      let income = 0;
      if (owned.curseRate !== undefined) {
        // 割合ケチケチの呪い中：マイナス収益！
        income = Math.round(prop.price * owned.level * owned.curseRate);
        owned.curseRemainingSettlements = (owned.curseRemainingSettlements ?? 1) - 1;
        if (owned.curseRemainingSettlements <= 0) {
          delete owned.curseRate;
          delete owned.curseRemainingSettlements;
        }
      } else {
        const isMono = this.isStationMonopolizedBy(owned.stationId, owned.ownerId);
        income = Math.round(calcAnnualIncome(prop.price, prop.rate, owned.level, isMono) * econMult);
      }
      incomes[owned.ownerId] = (incomes[owned.ownerId] ?? 0) + income;
      propAssets[owned.ownerId] =
        (propAssets[owned.ownerId] ?? 0) + investedValue(prop.price, owned.level);
    }

    for (const p of this.players) {
      p.money += incomes[p.id] ?? 0;
    }

    this.recalculateRankingsAndDistances();

    // 年度末の総資産履歴を記録
    const yearAssets: Record<string, number> = {};
    for (const p of this.players) {
      yearAssets[p.id] = p.totalAssets;
    }
    this.assetHistory.push({ year: this.currentYear, assets: yearAssets });

    const summary = [...this.players]
      .sort((a, b) => a.rank - b.rank)
      .map((p) => ({
        playerId: p.id,
        name: p.name,
        avatar: p.avatar,
        color: p.color,
        rank: p.rank,
        income: incomes[p.id] ?? 0,
        moneyAfter: p.money,
        propertyAssets: propAssets[p.id] ?? 0,
        totalAssets: p.totalAssets,
      }));

    this.lastEventMessage = `📊 ${this.currentYear}年目 年度末決算！全物件の収益が振り込まれました！`;

    return {
      year: this.currentYear,
      summary,
      assetHistory: this.assetHistory,
    };
  }

  public forceSkipTurn(): { ok: boolean; events: GameEventSeqItem[] } {
    if (this.status !== 'playing') return { ok: false, events: [] };
    const player = this.getCurrentPlayer();
    if (!player) return { ok: false, events: [] };
    this.lastEventMessage = `⏭️ 管理者操作により ${player.name} のターンをスキップしました。`;
    const events = this.finishTurn(player);
    return { ok: true, events };
  }

  public rollbackTurn(): boolean {
    if (!this.previousTurnSnapshot) return false;
    this.loadFromSnapshot(this.previousTurnSnapshot);
    this.lastEventMessage = '⏪ 管理者操作により直前の状態へロールバックしました。';
    return true;
  }

  public toggleCpuOverride(playerId: string): boolean {
    const player = this.players.find((p) => p.id === playerId);
    if (!player || player.isCpu) return false;
    player.isMasterOverrideCpu = !player.isMasterOverrideCpu;
    return true;
  }

  public getUndoStationId(): string | null {
    if (this.visitedPathThisTurn.length >= 2) {
      const currentId = this.visitedPathThisTurn[this.visitedPathThisTurn.length - 1];
      const currentSt = this.stationMap.get(currentId);
      // 行き止まり駅（物理的に隣接1駅のみ、またはうんち封鎖で進行可能駅が1駅のみ）では折り返し前進（歩数消費）とし、無限ループを防ぐ
      if (currentSt && currentSt.neighbors.length <= 1) {
        return null;
      }
      const curPlayer = this.getCurrentPlayer();
      if (curPlayer && curPlayer.stationId === currentId) {
        const available = this.getAvailableNextStations(curPlayer);
        if (available.length <= 1) {
          return null;
        }
      }
      return this.visitedPathThisTurn[this.visitedPathThisTurn.length - 2];
    }
    return null;
  }

  public getAvailableNextStations(player: PlayerInternalState): string[] {
    const station = this.stationMap.get(player.stationId);
    if (!station) return [];
    // うんちが落ちているマスは「うんち突入カード」発動中以外は通行不可（全方向塞がれた場合のみ例外）
    if ((player.unchiPassTurns ?? 0) > 0) return [...station.neighbors];
    const open = station.neighbors.filter((nbId) => !(this.unchiStations[nbId] > 0));
    return open.length > 0 ? open : [...station.neighbors];
  }

  public getRecommendedNextStations(player: PlayerInternalState): string[] {
    const available = this.getAvailableNextStations(player);
    if (available.length === 0) return [];
    const undoId = this.getUndoStationId();
    const candidates = available.filter((n) => n !== undoId);
    const list = candidates.length > 0 ? candidates : available;
    const blocked =
      (player.unchiPassTurns ?? 0) > 0
        ? undefined
        : new Set(Object.keys(this.unchiStations).filter((id) => this.unchiStations[id] > 0));
    let distMap = this.pathfinder.getAllDistancesFrom(this.destinationStationId, blocked);
    if (blocked && blocked.size > 0 && list.every((id) => !distMap.has(id))) {
      distMap = this.pathfinder.getAllDistancesFrom(this.destinationStationId);
    }

    let minDist = Infinity;
    for (const id of list) {
      const d = distMap.get(id) ?? 999;
      if (d < minDist) minDist = d;
    }
    return list.filter((id) => (distMap.get(id) ?? 999) === minDist);
  }

  /**
   * 現在の残り歩数でぴったり到達可能な駅ID一覧を返す（マップハイライト用）
   */
  public getReachableStations(player: PlayerInternalState): string[] {
    const steps = this.remainingSteps;
    if (this.phase !== 'moving' || steps <= 0) return [];
    const maxSteps = Math.min(steps, 36);
    const ignoreUnchi = (player.unchiPassTurns ?? 0) > 0;
    const initialPrev = this.getUndoStationId();
    const mustBeExact = this.config.exactDestination !== false;

    const results = new Set<string>();
    const memo = new Set<string>();

    const dfs = (curId: string, prevId: string | null, rem: number) => {
      if (rem === 0) {
        results.add(curId);
        return;
      }
      const key = `${curId}|${prevId ?? ''}|${rem}`;
      if (memo.has(key)) return;
      memo.add(key);

      const st = this.stationMap.get(curId);
      if (!st || st.neighbors.length === 0) return;

      let open = ignoreUnchi
        ? st.neighbors
        : st.neighbors.filter((nb) => !(this.unchiStations[nb] > 0));
      if (open.length === 0) open = st.neighbors;

      // 直前の駅へ戻るのを避ける（行き止まり・実質1本道なら折り返し許可）
      const forward = prevId && open.length > 1 ? open.filter((nb) => nb !== prevId) : open;
      const nextList = forward.length > 0 ? forward : open;

      for (const nextId of nextList) {
        if (!mustBeExact && nextId === this.destinationStationId) {
          results.add(nextId);
          continue;
        }
        dfs(nextId, curId, rem - 1);
      }
    };

    dfs(player.stationId, initialPrev, maxSteps);
    return Array.from(results);
  }

  private ensurePlayerStats(playerId: string) {
    if (!this.playerStats[playerId]) {
      this.playerStats[playerId] = {
        destReached: 0,
        bombyTurns: 0,
        duelWins: 0,
        duelLosses: 0,
        maxDebt: 0,
        monopolies: 0,
      };
    }
    return this.playerStats[playerId];
  }

  private computeSpecialAwards(): {
    title: string;
    icon: string;
    playerName: string;
    playerColor: string;
    detail: string;
  }[] {
    if (this.players.length === 0) return [];
    const awards: {
      title: string;
      icon: string;
      playerName: string;
      playerColor: string;
      detail: string;
    }[] = [];

    const byDest = [...this.players].sort(
      (a, b) => (this.playerStats[b.id]?.destReached ?? 0) - (this.playerStats[a.id]?.destReached ?? 0)
    );
    if ((this.playerStats[byDest[0].id]?.destReached ?? 0) > 0) {
      awards.push({
        title: '目的地最多到着賞',
        icon: '🚩',
        playerName: byDest[0].name,
        playerColor: byDest[0].color,
        detail: `${this.playerStats[byDest[0].id].destReached}回ゴール！`,
      });
    }

    const propCountMap = new Map<string, number>();
    for (const o of Object.values(this.ownedProperties)) {
      propCountMap.set(o.ownerId, (propCountMap.get(o.ownerId) ?? 0) + 1);
    }
    const byProp = [...this.players].sort(
      (a, b) => (propCountMap.get(b.id) ?? 0) - (propCountMap.get(a.id) ?? 0)
    );
    if ((propCountMap.get(byProp[0].id) ?? 0) > 0) {
      awards.push({
        title: '物件王',
        icon: '🏢',
        playerName: byProp[0].name,
        playerColor: byProp[0].color,
        detail: `所有物件 ${propCountMap.get(byProp[0].id)}件！`,
      });
    }

    const byBomby = [...this.players].sort(
      (a, b) => (this.playerStats[b.id]?.bombyTurns ?? 0) - (this.playerStats[a.id]?.bombyTurns ?? 0)
    );
    if ((this.playerStats[byBomby[0].id]?.bombyTurns ?? 0) > 0) {
      awards.push({
        title: '貧乏神に愛された賞',
        icon: '👹',
        playerName: byBomby[0].name,
        playerColor: byBomby[0].color,
        detail: `${this.playerStats[byBomby[0].id].bombyTurns}ターン憑依`,
      });
    }

    const byDuel = [...this.players].sort(
      (a, b) => (this.playerStats[b.id]?.duelWins ?? 0) - (this.playerStats[a.id]?.duelWins ?? 0)
    );
    if ((this.playerStats[byDuel[0].id]?.duelWins ?? 0) > 0) {
      awards.push({
        title: 'チンチロ勝負師賞',
        icon: '⚔️',
        playerName: byDuel[0].name,
        playerColor: byDuel[0].color,
        detail: `決闘 ${this.playerStats[byDuel[0].id].duelWins}勝！`,
      });
    }

    const byDebt = [...this.players].sort(
      (a, b) => (this.playerStats[b.id]?.maxDebt ?? 0) - (this.playerStats[a.id]?.maxDebt ?? 0)
    );
    if ((this.playerStats[byDebt[0].id]?.maxDebt ?? 0) > 0) {
      awards.push({
        title: '不屈の借金王',
        icon: '💸',
        playerName: byDebt[0].name,
        playerColor: byDebt[0].color,
        detail: `最大借金 ${this.playerStats[byDebt[0].id].maxDebt.toLocaleString()}万円`,
      });
    }

    return awards;
  }

  // --- 管理者用「神の手」操作 ---
  public adminAdjustMoney(playerId: string, delta: number): boolean {
    const p = this.players.find((x) => x.id === playerId);
    if (!p) return false;
    p.money += delta;
    this.recalculateRankingsAndDistances();
    this.lastEventMessage = `👑 管理者操作: ${p.name} の資金を ${delta >= 0 ? '+' : ''}${delta.toLocaleString()}万円 調整しました。`;
    return true;
  }

  public adminGiveCard(playerId: string, cardId: string): boolean {
    const p = this.players.find((x) => x.id === playerId);
    const card = this.cardMap.get(cardId);
    if (!p || !card || p.cards.length >= 8) return false;
    p.cards.push(card.id);
    p.cardCount = p.cards.length;
    this.lastEventMessage = `👑 管理者操作: ${p.name} へ「${card.name}」を支給しました。`;
    return true;
  }

  public adminGiveCardAll(cardId: string): number {
    const card = this.cardMap.get(cardId);
    if (!card) return 0;
    let count = 0;
    for (const p of this.players) {
      if (p.cards.length < 8) {
        p.cards.push(card.id);
        p.cardCount = p.cards.length;
        count++;
      }
    }
    if (count > 0) {
      this.lastEventMessage = `👑 管理者操作: 全社長（${count}名）へ「${card.name}」を支給しました！`;
    }
    return count;
  }

  public adminRemoveCard(playerId: string, cardIndex: number): boolean {
    const p = this.players.find((x) => x.id === playerId);
    if (!p || cardIndex < 0 || cardIndex >= p.cards.length) return false;
    const removedId = p.cards.splice(cardIndex, 1)[0];
    p.cardCount = p.cards.length;
    const cName = this.cardMap.get(removedId)?.name ?? removedId;
    this.lastEventMessage = `👑 管理者操作: ${p.name} の「${cName}」を没収しました。`;
    return true;
  }

  public adminWarpPlayer(playerId: string, stationId: string): GameEventSeqItem[] {
    const p = this.players.find((x) => x.id === playerId);
    const st = this.stationMap.get(stationId);
    if (!p || !st) return [];
    p.prevStationId = p.stationId;
    p.stationId = st.id;
    // 手番中の社長を強制ワープした場合、移動履歴（↩戻る先）と待機中の鉢合わせ決闘をリセットして経路不整合を防ぐ
    const cur = this.getCurrentPlayer();
    if (cur && cur.id === p.id) {
      this.visitedPathThisTurn = [st.id];
      this.pendingSameStationDuelIds = [];
    }
    this.recalculateRankingsAndDistances();
    this.lastEventMessage = `👑 管理者操作: ${p.name} を「${st.name}」へ強制移動しました！`;
    return [
      {
        type: 'warp_move',
        playerId: p.id,
        payload: { stationId: st.id, stationName: st.name },
      },
    ];
  }

  public adminChangeDestination(stationId?: string): void {
    const prevDest = this.destinationStationId;
    if (stationId && this.stationMap.has(stationId)) {
      this.destinationStationId = stationId;
    } else {
      this.destinationStationId = this.pickRandomDestination(this.destinationStationId);
    }
    this.currentDestOriginDistance =
      this.pathfinder.getShortestDistance(prevDest, this.destinationStationId) || 20;
    this.recalculateRankingsAndDistances();
    this.lastEventMessage = `👑 管理者操作: 目的地を「${this.getStationName(this.destinationStationId)}」へ変更しました！`;
  }

  public adminBroadcastMessage(
    title: string,
    message: string,
    targetPlayerId?: string
  ): GameEventSeqItem[] {
    const cleanTitle = title.trim() || '運営からのお知らせ';
    const cleanMsg = message.trim();
    if (!cleanMsg) return [];
    const target = targetPlayerId ? this.players.find((p) => p.id === targetPlayerId) : null;
    const prefix = target ? `【${target.name}宛て】` : '【全員へ】';
    this.lastEventMessage = `📢 ${cleanTitle} ${prefix}${cleanMsg}`;
    return [
      {
        type: 'admin_message',
        playerId: target?.id ?? '',
        payload: {
          title: cleanTitle,
          message: cleanMsg,
          targetName: target?.name ?? null,
        },
      },
    ];
  }

  public getAdminPlayersCards(): Record<string, string[]> {
    const map: Record<string, string[]> = {};
    for (const p of this.players) {
      map[p.id] = [...p.cards];
    }
    return map;
  }

  public adminSetNuisance(playerId: string | null): void {
    this.players.forEach((p) => (p.hasNuisance = false));
    if (playerId) {
      const target = this.players.find((p) => p.id === playerId);
      if (target) {
        target.hasNuisance = true;
        this.nuisanceTargetPlayerId = target.id;
        this.lastEventMessage = `👑 管理者操作: ケチケチ大王を ${target.name} へ移動しました。`;
        return;
      }
    }
    this.nuisanceTargetPlayerId = null;
    this.nuisanceForm = 'normal';
    this.lastEventMessage = `👑 管理者操作: ケチケチ大王を解除しました。`;
  }

  public adminSetNuisanceForm(form: NuisanceForm): void {
    this.nuisanceForm = form;
    this.bakuretsuSteps = 0;
    const labels: Record<NuisanceForm, string> = {
      normal: '👹 貧乏神（通常）',
      mini: '👶 ミニボンビー',
      pokon: '💥 ポコン',
      king: '🔥 キングボンビー',
      destroy: '🚜 デストロイ号',
      rate_curse: '📉 パーセントボンビー（割合）',
      bakuretsu: '💣 バクレツボンビー',
      devil: '😈 デビルボンビー',
      minus10: '⚡ マイナ～～スボンビー',
      happy: '😇 ハッピー大王',
    };
    this.lastEventMessage = `👑 管理者操作: ボンビーの形態を「${labels[form]}」へ変更しました！`;
  }

  public adminSetEconomyPhase(phase: EconomyPhase): void {
    this.economyPhase = phase;
    const labels: Record<EconomyPhase, string> = {
      boom: '📈 好景気',
      normal: '📊 通常',
      recession: '📉 不景気',
    };
    this.lastEventMessage = `👑 管理者操作: 景気を「${labels[phase]}」へ変更しました！`;
  }

  public adminUpdateRules(partial: Partial<GameConfig>): void {
    if (partial.exactDestination !== undefined) this.config.exactDestination = Boolean(partial.exactDestination);
    if (partial.enableRateCurse !== undefined) this.config.enableRateCurse = Boolean(partial.enableRateCurse);
    if (partial.enableEconomyCycle !== undefined) this.config.enableEconomyCycle = Boolean(partial.enableEconomyCycle);
    if (partial.enablePickpocket !== undefined) this.config.enablePickpocket = Boolean(partial.enablePickpocket);
    this.lastEventMessage = `👑 管理者操作: ゲームルール設定を更新しました。`;
  }

  public adminUpdateStation(stationId: string, type: StationType, name?: string): boolean {
    const st = this.stationMap.get(stationId);
    if (!st) return false;
    const ov: StationOverride = {
      stationId,
      type,
      name: name?.trim() || undefined,
    };
    this.stationOverrides[stationId] = ov;
    this.applyStationOverrideToDef(st, ov);
    this.saveManager.saveStationOverrides(this.stationOverrides);
    this.lastEventMessage = `🗺️ 管理者操作: マス「${st.name}」を ${type} に変更しました！`;
    return true;
  }

  public adminResetStations(): void {
    this.stationOverrides = {};
    this.saveManager.saveStationOverrides({});
    this.stations = JSON.parse(JSON.stringify(this.baseStations));
    this.stationMap = new Map(this.stations.map((s) => [s.id, s]));
    this.pathfinder = new Pathfinder(this.stations);
    this.lastEventMessage = `🗺️ 管理者操作: 全マスの設定を初期状態へ戻しました。`;
  }

  // --- カスタムローカルルール管理＆評価 ---
  public addLocalRule(rule: Omit<LocalRuleDef, 'id'>): LocalRuleDef {
    const newRule: LocalRuleDef = {
      ...rule,
      id: `lr_${uuidv4().slice(0, 8)}`,
    };
    this.localRules.push(newRule);
    this.saveManager.saveLocalRules(this.localRules);
    this.lastEventMessage = `⚖️ ローカルルール「${newRule.name}」を追加しました！`;
    return newRule;
  }

  public toggleLocalRule(ruleId: string): boolean {
    const r = this.localRules.find((x) => x.id === ruleId);
    if (!r) return false;
    r.enabled = !r.enabled;
    this.saveManager.saveLocalRules(this.localRules);
    return true;
  }

  public deleteLocalRule(ruleId: string): boolean {
    const idx = this.localRules.findIndex((x) => x.id === ruleId);
    if (idx === -1) return false;
    this.localRules.splice(idx, 1);
    this.saveManager.saveLocalRules(this.localRules);
    return true;
  }

  private evaluateLocalRules(
    trigger: LocalRuleTrigger,
    actor: PlayerInternalState,
    ctx?: { rolls?: number[]; total?: number; month?: number; stationId?: string; stationType?: string }
  ): GameEventSeqItem[] {
    const results: GameEventSeqItem[] = [];
    for (const rule of this.localRules) {
      if (!rule.enabled || rule.trigger !== trigger) continue;

      // 条件チェック
      if (trigger === 'month_change' && rule.triggerValue && rule.triggerValue > 0) {
        if (ctx?.month !== rule.triggerValue) continue;
      }
      if (trigger === 'on_dice_roll' && rule.triggerValue !== undefined) {
        const rolls = ctx?.rolls ?? [];
        const total = ctx?.total ?? 0;
        if (rule.triggerValue === 0) {
          // 0 = ゾロ目（サイコロ2個以上で全て同じ目）
          if (rolls.length < 2 || !rolls.every((v) => v === rolls[0])) continue;
        } else if (rule.triggerValue > 0) {
          if (total !== rule.triggerValue && !rolls.includes(rule.triggerValue)) continue;
        }
      }
      if (trigger === 'on_specific_station') {
        if (!rule.targetStationId || ctx?.stationId !== rule.targetStationId) continue;
      }
      if (trigger === 'on_station_type') {
        if (!rule.targetStationType || ctx?.stationType !== rule.targetStationType) continue;
      }

      // 確率チェック
      const prob = Math.max(1, Math.min(100, rule.probability ?? 100));
      if (Math.random() * 100 >= prob) continue;

      // 対象プレイヤー決定
      let targets: PlayerInternalState[] = [];
      if (rule.target === 'actor') {
        targets = [actor];
      } else if (rule.target === 'all') {
        targets = [...this.players];
      } else if (rule.target === 'top') {
        const top = [...this.players].sort((a, b) => a.rank - b.rank)[0];
        if (top) targets = [top];
      } else if (rule.target === 'last') {
        const last = [...this.players].sort((a, b) => b.rank - a.rank)[0];
        if (last) targets = [last];
      }

      if (targets.length === 0) continue;

      let isPositive = true;
      for (const t of targets) {
        if (rule.effect === 'cash_delta') {
          const amt = Number(rule.effectAmount) || 0;
          t.money += amt;
          if (amt < 0) isPositive = false;
        } else if (rule.effect === 'give_card') {
          if (t.cards.length < 8) {
            const card =
              (rule.effectCardId ? this.cardMap.get(rule.effectCardId) : null) ??
              this.cards[Math.floor(Math.random() * this.cards.length)];
            if (card) {
              t.cards.push(card.id);
              t.cardCount = t.cards.length;
            }
          }
        } else if (rule.effect === 'discard_card') {
          isPositive = false;
          if (t.cards.length > 0) {
            t.cards.splice(Math.floor(Math.random() * t.cards.length), 1);
            t.cardCount = t.cards.length;
          }
        } else if (rule.effect === 'warp_random') {
          const cands = this.stations.filter(
            (s) => s.type === 'property' && s.id !== t.stationId && s.id !== this.destinationStationId
          );
          const dest = cands[Math.floor(Math.random() * cands.length)];
          if (dest) {
            t.prevStationId = t.stationId;
            t.stationId = dest.id;
            const cur = this.getCurrentPlayer();
            if (cur && cur.id === t.id && this.phase === 'moving') {
              this.visitedPathThisTurn = [dest.id];
            }
            results.push({
              type: 'warp_move',
              playerId: t.id,
              payload: { stationId: dest.id, stationName: dest.name },
            });
          }
        } else if (rule.effect === 'attach_nuisance') {
          isPositive = false;
          this.players.forEach((p) => (p.hasNuisance = false));
          t.hasNuisance = true;
          this.nuisanceTargetPlayerId = t.id;
        } else if (rule.effect === 'clear_nuisance') {
          t.hasNuisance = false;
          if (this.nuisanceTargetPlayerId === t.id) {
            this.nuisanceTargetPlayerId = null;
          }
        }
      }

      const targetNames =
        rule.target === 'all' ? '全社長' : targets.map((t) => t.name).join('・');
      const formattedMsg = (rule.message || `ローカルルール「${rule.name}」が発動！`).replace(
        /\{player\}/g,
        targetNames
      );

      this.recalculateRankingsAndDistances();
      this.lastEventMessage = `⚖️ ${rule.name}: ${formattedMsg}`;
      results.push({
        type: 'random_event',
        playerId: targets[0].id,
        payload: {
          title: `⚖️ ${rule.name}`,
          icon: '⚖️',
          description: formattedMsg,
          isPositive,
        },
      });
    }
    return results;
  }

  private pickWeighted<T extends { weight?: number }>(list: T[]): T {
    const total = list.reduce((sum, item) => sum + (item.weight ?? 10), 0);
    let r = Math.random() * total;
    for (const item of list) {
      r -= item.weight ?? 10;
      if (r <= 0) return item;
    }
    return list[list.length - 1];
  }

  private triggerRandomEvent(player: PlayerInternalState): GameEventSeqItem | null {
    const list = this.eventsData.randomEvents;
    if (!list || list.length === 0) return null;
    const ev = this.pickWeighted(list);

    if (ev.effectType === 'property_hit') {
      const myOwned = Object.values(this.ownedProperties).filter((o) => o.ownerId === player.id);
      if (myOwned.length === 0) return null;
      const pick = myOwned[Math.floor(Math.random() * myOwned.length)];
      const st = this.stationMap.get(pick.stationId);
      const prop = st?.properties?.find((p) => p.id === pick.propertyId);
      if (!prop) return null;
      const bonus = Math.round(prop.price * 0.6);
      player.money += bonus;
      this.lastEventMessage = `✨ ${player.name}の「${prop.name}」がSNSで大バズり！ +${bonus.toLocaleString()}万円！`;
      return {
        type: 'random_event',
        playerId: player.id,
        payload: {
          title: ev.title,
          icon: ev.icon,
          description: `${player.name}が所有する「${prop.name}」が大ヒット！臨時収益 +${bonus.toLocaleString()}万円！`,
          isPositive: true,
        },
      };
    }

    if (ev.effectType === 'category_hit' && ev.categories) {
      const matching = Object.values(this.ownedProperties).filter((o) => {
        if (o.ownerId !== player.id) return false;
        const st = this.stationMap.get(o.stationId);
        const prop = st?.properties?.find((p) => p.id === o.propertyId);
        return prop && ev.categories!.includes(prop.category);
      });
      if (matching.length === 0) return null;
      const pick = matching[Math.floor(Math.random() * matching.length)];
      const st = this.stationMap.get(pick.stationId);
      const prop = st?.properties?.find((p) => p.id === pick.propertyId);
      if (!prop) return null;
      const bonus = Math.round(prop.price * 0.5 * pick.level);
      player.money += bonus;
      this.lastEventMessage = `${ev.icon} ${player.name}の「${prop.name}」に臨時収入 +${bonus.toLocaleString()}万円！`;
      return {
        type: 'random_event',
        playerId: player.id,
        payload: {
          title: ev.title,
          icon: ev.icon,
          description: `${player.name}の「${prop.name}」が注目され、臨時収益 +${bonus.toLocaleString()}万円！`,
          isPositive: true,
        },
      };
    }

    if (ev.effectType === 'free_upgrade') {
      const upgradable = Object.values(this.ownedProperties).filter(
        (o) => o.ownerId === player.id && o.level < 3
      );
      if (upgradable.length === 0) return null;
      const pick = upgradable[Math.floor(Math.random() * upgradable.length)];
      pick.level += 1;
      const st = this.stationMap.get(pick.stationId);
      const prop = st?.properties?.find((p) => p.id === pick.propertyId);
      this.lastEventMessage = `🏗️ ${player.name}の「${prop?.name}」が無料で Lv.${pick.level} に増資！`;
      return {
        type: 'random_event',
        playerId: player.id,
        payload: {
          title: ev.title,
          icon: ev.icon,
          description: `${player.name}が所有する「${prop?.name}」が無料で Lv.${pick.level} にランクアップ！`,
          isPositive: true,
        },
      };
    }

    if (ev.effectType === 'lottery' || ev.effectType === 'cash_bonus') {
      const amt = ev.amount ?? 2500;
      player.money += amt;
      this.lastEventMessage = `${ev.icon} ${player.name}に臨時収入 +${amt.toLocaleString()}万円！`;
      return {
        type: 'random_event',
        playerId: player.id,
        payload: {
          title: ev.title,
          icon: ev.icon,
          description: `${player.name}は臨時収入 +${amt.toLocaleString()}万円を獲得！`,
          isPositive: true,
        },
      };
    }

    if (ev.effectType === 'cash_loss') {
      const amt = ev.amount ?? 1000;
      player.money -= amt;
      this.lastEventMessage = `${ev.icon} ${player.name}に臨時出費 -${amt.toLocaleString()}万円`;
      return {
        type: 'random_event',
        playerId: player.id,
        payload: {
          title: ev.title,
          icon: ev.icon,
          description: `${player.name}は臨時出費として -${amt.toLocaleString()}万円を支払った…`,
          isPositive: false,
        },
      };
    }

    if (ev.effectType === 'pickpocket') {
      if (player.money <= 1000) return null;
      const defense = this.consumeDefenseCard(player);
      if (defense) {
        return {
          type: 'random_event',
          playerId: player.id,
          payload: {
            title: `${defense.icon} ${defense.name}発動！`,
            icon: defense.icon,
            description: `スリの銀次が現れたが、${player.name}は${defense.name}で撃退した！`,
            isPositive: true,
          },
        };
      }
      const stolen = Math.min(8000, Math.round((player.money * 0.25) / 100) * 100);
      player.money -= stolen;
      this.lastEventMessage = `🕵️ スリの銀次出現！${player.name}は ${stolen.toLocaleString()}万円をスられた！`;
      return {
        type: 'random_event',
        playerId: player.id,
        payload: {
          title: ev.title,
          icon: ev.icon,
          description: `${player.name}は所持金の25%（-${stolen.toLocaleString()}万円）をスられてしまった！`,
          isPositive: false,
        },
      };
    }

    if (ev.effectType === 'free_card' || ev.effectType === 'express_card') {
      if (player.cards.length >= 8) return null;
      const pool =
        ev.effectType === 'express_card'
          ? this.cards.filter((c) => c.category === 'dice')
          : this.cards;
      const c = pool[Math.floor(Math.random() * pool.length)] ?? this.cards[0];
      player.cards.push(c.id);
      player.cardCount = player.cards.length;
      this.lastEventMessage = `${ev.icon} ${player.name}は「${c.name}」をもらった！`;
      return {
        type: 'random_event',
        playerId: player.id,
        payload: {
          title: ev.title,
          icon: ev.icon,
          description: `${player.name}は「${c.name}」を手に入れた！`,
          isPositive: true,
        },
      };
    }

    return null;
  }

  private triggerSeasonalEvent(month: number): GameEventSeqItem | null {
    const list = this.eventsData.seasonalEvents;
    if (!list || Math.random() > 0.45) return null;
    const matched = list.filter((e) => e.months.includes(month));
    if (matched.length === 0) return null;
    const ev = matched[Math.floor(Math.random() * matched.length)];

    let detail = ev.description;
    let isPositive = true;

    if (ev.effectType === 'all_cash_bonus') {
      const amt = ev.amount ?? 1500;
      this.players.forEach((p) => (p.money += amt));
      detail = `${ev.description}（全員 +${amt.toLocaleString()}万円）`;
    } else if (ev.effectType === 'all_cash_loss') {
      const amt = ev.amount ?? 1000;
      this.players.forEach((p) => (p.money -= amt));
      detail = `${ev.description}（全員 -${amt.toLocaleString()}万円）`;
      isPositive = false;
    } else if (ev.effectType === 'category_bonus' && ev.categories) {
      const rate = ev.bonusRate ?? 0.25;
      let totalPaid = 0;
      for (const owned of Object.values(this.ownedProperties)) {
        const st = this.stationMap.get(owned.stationId);
        const prop = st?.properties?.find((p) => p.id === owned.propertyId);
        if (!prop || !ev.categories.includes(prop.category)) continue;
        const owner = this.players.find((p) => p.id === owned.ownerId);
        if (owner) {
          const bonus = Math.round(prop.price * rate * owned.level);
          owner.money += bonus;
          totalPaid += bonus;
        }
      }
      if (totalPaid === 0) return null;
      detail = `${ev.description}（対象物件に総額 +${totalPaid.toLocaleString()}万円の臨時配当！）`;
    }

    this.lastEventMessage = `${ev.icon} ${ev.title}`;
    return {
      type: 'random_event',
      playerId: this.players[0]?.id ?? '',
      payload: {
        title: ev.title,
        icon: ev.icon,
        description: detail,
        isPositive,
      },
    };
  }

  private canBuyOrUpgradeAtStation(player: PlayerInternalState, stationId: string): boolean {
    const station = this.stationMap.get(stationId);
    if (!station || !station.properties) return false;
    for (const prop of station.properties) {
      const owned = this.ownedProperties[prop.id];
      if (!owned) {
        const minCost =
          player.discountMode === 'cinderella'
            ? 0
            : player.discountMode === 'gold' || player.discountMode === 'platinum'
              ? Math.floor(prop.price * 0.1)
              : player.discountMode === 'silver'
                ? Math.floor(prop.price * 0.5)
                : prop.price;
        if (player.money >= minCost) return true;
      } else if (owned.ownerId === player.id && owned.level < 3 && player.money >= prop.price) {
        return true;
      }
    }
    return false;
  }

  private pickRandomDestination(
    excludeId: string,
    range?: { minDist?: number; maxDist?: number }
  ): string {
    const occupied = new Set(this.players.map((p) => p.stationId));
    let candidates = this.stations.filter(
      (s) => s.isDestinationCandidate && s.id !== excludeId && !occupied.has(s.id)
    );
    if (candidates.length === 0) {
      candidates = this.stations.filter((s) => s.isDestinationCandidate && s.id !== excludeId);
    }
    if (range && (range.minDist !== undefined || range.maxDist !== undefined)) {
      const distMap = this.pathfinder.getAllDistancesFrom(excludeId);
      const inRange = candidates.filter((s) => {
        const d = distMap.get(s.id);
        if (d === undefined) return false;
        if (range.minDist !== undefined && d < range.minDist) return false;
        if (range.maxDist !== undefined && d > range.maxDist) return false;
        return true;
      });
      if (inRange.length > 0) {
        candidates = inRange;
      }
    }
    if (candidates.length === 0) return 'sapporo';
    return candidates[Math.floor(Math.random() * candidates.length)].id;
  }

  private getStationName(stationId: string): string {
    return this.stationMap.get(stationId)?.name ?? stationId;
  }

  public recalculateRankingsAndDistances(): void {
    const distMap = this.pathfinder.getAllDistancesFrom(this.destinationStationId);

    // 各プレイヤーの物件資産合計を計算
    const propAssetMap = new Map<string, number>();
    for (const owned of Object.values(this.ownedProperties)) {
      const st = this.stationMap.get(owned.stationId);
      const prop = st?.properties?.find((p) => p.id === owned.propertyId);
      if (prop) {
        const val = investedValue(prop.price, owned.level);
        propAssetMap.set(owned.ownerId, (propAssetMap.get(owned.ownerId) ?? 0) + val);
      }
    }

    for (const p of this.players) {
      // 未定義カードIDが混入していた場合は自動除去し、枚数表示と手札一覧を完全一致させる
      if (p.cards.some((cid) => !this.cardMap.has(cid))) {
        p.cards = p.cards.filter((cid) => this.cardMap.has(cid));
      }
      p.distanceToDest = distMap.get(p.stationId) ?? 99;
      p.totalAssets = p.money + (propAssetMap.get(p.id) ?? 0);
      p.cardCount = p.cards.length;
      if (p.money < 0) {
        const st = this.ensurePlayerStats(p.id);
        st.maxDebt = Math.max(st.maxDebt, -p.money);
      }
    }

    const sorted = [...this.players].sort((a, b) => b.totalAssets - a.totalAssets);
    sorted.forEach((p, idx) => {
      p.rank = idx + 1;
    });
  }

  public getPublicState(): PublicGameState {
    const current = this.getCurrentPlayer();
    const publicPlayers: PlayerPublicState[] = this.players.map((p) => ({
      id: p.id,
      seatIndex: p.seatIndex,
      name: p.name,
      color: p.color,
      avatar: p.avatar,
      isCpu: p.isCpu,
      isConnected: p.isConnected,
      isMasterOverrideCpu: p.isMasterOverrideCpu,
      stationId: p.stationId,
      prevStationId: p.prevStationId,
      money: p.money,
      cardCount: p.cards.length,
      hasNuisance: p.hasNuisance,
      skipNextTurn: p.skipNextTurn,
      zekkochoTurns: p.zekkochoTurns,
      sealTurns: p.sealTurns,
      cowWalkTurns: p.cowWalkTurns,
      heccharaTurns: p.heccharaTurns,
      russellTurns: p.russellTurns,
      yellowTurns: p.yellowTurns,
      unchiPassTurns: p.unchiPassTurns,
      allSixNext: p.allSixNext,
      discountMode: p.discountMode,
      homeStationId: p.homeStationId,
      shuyuUses: p.shuyuUses,
      distanceToDest: p.distanceToDest,
      totalAssets: p.totalAssets,
      rank: p.rank,
    }));

    return {
      roomId: this.roomId,
      status: this.status,
      config: this.config,
      currentYear: this.currentYear,
      currentMonth: this.currentMonth,
      currentTurnPlayerId: current?.id ?? '',
      phase: this.phase,
      destinationStationId: this.destinationStationId,
      remainingSteps: this.remainingSteps,
      availableNextStations:
        this.phase === 'moving' && current ? this.getAvailableNextStations(current) : [],
      recommendedNextStations:
        this.phase === 'moving' && current ? this.getRecommendedNextStations(current) : [],
      reachableStations:
        this.phase === 'moving' && current ? this.getReachableStations(current) : [],
      undoStationId: this.phase === 'moving' ? this.getUndoStationId() : null,
      players: publicPlayers,
      ownedProperties: this.ownedProperties,
      nuisanceTargetPlayerId: this.nuisanceTargetPlayerId,
      nuisanceForm: this.nuisanceForm,
      bakuretsuSteps: this.bakuretsuSteps,
      economyPhase: this.economyPhase,
      unchiStations: this.unchiStations,
      minus10Stations: this.minus10Stations,
      lastEventMessage: this.lastEventMessage,
      eventLogs: this.eventLogs,
      localRules: this.localRules,
      turnCount: this.turnCount,
      canRollback: this.previousTurnSnapshot !== null,
      cardUsedThisTurn: this.cardUsedThisTurn,
      shopStockIds:
        this.phase === 'card_shop' && current ? getShopStockForStation(current.stationId) : undefined,
      shopPriceMultiplier: getCardShopPriceMultiplier(this.currentYear),
      duelOpponentIds:
        this.phase === 'duel_setup' && this.activeDuelOpponentIds
          ? [...this.activeDuelOpponentIds]
          : undefined,
      assetHistory: this.assetHistory,
    };
  }

  public createSnapshot(): SavedGameSnapshot {
    return {
      version: 1,
      savedAt: new Date().toISOString(),
      roomId: this.roomId,
      status: this.status,
      config: { ...this.config },
      currentYear: this.currentYear,
      currentMonth: this.currentMonth,
      currentTurnIndex: this.currentTurnIndex,
      phase: this.phase,
      destinationStationId: this.destinationStationId,
      remainingSteps: this.remainingSteps,
      visitedPathThisTurn: [...this.visitedPathThisTurn],
      players: JSON.parse(JSON.stringify(this.players)),
      ownedProperties: JSON.parse(JSON.stringify(this.ownedProperties)),
      nuisanceTargetPlayerId: this.nuisanceTargetPlayerId,
      nuisanceForm: this.nuisanceForm,
      nuisanceTurnCount: this.nuisanceTurnCount,
      nuisanceFormRemainingTurns: this.nuisanceFormRemainingTurns,
      currentDestOriginDistance: this.currentDestOriginDistance,
      assetHistory: JSON.parse(JSON.stringify(this.assetHistory)),
      playerStats: JSON.parse(JSON.stringify(this.playerStats)),
      lastEventMessage: this.lastEventMessage,
      turnCount: this.turnCount,
      cardUsedThisTurn: this.cardUsedThisTurn,
    };
  }

  public loadFromSnapshot(snap: SavedGameSnapshot): void {
    this.roomId = snap.roomId;
    this.status = snap.status;
    this.config = { ...snap.config };
    this.currentYear = snap.currentYear;
    this.currentMonth = snap.currentMonth;
    this.currentTurnIndex = snap.currentTurnIndex;
    this.phase = snap.phase;
    this.destinationStationId = snap.destinationStationId;
    this.remainingSteps = snap.remainingSteps;
    this.visitedPathThisTurn = [...snap.visitedPathThisTurn];

    // 既存ソケット接続を維持しつつプレイヤーデータを復元
    const currentSockets = new Map(
      this.players.filter((p) => p.socketId).map((p) => [p.token, p.socketId])
    );

    this.players = JSON.parse(JSON.stringify(snap.players));
    for (const p of this.players) {
      const sock = currentSockets.get(p.token) ?? null;
      p.socketId = sock;
      p.isConnected = p.isCpu || sock !== null;
    }

    this.ownedProperties = JSON.parse(JSON.stringify(snap.ownedProperties));
    this.nuisanceTargetPlayerId = snap.nuisanceTargetPlayerId;
    this.nuisanceForm = snap.nuisanceForm ?? 'normal';
    this.nuisanceTurnCount = snap.nuisanceTurnCount ?? 0;
    this.nuisanceFormRemainingTurns = snap.nuisanceFormRemainingTurns ?? 0;
    this.currentDestOriginDistance = snap.currentDestOriginDistance ?? 20;
    this.assetHistory = snap.assetHistory ? JSON.parse(JSON.stringify(snap.assetHistory)) : [];
    this.playerStats = snap.playerStats ? JSON.parse(JSON.stringify(snap.playerStats)) : {};
    this.lastEventMessage = snap.lastEventMessage;
    this.turnCount = snap.turnCount;
    this.cardUsedThisTurn = Boolean(snap.cardUsedThisTurn);
    this.recalculateRankingsAndDistances();
  }
}
