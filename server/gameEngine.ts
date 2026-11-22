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

// カード売り場の品揃え（クライアントの CardShopModal と一致させる）
export const SHOP_STOCK_IDS = [
  'express_2',
  'express_3',
  'super_express',
  'pinpoint_1',
  'pinpoint_2',
  'pinpoint_3',
  'pinpoint_6',
  'warp_near',
  'warp_near_dest',
  'shield',
  'steal_card',
  'swap_pos',
  'pass_nuisance',
  'card_pack',
];

// 物件の評価額（桃鉄スイッチ準拠：増資廃止・一括購入価格そのまま）
function investedValue(price: number, _level = 1): number {
  return price;
}

// 物件の年間収益（桃鉄スイッチ準拠：価格 × 収益率、独占で2倍）
function calcAnnualIncome(price: number, rate: number, _level: number, isMonopolized: boolean): number {
  const monoMult = isMonopolized ? 2.0 : 1.0;
  return Math.round(price * rate * monoMult);
}

// インフレシステム廃止（桃鉄スイッチの固定基準値をそのまま使用）
export function getYearInflationMult(_year: number): number {
  return 1;
}

// カード売り場価格（固定基準値・インフレなし）
export function getCardShopPrice(basePrice: number | undefined, _year = 1): number {
  return basePrice ?? 1500;
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
  public economyPhase: EconomyPhase = 'normal';
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
    this.destinationStationId = this.pickRandomDestination('tokyo');
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
    this.economyPhase = 'normal';
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
      cards: ['express_2', 'pinpoint_1'],
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
      cards: ['express_2', 'pinpoint_1'],
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

    this.destinationStationId = this.pickRandomDestination('tokyo');
    this.status = 'playing';
    this.currentYear = 1;
    this.currentMonth = 4;
    this.currentTurnIndex = 0;
    this.phase = 'action_select';
    this.turnCount = 1;
    this.cardUsedThisTurn = false;
    this.lastEventMessage = `ゲームスタート！最初の目的地は「${this.getStationName(this.destinationStationId)}」です！`;

    this.recalculateRankingsAndDistances();
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

    const rolls: number[] = [];
    for (let i = 0; i < diceCount; i++) {
      rolls.push(Math.floor(Math.random() * 6) + 1);
    }
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
    if (this.cardUsedThisTurn) {
      return { ok: false, error: 'カードは1ターンに1枚までです。サイコロを振ってください。', events: [] };
    }
    this.cardUsedThisTurn = true;

    // カード消費
    player.cards.splice(cardIndex, 1);
    player.cardCount = player.cards.length;

    const events: GameEventSeqItem[] = [
      {
        type: 'card_used',
        playerId: player.id,
        payload: { cardId: card.id, cardName: card.name, icon: card.icon, targetPlayerId },
      },
    ];

    if (card.category === 'dice') {
      const count = card.diceCount ?? 2;
      const rolls: number[] = [];
      for (let i = 0; i < count; i++) {
        rolls.push(Math.floor(Math.random() * 6) + 1);
      }
      const total = rolls.reduce((a, b) => a + b, 0);
      this.remainingSteps = total;
      this.visitedPathThisTurn = [player.stationId];
      this.phase = 'moving';

      // 周遊カード（リニア周遊含む）は70%の確率で手元に残る！
      let keptMsg = '';
      if (
        (card.id === 'express_shuyu' ||
          card.id === 'super_shuyu' ||
          card.id === 'shinkansen_shuyu' ||
          card.id === 'nozomi_shuyu' ||
          card.id === 'super_linear') &&
        Math.random() < 0.7 &&
        player.cards.length < 8
      ) {
        player.cards.push(card.id);
        player.cardCount = player.cards.length;
        keptMsg = '（周遊カードは手元に残った！）';
      }

      this.lastEventMessage = `${player.name}が「${card.name}」を使用！ 出目: ${rolls.join(' + ')} = ${total}${keptMsg}`;
      events.push({ type: 'dice_roll', playerId: player.id, payload: { rolls, total } });
      return { ok: true, events };
    }

    if (card.category === 'fixed_move') {
      let steps = card.fixedSteps ?? 1;
      if (card.id === 'special_move') {
        const dist = this.pathfinder.getShortestDistance(
          player.stationId,
          this.destinationStationId
        );
        steps = dist >= 1 && dist <= 6 ? dist : 6;
      }
      this.remainingSteps = steps;
      this.visitedPathThisTurn = [player.stationId];
      this.phase = 'moving';
      this.lastEventMessage = `${player.name}が「${card.name}」を使用！ ぴったり${steps}マス進みます！`;
      events.push({ type: 'dice_roll', playerId: player.id, payload: { rolls: [steps], total: steps, isFixed: true } });
      return { ok: true, events };
    }

    if (card.category === 'economy') {
      if (card.id === 'shuffle_all') {
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
        this.lastEventMessage = `⛩️✨ ${player.name}が大お祓いカードでケチケチ大王を撃退＆バリアカード獲得！`;
      } else if (card.id === 'angel_card') {
        const gain = Math.round((5000 * getYearInflationMult(this.currentYear)) / 100) * 100;
        player.money += gain;
        if (player.cards.length < 8) {
          const rc = this.cards[Math.floor(Math.random() * this.cards.length)];
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
        this.lastEventMessage = `📢 ${player.name}が「全員集合カード」を発動！全社長が${this.getStationName(player.stationId)}へ集合！`;
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
        if (player.cards.length > 0 && player.cards.length < 8) {
          const copyId = player.cards[Math.floor(Math.random() * player.cards.length)];
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
        for (let i = 0; i < 2; i++) {
          if (player.cards.length < 8) {
            const rc = this.cards[Math.floor(Math.random() * this.cards.length)];
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
      let candidates = this.stations.filter(
        (s) => s.type === 'property' && s.id !== player.stationId && s.id !== this.destinationStationId
      );
      if (card.id === 'warp_near_dest') {
        const distMap = this.pathfinder.getAllDistancesFrom(this.destinationStationId);
        const near = this.stations.filter((s) => {
          const d = distMap.get(s.id) ?? 999;
          return d >= 2 && d <= 6 && s.id !== player.stationId;
        });
        if (near.length > 0) candidates = near;
      } else if (card.id === 'goal_half_warp') {
        const distMap = this.pathfinder.getAllDistancesFrom(this.destinationStationId);
        const curDist = distMap.get(player.stationId) ?? 20;
        const targetMax = Math.max(2, Math.floor(curDist * 0.55));
        const closer = this.stations.filter((s) => {
          const d = distMap.get(s.id) ?? 999;
          return d >= 2 && d <= targetMax && s.id !== player.stationId;
        });
        if (closer.length > 0) candidates = closer;
      } else if (card.id === 'warp_north') {
        const north = candidates.filter((s) => s.region === '北海道' || s.region === '東北');
        if (north.length > 0) candidates = north;
      } else if (card.id === 'warp_south') {
        const south = candidates.filter((s) => s.region === '九州' || s.region === '沖縄');
        if (south.length > 0) candidates = south;
      } else if (card.id === 'warp_east') {
        const east = candidates.filter((s) => s.region === '関東' || s.region === '中部');
        if (east.length > 0) candidates = east;
      } else if (card.id === 'warp_west') {
        const west = candidates.filter(
          (s) => s.region === '近畿' || s.region === '中国' || s.region === '四国'
        );
        if (west.length > 0) candidates = west;
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
        return { ok: true, events: [...events, ...this.resolveWarpArrival(player, dest.id)] };
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

      // バリアチェック
      const shieldIdx = target.cards.findIndex((id) => id === 'shield' || id === 'king_shield');
      if (shieldIdx !== -1) {
        target.cards.splice(shieldIdx, 1);
        target.cardCount = target.cards.length;
        this.lastEventMessage = `${player.name}の「${card.name}」を${target.name}がバリアカードで防いだ！`;
        const endEvents = this.finishTurn(player);
        return { ok: true, events: [...events, ...endEvents] };
      }

      if (card.id === 'summon_rival') {
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
      const baseBonus =
        this.eventsData.stationValues.destinationBonusBase * getYearInflationMult(this.currentYear);
      const bonus = Math.round((baseBonus * streakMult) / 100) * 100;
      player.money += bonus;

      // 次の目的地を先に決定して演出に表示する
      const arrivedName = this.getStationName(nextStationId);
      const arrivedStation = this.stationMap.get(nextStationId);
      this.destinationStationId = this.pickRandomDestination(nextStationId);
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

      // 到着駅が物件駅なら購入フェーズへ（買えるものがあれば）
      if (this.canBuyOrUpgradeAtStation(player, nextStationId)) {
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

  // ワープ後の到着処理（ワープ駅の連鎖は起こさず、それ以外は通常の到着マス効果を適用）
  private resolveWarpArrival(player: PlayerInternalState, stationId: string): GameEventSeqItem[] {
    const st = this.stationMap.get(stationId);
    if (!st || st.type === 'warp') return this.finishTurn(player);
    return this.resolveStationArrival(player, stationId);
  }

  private resolveStationArrival(player: PlayerInternalState, stationId: string): GameEventSeqItem[] {
    const station = this.stationMap.get(stationId);
    if (!station) return this.finishTurn(player);

    const events: GameEventSeqItem[] = [];
    const yearMultiplier = getYearInflationMult(this.currentYear);
    const isSummer = this.currentMonth >= 6 && this.currentMonth <= 8;
    const isWinter = this.currentMonth === 12 || this.currentMonth <= 2;

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

    if (station.type === 'plus') {
      const baseList = this.eventsData.stationValues.plusBase;
      const base = baseList[Math.floor(Math.random() * baseList.length)];
      const seasonMult = isSummer ? 1.5 : isWinter ? 0.6 : 1.0;
      const econMult = this.economyPhase === 'boom' ? 1.5 : 1.0;
      const seasonTag = [
        isSummer ? '☀️ 夏のボーナス' : isWinter ? '❄️ 冬はひかえめ' : '',
        this.economyPhase === 'boom' ? '📈 好景気×1.5' : '',
      ]
        .filter(Boolean)
        .join(' / ');
      const amount = Math.round((base * yearMultiplier * seasonMult * econMult) / 100) * 100;
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

    if (station.type === 'minus') {
      const baseList = this.eventsData.stationValues.minusBase;
      const base = baseList[Math.floor(Math.random() * baseList.length)];
      const seasonMult = isWinter ? 1.8 : isSummer ? 0.6 : 1.0;
      const econMult = this.economyPhase === 'recession' ? 1.5 : 1.0;
      const seasonTag = [
        isWinter ? '❄️ 冬の厳しい出費' : isSummer ? '☀️ 夏はひかえめ' : '',
        this.economyPhase === 'recession' ? '📉 不景気×1.5' : '',
      ]
        .filter(Boolean)
        .join(' / ');
      const amount = Math.round((base * yearMultiplier * seasonMult * econMult) / 100) * 100;
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

    if (station.type === 'card' || station.type === 'nice_card') {
      const pool =
        station.type === 'nice_card'
          ? this.cards.filter((c) => c.rarity === 'rare' || c.rarity === 'uncommon')
          : this.cards;
      const randomCard = pool[Math.floor(Math.random() * pool.length)] ?? this.cards[0];
      let gained = false;
      if (player.cards.length < 8) {
        player.cards.push(randomCard.id);
        player.cardCount = player.cards.length;
        gained = true;
        const prefix = station.type === 'nice_card' ? '✨ナイスカード駅' : '🟡カード駅';
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
          isNice: station.type === 'nice_card',
          cardName: gained ? randomCard.name : null,
          cardIcon: gained ? randomCard.icon : null,
        },
      });
      events.push(...stationLocalRules);
      return [...events, ...this.finishTurn(player)];
    }

    if (station.type === 'shop') {
      events.push(...stationLocalRules);
      if ((player.cards.length < 8 && player.money >= 400) || player.cards.length > 0) {
        this.phase = 'card_shop';
        this.lastEventMessage = `🛒 ${player.name}がカード売り場に到着！カードの売買ができます。`;
        return events;
      } else {
        this.lastEventMessage = `🛒 ${player.name}がカード売り場に到着（売買不可）。`;
        return [...events, ...this.finishTurn(player)];
      }
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
        // ワープ先の物件駅で購入できるなら購入フェーズへ
        if (this.canBuyOrUpgradeAtStation(player, dest.id)) {
          this.phase = 'property_buy';
          return events;
        }
      }
      return [...events, ...this.finishTurn(player)];
    }

    if (station.type === 'property') {
      events.push(...stationLocalRules);
      if (this.canBuyOrUpgradeAtStation(player, stationId)) {
        this.phase = 'property_buy';
        this.lastEventMessage = `🏢 ${player.name}が物件駅「${station.name}」に到着！物件を購入できます。`;
        return events;
      } else {
        this.lastEventMessage = `🏢 ${player.name}が「${station.name}」に到着（購入・増資できる物件なし）。`;
        return [...events, ...this.finishTurn(player)];
      }
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

    for (const pid of propertyIds) {
      const prop = propMap.get(pid);
      if (!prop || this.ownedProperties[pid]) continue;
      if (player.money >= prop.price) {
        player.money -= prop.price;
        this.ownedProperties[pid] = {
          propertyId: pid,
          stationId: station.id,
          ownerId: player.id,
          level: 1,
        };
        boughtNames.push(prop.name);
      }
    }

    const events: GameEventSeqItem[] = [];
    if (boughtNames.length > 0) {
      this.lastEventMessage = `🏢 ${player.name}が ${boughtNames.join('、')} を購入/増資しました！`;
      if (!wasMonopolized && this.isStationMonopolizedBy(station.id, player.id)) {
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

  // 本家名物「スリの銀次」遭遇判定（現金5,000万円以上でプラス/マイナス駅到着時に5%）
  private maybeTriggerPickpocket(player: PlayerInternalState): GameEventSeqItem | null {
    if (this.config.enablePickpocket === false) return null;
    if (player.money < 5000 || Math.random() >= 0.05) return null;
    const shieldIdx = player.cards.findIndex((id) => id === 'shield' || id === 'king_shield');
    if (shieldIdx !== -1) {
      player.cards.splice(shieldIdx, 1);
      player.cardCount = player.cards.length;
      this.lastEventMessage = `🕵️ スリの銀次が現れたが、${player.name}はバリアカードで撃退した！`;
      return {
        type: 'random_event',
        playerId: player.id,
        payload: {
          title: '🕵️ スリの銀次を撃退！',
          icon: '🛡️',
          description: `スリの銀次が狙ってきたが、${player.name}はバリアカードで完全に防いだ！`,
          isPositive: true,
        },
      };
    }
    const stolen = Math.round((player.money * 0.25) / 100) * 100;
    player.money -= stolen;
    this.recalculateRankingsAndDistances();
    this.lastEventMessage = `🕵️ スリの銀次出現！${player.name}は持ち金の25%（-${stolen.toLocaleString()}万円）をすられた！`;
    return {
      type: 'random_event',
      playerId: player.id,
      payload: {
        title: '🕵️ スリの銀次 出現！！',
        icon: '🕵️',
        description: `「へへっ、いただきだ！」${player.name}は現金 ${stolen.toLocaleString()}万円をすられてしまった！`,
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
    if (!card || !SHOP_STOCK_IDS.includes(card.id) || player.cards.length >= 8 || player.money < price) {
      return { ok: false, error: 'このカードは購入できません。', events: [] };
    }
    player.money -= price;
    player.cards.push(card.id);
    player.cardCount = player.cards.length;
    this.lastEventMessage = `🛒 ${player.name}が「${card.name}」を${price.toLocaleString()}万円で購入しました！`;
    this.recalculateRankingsAndDistances();

    // 続けて買えるなら売り場に留まる（「買い物を終える」で終了）
    const cheapest = Math.min(
      ...SHOP_STOCK_IDS.map((id) => getCardShopPrice(this.cardMap.get(id)?.price, this.currentYear))
    );
    if (player.cards.length < 8 && player.money >= cheapest) {
      return { ok: true, events: [] };
    }
    const endEvents = this.finishTurn(player);
    return { ok: true, events: endEvents };
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
    // 桃鉄スイッチ公式仕様：カード売値は買値の1/4（25%）
    const sellPrice = Math.floor(getCardShopPrice(card.price, this.currentYear) * 0.25);
    player.cards.splice(cardIndex, 1);
    player.cardCount = player.cards.length;
    player.money += sellPrice;
    this.recalculateRankingsAndDistances();
    this.lastEventMessage = `🛒 ${player.name}が「${card.name}」を ${sellPrice.toLocaleString()}万円で売却しました！`;
    return { ok: true, events: [] };
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

    // お邪魔キャラの変身＆悪行発動チェック（1回休みのターンは何も起きない）
    if (!skipped && player.hasNuisance) {
      // 一定確率で変身（プチ・キング・割合・ハッピー）または通常へ戻る
      if (this.nuisanceForm === 'normal' && Math.random() < 0.28) {
        const r = Math.random();
        const allowRateCurse = this.config.enableRateCurse !== false;
        if (r < 0.32) {
          this.nuisanceForm = 'mini';
          events.push({
            type: 'random_event',
            playerId: player.id,
            payload: {
              title: '👶 プチケチに変身！',
              icon: '👶',
              description: `ケチケチ大王がかわいい「プチケチ」に変身した！少しだけ出費が軽くなりそう！`,
              isPositive: true,
            },
          });
        } else if (allowRateCurse && r < 0.62) {
          this.nuisanceForm = 'rate_curse';
          events.push({
            type: 'nuisance_action',
            playerId: player.id,
            payload: {
              blocked: false,
              title: '📉 割合ケチケチに変身！！',
              description: `不気味な電卓の音…！ケチケチ大王が所持物件の収益率をマイナスにする「割合ケチケチ」に変身した！！`,
              icon: '📉',
            },
          });
        } else if (r < 0.88) {
          this.nuisanceForm = 'king';
          events.push({
            type: 'nuisance_action',
            playerId: player.id,
            payload: {
              blocked: false,
              title: '🔥 キングケチケチに変身！！',
              description: `ズゴゴゴゴ…！ケチケチ大王が最凶の「キングケチケチ」に変身してしまった！！`,
              icon: '🔥',
            },
          });
        } else {
          this.nuisanceForm = 'happy';
          events.push({
            type: 'random_event',
            playerId: player.id,
            payload: {
              title: '😇 ハッピー大王に変身！',
              icon: '😇',
              description: `奇跡！ケチケチ大王が「ハッピー大王」に変身した！幸運が舞い降りるかも！？`,
              isPositive: true,
            },
          });
        }
      } else if (this.nuisanceForm !== 'normal' && Math.random() < 0.32) {
        this.nuisanceForm = 'normal';
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
        const shieldIdx = player.cards.findIndex((id) => id === 'shield' || id === 'king_shield');
        if (shieldIdx !== -1) {
          player.cards.splice(shieldIdx, 1);
          player.cardCount = player.cards.length;
          events.push({
            type: 'nuisance_action',
            playerId: player.id,
            payload: {
              blocked: true,
              title: 'バリアカード発動！',
              description: `${player.name}はバリアカードで${
                this.nuisanceForm === 'king'
                  ? 'キングケチケチ'
                  : this.nuisanceForm === 'rate_curse'
                    ? '割合ケチケチ'
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
            const myProps = this.getPlayerProperties(player.id);
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
                  description: `キングケチケチが「${def?.name ?? '物件'}」を勝手に手放してしまった！！（売却金ゼロ！）`,
                  icon: '🔥',
                },
              });
            } else {
              const loss = 4000;
              player.money -= loss;
              events.push({
                type: 'nuisance_action',
                playerId: player.id,
                payload: {
                  blocked: false,
                  title: '🔥 キングの豪遊！！',
                  description: `キングケチケチが宇宙旅行へ行った！ (-${loss.toLocaleString()}万円)`,
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

    // ご当地歴史ヒーロー発動チェック（独占している都市の偉人が35%の確率で応援！）
    if (!skipped && !player.hasNuisance && Math.random() < 0.35) {
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
            payload: { rankings: this.getPublicState().players },
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
      desc = `${st.name}の偉人「${hero.name}」が「バリアカード」を授けてくれた！`;
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
      // 行き止まり駅（隣接1駅のみ）では折り返し前進（歩数消費）とし、無限ループを防ぐ
      if (currentSt && currentSt.neighbors.length <= 1) {
        return null;
      }
      return this.visitedPathThisTurn[this.visitedPathThisTurn.length - 2];
    }
    return null;
  }

  public getAvailableNextStations(player: PlayerInternalState): string[] {
    const station = this.stationMap.get(player.stationId);
    if (!station) return [];
    // すべての隣接駅をタップ可能（直前の駅をタップすると1歩戻る）
    return [...station.neighbors];
  }

  public getRecommendedNextStations(player: PlayerInternalState): string[] {
    const station = this.stationMap.get(player.stationId);
    if (!station) return [];
    const undoId = this.getUndoStationId();
    const candidates = station.neighbors.filter((n) => n !== undoId);
    const list = candidates.length > 0 ? candidates : station.neighbors;
    const distMap = this.pathfinder.getAllDistancesFrom(this.destinationStationId);

    let minDist = Infinity;
    for (const id of list) {
      const d = distMap.get(id) ?? 999;
      if (d < minDist) minDist = d;
    }
    return list.filter((id) => (distMap.get(id) ?? 999) === minDist);
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
    if (stationId && this.stationMap.has(stationId)) {
      this.destinationStationId = stationId;
    } else {
      this.destinationStationId = this.pickRandomDestination(this.destinationStationId);
    }
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
    const labels: Record<NuisanceForm, string> = {
      normal: '👹 通常（ケチケチ大王）',
      mini: '👶 プチケチ',
      king: '🔥 キングケチケチ',
      rate_curse: '📉 割合ケチケチ',
      happy: '😇 ハッピー大王',
    };
    this.lastEventMessage = `👑 管理者操作: ケチケチ大王の形態を「${labels[form]}」へ変更しました！`;
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
      const shieldIdx = player.cards.indexOf('shield');
      if (shieldIdx !== -1) {
        player.cards.splice(shieldIdx, 1);
        player.cardCount = player.cards.length;
        return {
          type: 'random_event',
          playerId: player.id,
          payload: {
            title: '🛡️ バリアカード発動！',
            icon: '🛡️',
            description: `スリの銀次が現れたが、${player.name}はバリアカードで撃退した！`,
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
      if (!owned && player.money >= prop.price) return true;
    }
    return false;
  }

  private pickRandomDestination(excludeId: string): string {
    const occupied = new Set(this.players.map((p) => p.stationId));
    let candidates = this.stations.filter(
      (s) => s.isDestinationCandidate && s.id !== excludeId && !occupied.has(s.id)
    );
    if (candidates.length === 0) {
      candidates = this.stations.filter((s) => s.isDestinationCandidate && s.id !== excludeId);
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
      p.distanceToDest = distMap.get(p.stationId) ?? 99;
      p.totalAssets = p.money + (propAssetMap.get(p.id) ?? 0);
      p.cardCount = p.cards.length;
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
      undoStationId: this.phase === 'moving' ? this.getUndoStationId() : null,
      players: publicPlayers,
      ownedProperties: this.ownedProperties,
      nuisanceTargetPlayerId: this.nuisanceTargetPlayerId,
      nuisanceForm: this.nuisanceForm,
      economyPhase: this.economyPhase,
      lastEventMessage: this.lastEventMessage,
      eventLogs: this.eventLogs,
      localRules: this.localRules,
      turnCount: this.turnCount,
      canRollback: this.previousTurnSnapshot !== null,
      cardUsedThisTurn: this.cardUsedThisTurn,
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
    this.lastEventMessage = snap.lastEventMessage;
    this.turnCount = snap.turnCount;
    this.cardUsedThisTurn = Boolean(snap.cardUsedThisTurn);
    this.recalculateRankingsAndDistances();
  }
}
