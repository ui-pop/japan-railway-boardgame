import React, { useEffect, useMemo, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  BookOpen,
  Bot,
  Crown,
  FastForward,
  Flag,
  LayoutDashboard,
  Pause,
  Play,
  QrCode,
  RefreshCw,
  RotateCcw,
  Save,
  ScrollText,
  Sparkles,
  Users,
} from 'lucide-react';
import type {
  CardDef,
  EventsData,
  LocalRuleEffect,
  LocalRuleTarget,
  LocalRuleTrigger,
  PublicGameState,
  SaveFileInfo,
  StationDef,
  StationType,
} from '../types';
import { formatMoney } from './StatusBar';

interface AdminPanelProps {
  connected: boolean;
  gameState: PublicGameState | null;
  stations: StationDef[];
  cardsMaster: CardDef[];
  eventsData: EventsData | null;
  savesList: SaveFileInfo[];
  adminPlayersCards: Record<string, string[]>;
  onCreateGame: (totalYears: number, initialMoney: number, cpuCount: number) => void;
  onStartGame: () => void;
  onAddCpu: () => void;
  onRemovePlayer: (playerId: string) => void;
  onTogglePause: () => void;
  onToggleCpu: (playerId: string) => void;
  onForceSkip: () => void;
  onRollback: () => void;
  onAdjustMoney: (playerId: string, delta: number) => void;
  onGiveCard: (playerId: string, cardId: string) => void;
  onGiveCardAll: (cardId: string) => void;
  onRemoveCard: (playerId: string, cardIndex: number) => void;
  onWarpPlayer: (playerId: string, stationId: string) => void;
  onChangeDest: (stationId?: string) => void;
  onBroadcastMessage: (title: string, message: string, targetPlayerId?: string) => void;
  onSetNuisance: (playerId: string | null) => void;
  onAddLocalRule: (rule: Record<string, unknown>) => void;
  onToggleLocalRule: (ruleId: string) => void;
  onDeleteLocalRule: (ruleId: string) => void;
  onSaveNamed: (label: string) => void;
  onLoadSave: (fileName: string) => void;
}

export const AdminPanel: React.FC<AdminPanelProps> = ({
  connected,
  gameState,
  stations,
  cardsMaster,
  eventsData,
  savesList,
  adminPlayersCards,
  onCreateGame,
  onStartGame,
  onAddCpu,
  onRemovePlayer,
  onTogglePause,
  onToggleCpu,
  onForceSkip,
  onRollback,
  onAdjustMoney,
  onGiveCard,
  onGiveCardAll,
  onRemoveCard,
  onWarpPlayer,
  onChangeDest,
  onBroadcastMessage,
  onSetNuisance,
  onAddLocalRule,
  onToggleLocalRule,
  onDeleteLocalRule,
  onSaveNamed,
  onLoadSave,
}) => {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'rules' | 'local_rules' | 'god'>('dashboard');
  const [totalYears, setTotalYears] = useState(3);
  const [initialMoney, setInitialMoney] = useState(10000);
  const [cpuCount, setCpuCount] = useState(1);
  const [saveLabel, setSaveLabel] = useState('');

  // ローカルルール作成フォーム用ステート
  const [lrName, setLrName] = useState('');
  const [lrTrigger, setLrTrigger] = useState<LocalRuleTrigger>('on_dice_roll');
  const [lrTriggerVal, setLrTriggerVal] = useState<number>(1);
  const [lrStationId, setLrStationId] = useState<string>('tokyo');
  const [lrStationType, setLrStationType] = useState<StationType>('property');
  const [lrProb, setLrProb] = useState<number>(100);
  const [lrTarget, setLrTarget] = useState<LocalRuleTarget>('actor');
  const [lrEffect, setLrEffect] = useState<LocalRuleEffect>('cash_delta');
  const [lrAmount, setLrAmount] = useState<number>(2000);
  const [lrCardId, setLrCardId] = useState<string>('');
  const [lrMessage, setLrMessage] = useState('');

  // 神の手ツール用選択ステート
  const [targetPlayerId, setTargetPlayerId] = useState('');
  const [selectedCardId, setSelectedCardId] = useState('express_2');
  const [customMoneyDelta, setCustomMoneyDelta] = useState<number>(10000);
  const [warpStationId, setWarpStationId] = useState<string>('tokyo');
  const [destSelectStationId, setDestSelectStationId] = useState<string>('sapporo');
  const [broadcastTitle, setBroadcastTitle] = useState('運営からのお知らせ');
  const [broadcastMsg, setBroadcastMsg] = useState('');
  const [broadcastTargetId, setBroadcastTargetId] = useState('');

  const [localIps, setLocalIps] = useState<string[]>([]);
  const [ipDetails, setIpDetails] = useState<{ name: string; ip: string }[]>([]);
  const [selectedIpIndex, setSelectedIpIndex] = useState(0);
  const [serverPort, setServerPort] = useState(3000);
  const isCloudHost =
    window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1';
  const [tunnelUrl, setTunnelUrl] = useState<string>(
    isCloudHost ? window.location.origin : ''
  );
  const [customUrl, setCustomUrl] = useState(
    isCloudHost ? window.location.origin : ''
  );

  useEffect(() => {
    if (isCloudHost) {
      setTunnelUrl(window.location.origin);
      setCustomUrl(window.location.origin);
      return;
    }

    fetch('/api/network-info')
      .then((res) => res.json())
      .then((data) => {
        setLocalIps(data.ips ?? []);
        setIpDetails(data.details ?? []);
        setServerPort(data.port ?? 3000);
        if (data.tunnelUrl) {
          setTunnelUrl(data.tunnelUrl);
          setCustomUrl(data.tunnelUrl);
        }
      })
      .catch(() => {});

    fetch('/tunnel_url.txt')
      .then((res) => (res.ok ? res.text() : ''))
      .then((txt) => {
        const trimmed = txt.trim();
        if (trimmed.startsWith('http')) {
          setTunnelUrl(trimmed);
          setCustomUrl(trimmed);
        }
      })
      .catch(() => {});
  }, [isCloudHost]);

  useEffect(() => {
    if (!targetPlayerId && gameState && gameState.players.length > 0) {
      setTargetPlayerId(gameState.players[0].id);
    }
  }, [gameState, targetPlayerId]);

  const stationMap = useMemo(() => new Map(stations.map((s) => [s.id, s])), [stations]);
  const destStation = gameState ? stationMap.get(gameState.destinationStationId) : null;

  const activeIp = ipDetails[selectedIpIndex]?.ip || localIps[selectedIpIndex] || localIps[0];
  const defaultJoinUrl = activeIp
    ? `http://${activeIp}:${window.location.port || serverPort}`
    : window.location.origin;
  const joinUrl = customUrl.trim() || defaultJoinUrl;

  const maxAssets = useMemo(() => {
    if (!gameState || gameState.players.length === 0) return 10000;
    return Math.max(10000, ...gameState.players.map((p) => Math.max(0, p.totalAssets)));
  }, [gameState]);

  const ownedCountByPlayer = useMemo(() => {
    const counts = new Map<string, number>();
    if (!gameState) return counts;
    for (const o of Object.values(gameState.ownedProperties)) {
      counts.set(o.ownerId, (counts.get(o.ownerId) ?? 0) + 1);
    }
    return counts;
  }, [gameState]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-5 md:p-6">
      <div className="max-w-7xl mx-auto space-y-5">
        {/* ヘッダー */}
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4">
          <div>
            <h1 className="text-2xl font-black text-white flex items-center gap-2">
              🚄 日本縦断鉄道ボードゲーム 管理ダッシュボード
            </h1>
            <div className="text-xs text-slate-400 mt-1 flex flex-wrap items-center gap-3">
              <span>全{stations.length}マス（100都市・351物件）</span>
              <span>カード全{cardsMaster.length}種</span>
              {destStation && (
                <span className="text-amber-300 font-bold">
                  🚩 現在の目的地: {destStation.name}（{destStation.region}）
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <span
              className={`px-3 py-1 rounded-full text-xs font-bold ${
                connected
                  ? 'bg-emerald-950 text-emerald-300 border border-emerald-600/50'
                  : 'bg-rose-950 text-rose-300 border border-rose-600/50'
              }`}
            >
              {connected ? '● 接続中' : '○ 切断'}
            </span>
            {gameState && (
              <span className="px-3 py-1 rounded-full bg-indigo-950 text-indigo-300 border border-indigo-600/50 text-xs font-bold">
                {gameState.status.toUpperCase()} ・ {gameState.currentYear}年目 {gameState.currentMonth}月（{gameState.turnCount}ターン目）
              </span>
            )}
          </div>
        </header>

        {/* タブ切替バー */}
        <nav className="flex flex-wrap gap-2">
          <button
            onClick={() => setActiveTab('dashboard')}
            className={`px-4 py-2.5 rounded-xl text-sm font-extrabold flex items-center gap-2 border transition ${
              activeTab === 'dashboard'
                ? 'bg-sky-600 border-sky-400 text-white shadow-lg'
                : 'bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-800'
            }`}
          >
            <LayoutDashboard className="w-4 h-4" />
            運営・戦況ダッシュボード
          </button>
          <button
            onClick={() => setActiveTab('rules')}
            className={`px-4 py-2.5 rounded-xl text-sm font-extrabold flex items-center gap-2 border transition ${
              activeTab === 'rules'
                ? 'bg-amber-600 border-amber-400 text-white shadow-lg'
                : 'bg-slate-900 border-slate-700 text-amber-300 hover:bg-slate-800'
            }`}
          >
            <BookOpen className="w-4 h-4" />
            📖 全ルール＆完全図鑑
          </button>
          <button
            onClick={() => setActiveTab('local_rules')}
            className={`px-4 py-2.5 rounded-xl text-sm font-extrabold flex items-center gap-2 border transition ${
              activeTab === 'local_rules'
                ? 'bg-emerald-600 border-emerald-400 text-white shadow-lg'
                : 'bg-slate-900 border-slate-700 text-emerald-300 hover:bg-slate-800'
            }`}
          >
            ⚖️ ローカルルール設定 ({gameState?.localRules?.filter((r) => r.enabled).length ?? 0})
          </button>
          <button
            onClick={() => setActiveTab('god')}
            className={`px-4 py-2.5 rounded-xl text-sm font-extrabold flex items-center gap-2 border transition ${
              activeTab === 'god'
                ? 'bg-purple-600 border-purple-400 text-white shadow-lg'
                : 'bg-slate-900 border-slate-700 text-purple-300 hover:bg-slate-800'
            }`}
          >
            <Sparkles className="w-4 h-4" />
            神の手（マスター介入）＆履歴
          </button>
        </nav>

        {/* ========== タブ1: 運営ダッシュボード ========== */}
        {activeTab === 'dashboard' && (
          <div className="space-y-6">
            {/* 総資産リアルタイムグラフ（ゲーム進行中） */}
            {gameState && gameState.players.length > 0 && (
              <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-extrabold text-white flex items-center gap-2">
                    <Crown className="w-4 h-4 text-amber-400" />
                    リアルタイム総資産ランキング
                  </h2>
                  <span className="text-xs text-slate-400">
                    総物件所有数: {Object.keys(gameState.ownedProperties).length} / 351件
                  </span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {[...gameState.players]
                    .sort((a, b) => a.rank - b.rank)
                    .map((p) => {
                      const st = stationMap.get(p.stationId);
                      const ratio = Math.max(4, Math.min(100, (Math.max(0, p.totalAssets) / maxAssets) * 100));
                      return (
                        <div key={p.id} className="bg-slate-950/70 border border-slate-800 rounded-xl p-3">
                          <div className="flex items-center justify-between text-xs mb-1.5">
                            <div className="flex items-center gap-1.5 font-bold text-white">
                              <span className="text-amber-400 font-black">{p.rank}位</span>
                              <span>{p.avatar}</span>
                              <span style={{ color: p.color }}>{p.name}</span>
                              {p.hasNuisance && <span title="ケチケチ大王憑依中">👹</span>}
                              {p.skipNextTurn && <span title="冬眠中">❄️</span>}
                            </div>
                            <div className="font-extrabold text-emerald-400">
                              総資産 {formatMoney(p.totalAssets)}
                            </div>
                          </div>
                          <div className="w-full h-2.5 bg-slate-800 rounded-full overflow-hidden mb-1.5">
                            <div
                              className="h-full rounded-full transition-all duration-500"
                              style={{ width: `${ratio}%`, backgroundColor: p.color }}
                            />
                          </div>
                          <div className="flex flex-wrap justify-between text-[11px] text-slate-400 gap-2">
                            <span>現金: {formatMoney(p.money)}</span>
                            <span>物件: {ownedCountByPlayer.get(p.id) ?? 0}件</span>
                            <span>カード: {p.cardCount}/8</span>
                            <span>
                              現在地: {st?.type === 'property' ? `${st.name}駅` : '道中'}（あと{p.distanceToDest}マス）
                            </span>
                          </div>
                        </div>
                      );
                    })}
                </div>
              </section>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* 左カラム: QRコード & ルーム設定 */}
              <div className="space-y-6">
                <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
                  <h2 className="text-base font-extrabold flex items-center gap-2 text-white">
                    <QrCode className="w-5 h-5 text-sky-400" />
                    スマホ参加用 QRコード
                  </h2>
                  <div className="bg-white p-4 rounded-2xl w-fit mx-auto">
                    <QRCodeSVG value={joinUrl} size={172} />
                  </div>
                  <div className="text-xs text-slate-400 break-all bg-slate-950 p-2.5 rounded-xl border border-slate-800">
                    参加URL: <span className="text-sky-300 font-mono">{joinUrl}</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {tunnelUrl && (
                      <button
                        onClick={() => setCustomUrl(tunnelUrl)}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border ${
                          customUrl === tunnelUrl
                            ? 'bg-emerald-600 border-emerald-400 text-white'
                            : 'bg-slate-800 border-slate-700 text-slate-300'
                        }`}
                      >
                        🌐 外部公開URL (スマホ推奨)
                      </button>
                    )}
                    {ipDetails.map((d, idx) => (
                      <button
                        key={d.ip}
                        onClick={() => {
                          setSelectedIpIndex(idx);
                          setCustomUrl('');
                        }}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border ${
                          selectedIpIndex === idx && !customUrl
                            ? 'bg-sky-600 border-sky-400 text-white'
                            : 'bg-slate-800 border-slate-700 text-slate-300'
                        }`}
                      >
                        {d.name}: {d.ip}
                      </button>
                    ))}
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">
                      外部公開URL上書き
                    </label>
                    <input
                      type="text"
                      value={customUrl}
                      onChange={(e) => setCustomUrl(e.target.value)}
                      placeholder={defaultJoinUrl}
                      className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-sky-500"
                    />
                  </div>
                </section>

                <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
                  <h2 className="text-base font-extrabold text-white">⚙️ ルーム設定・新規作成</h2>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="block text-[11px] text-slate-400 mb-1">年数</label>
                      <input
                        type="number"
                        min={1}
                        max={99}
                        value={totalYears}
                        onChange={(e) => setTotalYears(Number(e.target.value))}
                        className="w-full px-2.5 py-2 rounded-xl bg-slate-950 border border-slate-700 text-sm text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-400 mb-1">初期資金(万)</label>
                      <input
                        type="number"
                        min={1000}
                        step={1000}
                        value={initialMoney}
                        onChange={(e) => setInitialMoney(Number(e.target.value))}
                        className="w-full px-2.5 py-2 rounded-xl bg-slate-950 border border-slate-700 text-sm text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-400 mb-1">初期CPU</label>
                      <input
                        type="number"
                        min={0}
                        max={7}
                        value={cpuCount}
                        onChange={(e) => setCpuCount(Number(e.target.value))}
                        className="w-full px-2.5 py-2 rounded-xl bg-slate-950 border border-slate-700 text-sm text-white"
                      />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => onCreateGame(totalYears, initialMoney, cpuCount)}
                      className="flex-1 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-600 text-xs font-bold flex items-center justify-center gap-1.5"
                    >
                      <RefreshCw className="w-4 h-4" />
                      新規作成/リセット
                    </button>
                    <button
                      onClick={onStartGame}
                      disabled={gameState?.status !== 'waiting'}
                      className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-600 text-xs font-extrabold text-white flex items-center justify-center gap-1.5"
                    >
                      <Play className="w-4 h-4" />
                      ゲーム開始
                    </button>
                  </div>
                </section>
              </div>

              {/* 中央カラム: プレイヤー監視 & 救済操作 */}
              <div className="space-y-6">
                <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="text-base font-extrabold flex items-center gap-2 text-white">
                      <Users className="w-5 h-5 text-emerald-400" />
                      接続中プレイヤー ({gameState?.players.length ?? 0}/8)
                    </h2>
                    {gameState?.status === 'waiting' ? (
                      <button
                        onClick={onAddCpu}
                        disabled={(gameState?.players.length ?? 0) >= 8}
                        className="px-3 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-500 disabled:bg-slate-800 disabled:text-slate-500 text-xs font-extrabold text-white flex items-center gap-1 shadow"
                      >
                        <Bot className="w-4 h-4" />
                        ＋ CPUを追加
                      </button>
                    ) : (
                      <button
                        onClick={onTogglePause}
                        className="px-3 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-xs font-bold text-white flex items-center gap-1"
                      >
                        {gameState?.status === 'paused' ? (
                          <>
                            <Play className="w-3.5 h-3.5" /> 再開
                          </>
                        ) : (
                          <>
                            <Pause className="w-3.5 h-3.5" /> 一時停止
                          </>
                        )}
                      </button>
                    )}
                  </div>

                  <div className="space-y-2 max-h-[380px] overflow-y-auto">
                    {gameState?.players.length === 0 ? (
                      <div className="text-center text-slate-500 py-8 text-sm">
                        まだプレイヤーが参加していません。
                      </div>
                    ) : (
                      gameState?.players.map((p) => {
                        const isTurn = p.id === gameState.currentTurnPlayerId;
                        return (
                          <div
                            key={p.id}
                            className={`flex items-center justify-between p-3 rounded-xl border ${
                              isTurn
                                ? 'bg-sky-950/60 border-sky-500'
                                : 'bg-slate-950/70 border-slate-800'
                            }`}
                          >
                            <div className="flex items-center gap-2.5">
                              <span
                                className="w-8 h-8 rounded-full flex items-center justify-center border border-white text-sm"
                                style={{ backgroundColor: p.color }}
                              >
                                {p.avatar}
                              </span>
                              <div>
                                <div className="text-sm font-bold text-white flex items-center gap-1.5">
                                  {p.name}
                                  {isTurn && (
                                    <span className="px-1.5 py-0.5 rounded bg-sky-600 text-[10px]">
                                      手番
                                    </span>
                                  )}
                                  {p.hasNuisance && <span>👹</span>}
                                </div>
                                <div className="text-xs text-slate-400">
                                  {p.isCpu
                                    ? 'CPU'
                                    : p.isConnected
                                      ? '🟢 オンライン'
                                      : '🔴 離脱中'}{' '}
                                  ・ 現金 {formatMoney(p.money)}
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center gap-1.5">
                              {gameState.status === 'waiting' && (
                                <button
                                  onClick={() => onRemovePlayer(p.id)}
                                  className="px-2.5 py-1.5 rounded-lg text-xs font-bold bg-rose-950/80 hover:bg-rose-800 border border-rose-700/60 text-rose-200"
                                >
                                  削除
                                </button>
                              )}
                              {!p.isCpu && gameState.status !== 'waiting' && (
                                <button
                                  onClick={() => onToggleCpu(p.id)}
                                  className={`px-2.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 border ${
                                    p.isMasterOverrideCpu
                                      ? 'bg-amber-600 border-amber-400 text-white'
                                      : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
                                  }`}
                                >
                                  <Bot className="w-3.5 h-3.5" />
                                  {p.isMasterOverrideCpu ? 'CPU代打中' : 'CPU代打'}
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </section>

                <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3">
                  <h2 className="text-base font-extrabold text-white">🛠️ 救済・進行コントロール</h2>
                  <p className="text-xs text-slate-300 bg-slate-950 p-2.5 rounded-xl border border-slate-800">
                    最新: {gameState?.lastEventMessage ?? '---'}
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={onForceSkip}
                      disabled={gameState?.status !== 'playing'}
                      className="flex-1 py-2.5 rounded-xl bg-rose-700 hover:bg-rose-600 disabled:bg-slate-800 disabled:text-slate-600 text-xs font-extrabold text-white flex items-center justify-center gap-1.5"
                    >
                      <FastForward className="w-4 h-4" />
                      強制スキップ
                    </button>
                    <button
                      onClick={onRollback}
                      disabled={!gameState?.canRollback}
                      className="flex-1 py-2.5 rounded-xl bg-amber-700 hover:bg-amber-600 disabled:bg-slate-800 disabled:text-slate-600 text-xs font-extrabold text-white flex items-center justify-center gap-1.5"
                    >
                      <RotateCcw className="w-4 h-4" />
                      1ターン前へ戻す
                    </button>
                  </div>
                </section>
              </div>

              {/* 右カラム: ライブ履歴 & セーブ＆ロード */}
              <div className="space-y-6">
                <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3">
                  <h2 className="text-base font-extrabold flex items-center gap-2 text-white">
                    <ScrollText className="w-5 h-5 text-indigo-400" />
                    ライブイベント履歴
                  </h2>
                  <div className="space-y-1.5 max-h-[210px] overflow-y-auto text-xs">
                    {(gameState?.eventLogs?.length ?? 0) === 0 ? (
                      <div className="text-slate-500 text-center py-6">まだ履歴はありません</div>
                    ) : (
                      gameState?.eventLogs.map((log, i) => (
                        <div
                          key={i}
                          className={`p-2 rounded-lg border ${
                            i === 0
                              ? 'bg-indigo-950/60 border-indigo-500/50 text-white font-bold'
                              : 'bg-slate-950/60 border-slate-800/80 text-slate-300'
                          }`}
                        >
                          {log}
                        </div>
                      ))
                    )}
                  </div>
                </section>

                <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
                  <h2 className="text-base font-extrabold flex items-center gap-2 text-white">
                    <Save className="w-5 h-5 text-amber-400" />
                    セーブ ＆ ロード
                  </h2>

                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={saveLabel}
                      onChange={(e) => setSaveLabel(e.target.value)}
                      placeholder="セーブ名（例: 2年目夏）"
                      className="flex-1 px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-amber-500"
                    />
                    <button
                      onClick={() => {
                        onSaveNamed(saveLabel || `手動セーブ`);
                        setSaveLabel('');
                      }}
                      className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-xs font-extrabold text-white"
                    >
                      保存
                    </button>
                  </div>

                  <div className="space-y-2 max-h-[240px] overflow-y-auto">
                    {savesList.length === 0 ? (
                      <div className="text-center text-slate-500 py-6 text-xs">
                        セーブデータはまだありません。
                      </div>
                    ) : (
                      savesList.map((s) => (
                        <div
                          key={s.fileName}
                          className="flex items-center justify-between p-2.5 rounded-xl bg-slate-950/80 border border-slate-800"
                        >
                          <div>
                            <div className="text-xs font-bold text-white">{s.label}</div>
                            <div className="text-[11px] text-slate-400">
                              {s.year}年目 {s.month}月 ・{' '}
                              {new Date(s.savedAt).toLocaleString('ja-JP')}
                            </div>
                          </div>
                          <button
                            onClick={() => onLoadSave(s.fileName)}
                            className="px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-xs font-bold text-white"
                          >
                            復元
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </section>
              </div>
            </div>
          </div>
        )}

        {/* ========== タブ2: 【最優先】全ルール＆完全図鑑 ========== */}
        {activeTab === 'rules' && (
          <div className="space-y-6">
            {/* 有効なカスタムローカルルール（登録がある場合） */}
            {(gameState?.localRules?.filter((r) => r.enabled).length ?? 0) > 0 && (
              <section className="bg-emerald-950/40 border-2 border-emerald-500/60 rounded-2xl p-5 space-y-2.5">
                <h2 className="text-lg font-black text-emerald-300">
                  ⚖️ 現在適用中のローカルルール
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {gameState?.localRules
                    .filter((r) => r.enabled)
                    .map((r) => (
                      <div
                        key={r.id}
                        className="p-3 rounded-xl bg-slate-950/80 border border-emerald-700/50 text-xs"
                      >
                        <div className="font-extrabold text-emerald-200">⚖️ {r.name}</div>
                        <div className="text-slate-300 mt-1">{r.message}</div>
                      </div>
                    ))}
                </div>
              </section>
            )}

            {/* 基本ルール & 操作 */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <section className="bg-slate-900 border border-amber-500/40 rounded-2xl p-5 space-y-3">
                <h2 className="text-lg font-black text-amber-300">
                  🏆 1. ゲームの目的・基本進行
                </h2>
                <ul className="text-sm text-slate-200 space-y-2 list-disc list-inside leading-relaxed">
                  <li>
                    <strong className="text-white">勝利条件:</strong> 設定年数（例: 3年）終了時点で、
                    <span className="text-emerald-400 font-bold">「総資産（所持金＋所有物件の評価額）」</span>
                    が最も多い社長の優勝！
                  </li>
                  <li>
                    <strong className="text-white">1年の流れ:</strong> 4月スタート → 全員が1回ずつ行動すると1ヶ月進行 →
                    <span className="text-amber-300 font-bold">3月終了時に「年度末決算」</span>
                    が行われ、所有している全物件の年間収益が一括で振り込まれます。
                  </li>
                  <li>
                    <strong className="text-white">目的地到着ボーナス:</strong> 🚩目的地に
                    <span className="text-amber-300 font-bold">ちょうどぴったり</span>止まった社長は、
                    <span className="text-amber-300 font-bold">援助金（1億円＋年数×3,000万円・連続到着で最大2倍）</span>
                    を獲得！（通過では到達になりません）
                  </li>
                  <li>
                    <strong className="text-white">移動とやり直し:</strong> サイコロやカードで出た歩数だけ、
                    <span className="text-sky-300 font-bold">水色に光る隣接マスを直接タップ</span>して進みます。
                    <span className="text-amber-300 font-bold">ゴールドの矢印</span>は目的地への最短方向です。
                    <span className="text-orange-300 font-bold">オレンジの「↩戻る」マス</span>をタップすると1歩戻って残り歩数が＋1回復します。
                  </li>
                </ul>
              </section>

              <section className="bg-slate-900 border border-sky-500/40 rounded-2xl p-5 space-y-3">
                <h2 className="text-lg font-black text-sky-300">
                  🗺️ 2. 全7種類のマス＆物件・増資・独占ルール
                </h2>
                <div className="space-y-2 text-sm text-slate-200">
                  <div className="p-2 rounded-xl bg-slate-950/70 border border-slate-800">
                    <span className="font-bold text-sky-400">🏢 都市駅（全国100都市・351物件）:</span>{' '}
                    ご当地物件を購入・増資できます。マップ上で都市駅をタップすると物件一覧を確認できます。
                  </div>
                  <div className="p-2 rounded-xl bg-slate-950/70 border border-slate-800">
                    <span className="font-bold text-blue-400">🔵 プラス駅（＋）:</span>{' '}
                    金額ルーレットで所持金アップ！（年数が進むほど金額上昇）
                  </div>
                  <div className="p-2 rounded-xl bg-slate-950/70 border border-slate-800">
                    <span className="font-bold text-rose-400">🔴 マイナス駅（－）:</span>{' '}
                    金額ルーレットで所持金ダウン…
                  </div>
                  <div className="p-2 rounded-xl bg-slate-950/70 border border-slate-800">
                    <span className="font-bold text-amber-400">🟡 カード駅（★） / ✨ ナイスカード駅:</span>{' '}
                    カードを入手（最大8枚）。緑の✨駅はレア・強力カード確定！
                  </div>
                  <div className="p-2 rounded-xl bg-slate-950/70 border border-slate-800">
                    <span className="font-bold text-orange-400">🛒 カード売り場:</span>{' '}
                    現金で急行・新幹線・バリア・攻撃カード等を自由に購入できます。
                  </div>
                  <div className="p-2 rounded-xl bg-slate-950/70 border border-slate-800">
                    <span className="font-bold text-purple-400">🟣 ワープ駅（🌀）:</span>{' '}
                    止まると全国のどこかの都市駅へ瞬間ワープ！
                  </div>
                  <div className="p-2.5 rounded-xl bg-emerald-950/40 border border-emerald-700/50 text-xs leading-relaxed">
                    <strong className="text-emerald-300">増資＆独占＆借金売却（本家準拠）:</strong>{' '}
                    自分の物件駅に再び止まると物件価格と同額（100%）で増資可能（最大Lv.3：増資ごとに収益率+5%＆評価額アップ）。
                    駅の全物件を買い占めると<strong>👑独占</strong>となり、
                    <strong>年度末決算の収益が2倍</strong>＆特定の10都市では<strong>ご当地歴史ヒーロー</strong>が味方になります！
                    借金になった場合は、売却する物件を自分で選んで評価額の半額で返済します。
                    また夏（6〜8月）はプラス駅1.5倍・冬（12〜2月）はマイナス駅1.8倍になります。
                  </div>
                </div>
              </section>
            </div>

            {/* ご当地歴史ヒーロー一覧 */}
            <section className="bg-slate-900 border border-yellow-500/40 rounded-2xl p-5 space-y-3">
              <h2 className="text-lg font-black text-yellow-300">
                ⚔️ ご当地歴史ヒーロー（全10都市・独占で味方に！）
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
                {stations
                  .filter((s) => s.hero)
                  .map((s) => (
                    <div
                      key={s.id}
                      className="p-3 rounded-xl bg-slate-950/80 border border-yellow-700/40"
                    >
                      <div className="text-xs font-extrabold text-yellow-300">
                        {s.hero!.icon} {s.hero!.name}（{s.name}）
                      </div>
                      <div className="text-[11px] text-slate-300 mt-1 leading-snug">
                        {s.hero!.description}
                      </div>
                    </div>
                  ))}
              </div>
            </section>

            {/* ケチケチ大王（貧乏神）ルール */}
            <section className="bg-slate-900 border border-purple-500/40 rounded-2xl p-5 space-y-3">
              <h2 className="text-lg font-black text-purple-300">
                👹 3. お邪魔キャラ「{eventsData?.nuisanceCharacter.name ?? 'ケチケチ大王'}」のルール＆全12種の悪行
              </h2>
              <p className="text-sm text-slate-300 leading-relaxed">
                誰かが目的地に到着した瞬間、<strong>次の目的地から一番遠くにいる社長</strong>に憑依します。
                憑依された社長が<strong>他の社長と同じマスを通過・到着すると「なすりつけ」</strong>ができます！
                毎ターン終了時に以下の悪行のいずれかが発動します（※<strong>🛡️バリアカード</strong>を持っていれば1回自動で防御）。
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                {eventsData?.nuisanceCharacter.actions.map((act) => (
                  <div
                    key={act.id}
                    className="p-3 rounded-xl bg-purple-950/30 border border-purple-800/50"
                  >
                    <div className="text-xs font-extrabold text-purple-200">{act.title}</div>
                    <div className="text-[11px] text-slate-300 mt-1">{act.description}</div>
                  </div>
                ))}
              </div>
            </section>

            {/* 全カード図鑑 */}
            <section className="bg-slate-900 border border-amber-500/40 rounded-2xl p-5 space-y-3">
              <h2 className="text-lg font-black text-amber-300">
                🃏 4. 全カード図鑑（全{cardsMaster.length}種類）
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                {cardsMaster.map((c) => (
                  <div
                    key={c.id}
                    className="p-3 rounded-xl bg-slate-950/80 border border-slate-800 flex items-start gap-2.5"
                  >
                    <span className="text-2xl shrink-0">{c.icon}</span>
                    <div>
                      <div className="text-xs font-extrabold text-white flex items-center gap-1.5">
                        {c.name}
                        <span className="px-1.5 py-0.5 rounded bg-slate-800 text-[10px] text-slate-400">
                          {c.category}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5 leading-snug">
                        {c.description}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* 季節イベント & 平時突発イベント */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <section className="bg-slate-900 border border-emerald-500/40 rounded-2xl p-5 space-y-3">
                <h2 className="text-base font-black text-emerald-300">
                  🌸 5. 季節イベント（月替わり45%で発生・全12ヶ月）
                </h2>
                <div className="space-y-1.5 text-xs">
                  {(
                    (eventsData as unknown as {
                      seasonalEvents?: {
                        id: string;
                        months: number[];
                        title: string;
                        description: string;
                      }[];
                    })?.seasonalEvents ?? []
                  ).map((ev) => (
                    <div
                      key={ev.id}
                      className="p-2.5 rounded-xl bg-slate-950/70 border border-slate-800 flex items-start justify-between gap-2"
                    >
                      <div>
                        <div className="font-bold text-white">{ev.title}</div>
                        <div className="text-slate-400 mt-0.5">{ev.description}</div>
                      </div>
                      <span className="shrink-0 px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 font-bold">
                        {ev.months.map((m) => `${m}月`).join('・')}
                      </span>
                    </div>
                  ))}
                </div>
              </section>

              <section className="bg-slate-900 border border-sky-500/40 rounded-2xl p-5 space-y-3">
                <h2 className="text-base font-black text-sky-300">
                  ✨ 6. 平時の突発ランダムイベント（毎ターン16%で発生）
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                  {(
                    (eventsData as unknown as {
                      randomEvents?: { id: string; title: string; icon: string }[];
                    })?.randomEvents ?? []
                  ).map((ev) => (
                    <div
                      key={ev.id}
                      className="p-2.5 rounded-xl bg-slate-950/70 border border-slate-800 font-bold text-slate-200"
                    >
                      {ev.title}
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </div>
        )}

        {/* ========== タブ2.5: ローカルルール設定 ========== */}
        {activeTab === 'local_rules' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* 新規ローカルルール作成フォーム */}
            <section className="bg-slate-900 border border-emerald-500/40 rounded-2xl p-5 space-y-4">
              <h2 className="text-lg font-black text-emerald-300">
                ⚖️ カスタムローカルルールを作成
              </h2>

              {/* ワンクリックプリセット */}
              <div className="space-y-1.5">
                <div className="text-xs text-slate-400 font-bold">
                  ワンクリックで定番ローカルルールを追加：
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    onClick={() =>
                      onAddLocalRule({
                        name: '借金救済給付金',
                        enabled: true,
                        trigger: 'on_debt',
                        probability: 100,
                        target: 'actor',
                        effect: 'cash_delta',
                        effectAmount: 2000,
                        message: '{player}に国から借金救済給付金＋2,000万円が支給された！',
                      })
                    }
                    className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-600 text-[11px] font-bold text-emerald-300"
                  >
                    ＋ 借金救済(+2000万)
                  </button>
                  <button
                    onClick={() =>
                      onAddLocalRule({
                        name: 'ゾロ目大当たり！',
                        enabled: true,
                        trigger: 'on_dice_roll',
                        triggerValue: 0,
                        probability: 100,
                        target: 'actor',
                        effect: 'cash_delta',
                        effectAmount: 3000,
                        message: '🎲 ゾロ目が出た！{player}にラッキーボーナス＋3,000万円！',
                      })
                    }
                    className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-600 text-[11px] font-bold text-amber-300"
                  >
                    ＋ ゾロ目ボーナス
                  </button>
                  <button
                    onClick={() =>
                      onAddLocalRule({
                        name: '最下位へ毎月お助けカード',
                        enabled: true,
                        trigger: 'month_change',
                        triggerValue: 0,
                        probability: 100,
                        target: 'last',
                        effect: 'give_card',
                        effectCardId: 'express_3',
                        message: '🎁 逆転チャンス！最下位の{player}へ特急カードを支給！',
                      })
                    }
                    className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-600 text-[11px] font-bold text-sky-300"
                  >
                    ＋ 毎月最下位に特急
                  </button>
                  <button
                    onClick={() =>
                      onAddLocalRule({
                        name: '1が出たらリアクション罰ゲーム！',
                        enabled: true,
                        trigger: 'on_dice_roll',
                        triggerValue: 1,
                        probability: 100,
                        target: 'actor',
                        effect: 'message_only',
                        message: '😱 出目が1！{player}はみんなの前で一発芸（またはモノマネ）を披露！',
                      })
                    }
                    className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-600 text-[11px] font-bold text-rose-300"
                  >
                    ＋ 出目1で罰ゲーム演出
                  </button>
                  <button
                    onClick={() =>
                      onAddLocalRule({
                        name: '東京駅凱旋ボーナス',
                        enabled: true,
                        trigger: 'on_specific_station',
                        targetStationId: 'tokyo',
                        probability: 100,
                        target: 'actor',
                        effect: 'cash_delta',
                        effectAmount: 3000,
                        message: '🗼 東京駅に凱旋！{player}へ特別報奨金 +3,000万円！',
                      })
                    }
                    className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-600 text-[11px] font-bold text-sky-300"
                  >
                    ＋ 東京駅に止まると+3,000万
                  </button>
                </div>
              </div>

              <div className="space-y-3 pt-2 border-t border-slate-800 text-xs">
                <div>
                  <label className="block text-slate-400 mb-1">ルール名</label>
                  <input
                    type="text"
                    value={lrName}
                    onChange={(e) => setLrName(e.target.value)}
                    placeholder="例: 夏のボーナス大放出"
                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-slate-400 mb-1">発動タイミング</label>
                    <select
                      value={lrTrigger}
                      onChange={(e) => setLrTrigger(e.target.value as LocalRuleTrigger)}
                      className="w-full px-2.5 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white"
                    >
                      <option value="on_dice_roll">サイコロを振った時</option>
                      <option value="on_specific_station">特定の駅（マス）に止まった時</option>
                      <option value="on_station_type">特定種類のマスに止まった時</option>
                      <option value="month_change">月が変わった時</option>
                      <option value="every_turn_end">毎ターン終了時</option>
                      <option value="on_destination">目的地に到着した時</option>
                      <option value="on_plus_station">プラス駅に止まった時</option>
                      <option value="on_minus_station">マイナス駅に止まった時</option>
                      <option value="on_debt">借金状態でターン終了時</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1">発動確率 (%)</label>
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={lrProb}
                      onChange={(e) => setLrProb(Number(e.target.value))}
                      className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white"
                    />
                  </div>
                </div>

                {(lrTrigger === 'on_dice_roll' || lrTrigger === 'month_change') && (
                  <div>
                    <label className="block text-slate-400 mb-1">
                      {lrTrigger === 'on_dice_roll'
                        ? '条件の出目（0＝ゾロ目、1〜6＝その目が出た時）'
                        : '対象月（0＝毎月、1〜12＝その月のみ）'}
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={36}
                      value={lrTriggerVal}
                      onChange={(e) => setLrTriggerVal(Number(e.target.value))}
                      className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white"
                    />
                  </div>
                )}

                {lrTrigger === 'on_specific_station' && (
                  <div>
                    <label className="block text-slate-400 mb-1">対象の駅（マス）</label>
                    <select
                      value={lrStationId}
                      onChange={(e) => setLrStationId(e.target.value)}
                      className="w-full px-2.5 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white"
                    >
                      {stations
                        .filter((s) => s.type === 'property' || s.type === 'shop' || s.type === 'warp')
                        .map((s) => (
                          <option key={s.id} value={s.id}>
                            [{s.region}] {s.name}（{s.type === 'property' ? '都市駅' : s.type === 'shop' ? 'カード売り場' : 'ワープ駅'}）
                          </option>
                        ))}
                    </select>
                  </div>
                )}

                {lrTrigger === 'on_station_type' && (
                  <div>
                    <label className="block text-slate-400 mb-1">対象のマス種別</label>
                    <select
                      value={lrStationType}
                      onChange={(e) => setLrStationType(e.target.value as StationType)}
                      className="w-full px-2.5 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white"
                    >
                      <option value="property">🏢 物件駅（都市駅）</option>
                      <option value="plus">🔵 プラス駅</option>
                      <option value="minus">🔴 マイナス駅</option>
                      <option value="card">🟡 カード駅</option>
                      <option value="nice_card">✨ ナイスカード駅</option>
                      <option value="shop">🛒 カード売り場</option>
                      <option value="warp">🟣 ワープ駅</option>
                    </select>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-slate-400 mb-1">対象プレイヤー</label>
                    <select
                      value={lrTarget}
                      onChange={(e) => setLrTarget(e.target.value as LocalRuleTarget)}
                      className="w-full px-2.5 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white"
                    >
                      <option value="actor">行動した社長</option>
                      <option value="all">全社長</option>
                      <option value="top">現在1位の社長</option>
                      <option value="last">現在最下位の社長</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1">効果内容</label>
                    <select
                      value={lrEffect}
                      onChange={(e) => setLrEffect(e.target.value as LocalRuleEffect)}
                      className="w-full px-2.5 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white"
                    >
                      <option value="cash_delta">資金を増減する</option>
                      <option value="give_card">カードを支給する</option>
                      <option value="discard_card">カードを1枚没収</option>
                      <option value="warp_random">ランダム駅へワープ</option>
                      <option value="attach_nuisance">ケチケチ大王を憑依</option>
                      <option value="clear_nuisance">ケチケチ大王を解除</option>
                      <option value="message_only">メッセージ演出のみ（身内罰ゲーム等）</option>
                    </select>
                  </div>
                </div>

                {lrEffect === 'cash_delta' && (
                  <div>
                    <label className="block text-slate-400 mb-1">増減金額（万円・マイナス可）</label>
                    <input
                      type="number"
                      step={500}
                      value={lrAmount}
                      onChange={(e) => setLrAmount(Number(e.target.value))}
                      className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white"
                    />
                  </div>
                )}

                {lrEffect === 'give_card' && (
                  <div>
                    <label className="block text-slate-400 mb-1">支給するカード</label>
                    <select
                      value={lrCardId}
                      onChange={(e) => setLrCardId(e.target.value)}
                      className="w-full px-2.5 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white"
                    >
                      <option value="">ランダム（全カードから抽選）</option>
                      {cardsMaster.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.icon} {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div>
                  <label className="block text-slate-400 mb-1">
                    発動メッセージ（{'{player}'} を入れると社長名に自動変換されます）
                  </label>
                  <input
                    type="text"
                    value={lrMessage}
                    onChange={(e) => setLrMessage(e.target.value)}
                    placeholder="例: {player}にスペシャルボーナスが発動！"
                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white"
                  />
                </div>

                <button
                  onClick={() => {
                    onAddLocalRule({
                      name: lrName.trim() || 'カスタムルール',
                      enabled: true,
                      trigger: lrTrigger,
                      triggerValue: lrTriggerVal,
                      targetStationId: lrTrigger === 'on_specific_station' ? lrStationId : undefined,
                      targetStationType: lrTrigger === 'on_station_type' ? lrStationType : undefined,
                      probability: lrProb,
                      target: lrTarget,
                      effect: lrEffect,
                      effectAmount: lrAmount,
                      effectCardId: lrCardId || undefined,
                      message: lrMessage.trim() || '{player}にローカルルールが発動！',
                    });
                    setLrName('');
                    setLrMessage('');
                  }}
                  className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-sm shadow-lg"
                >
                  ＋ このローカルルールを追加
                </button>
              </div>
            </section>

            {/* 登録済みローカルルール一覧 */}
            <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3">
              <h2 className="text-lg font-black text-white">
                登録済みローカルルール ({gameState?.localRules?.length ?? 0}件)
              </h2>
              <div className="space-y-2.5 max-h-[540px] overflow-y-auto">
                {(gameState?.localRules?.length ?? 0) === 0 ? (
                  <div className="text-center text-slate-500 py-12 text-xs">
                    まだローカルルールは登録されていません。
                    <br />
                    左側のプリセットやフォームから自由に追加できます！
                  </div>
                ) : (
                  gameState?.localRules.map((r) => (
                    <div
                      key={r.id}
                      className={`p-3.5 rounded-xl border space-y-1.5 ${
                        r.enabled
                          ? 'bg-emerald-950/30 border-emerald-600/50'
                          : 'bg-slate-950/60 border-slate-800 opacity-60'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-sm font-extrabold text-white">
                          ⚖️ {r.name}
                        </div>
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => onToggleLocalRule(r.id)}
                            className={`px-2.5 py-1 rounded-lg text-[11px] font-bold ${
                              r.enabled
                                ? 'bg-emerald-600 text-white'
                                : 'bg-slate-700 text-slate-300'
                            }`}
                          >
                            {r.enabled ? 'ON' : 'OFF'}
                          </button>
                          <button
                            onClick={() => onDeleteLocalRule(r.id)}
                            className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-rose-900/80 text-rose-200 hover:bg-rose-700"
                          >
                            削除
                          </button>
                        </div>
                      </div>
                      <div className="text-[11px] text-slate-400">
                        条件: {r.trigger}
                        {r.targetStationId
                          ? `（${stationMap.get(r.targetStationId)?.name ?? r.targetStationId}）`
                          : ''}
                        {r.targetStationType ? `（${r.targetStationType}）` : ''} / 確率:{' '}
                        {r.probability}% / 対象: {r.target} / 効果: {r.effect}
                        {r.effect === 'cash_delta' ? ` (${r.effectAmount}万円)` : ''}
                      </div>
                      <div className="text-xs text-slate-200 bg-black/30 px-2.5 py-1.5 rounded-lg">
                        「{r.message}」
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>
        )}

        {/* ========== タブ3: 神の手（マスター介入） ========== */}
        {activeTab === 'god' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <section className="bg-slate-900 border border-purple-500/40 rounded-2xl p-5 space-y-5">
              <h2 className="text-lg font-black text-purple-300 flex items-center gap-2">
                <Sparkles className="w-5 h-5" />
                プレイヤー個別介入（資金・カード・ケチケチ大王）
              </h2>

              <div>
                <label className="block text-xs text-slate-400 mb-1.5">対象プレイヤー</label>
                <select
                  value={targetPlayerId}
                  onChange={(e) => setTargetPlayerId(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-sm text-white font-bold"
                >
                  {gameState?.players.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.avatar} {p.name}（現金 {formatMoney(p.money)} / カード {p.cardCount}枚）
                    </option>
                  ))}
                </select>
              </div>

              {/* 資金調整 */}
              <div className="space-y-2">
                <div className="text-xs font-bold text-slate-300">💰 資金の増減</div>
                <div className="grid grid-cols-4 gap-2">
                  {[1000, 5000, -1000, -5000].map((delta) => (
                    <button
                      key={delta}
                      disabled={!targetPlayerId}
                      onClick={() => onAdjustMoney(targetPlayerId, delta)}
                      className={`py-2 rounded-xl text-xs font-extrabold border ${
                        delta > 0
                          ? 'bg-emerald-900/60 hover:bg-emerald-700 border-emerald-500/60 text-emerald-200'
                          : 'bg-rose-900/60 hover:bg-rose-700 border-rose-500/60 text-rose-200'
                      }`}
                    >
                      {delta > 0 ? `+${delta}万` : `${delta}万`}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    type="number"
                    step={1000}
                    value={customMoneyDelta}
                    onChange={(e) => setCustomMoneyDelta(Number(e.target.value))}
                    placeholder="任意金額(万円)"
                    className="flex-1 px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white"
                  />
                  <button
                    disabled={!targetPlayerId || !customMoneyDelta}
                    onClick={() => onAdjustMoney(targetPlayerId, customMoneyDelta)}
                    className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs font-extrabold text-white"
                  >
                    任意額を反映
                  </button>
                </div>
              </div>

              {/* カード支給・全員配布・手札没収 */}
              <div className="space-y-2">
                <div className="text-xs font-bold text-slate-300">🃏 カード配布＆手札管理</div>
                <div className="flex gap-2">
                  <select
                    value={selectedCardId}
                    onChange={(e) => setSelectedCardId(e.target.value)}
                    className="flex-1 px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white"
                  >
                    {cardsMaster.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.icon} {c.name}
                      </option>
                    ))}
                  </select>
                  <button
                    disabled={!targetPlayerId}
                    onClick={() => onGiveCard(targetPlayerId, selectedCardId)}
                    className="px-3.5 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-xs font-extrabold text-white"
                  >
                    個別支給
                  </button>
                  <button
                    onClick={() => onGiveCardAll(selectedCardId)}
                    className="px-3.5 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-xs font-extrabold text-white"
                  >
                    全員配布
                  </button>
                </div>
                {targetPlayerId && (adminPlayersCards[targetPlayerId]?.length ?? 0) > 0 && (
                  <div className="p-2.5 rounded-xl bg-slate-950/80 border border-slate-800 space-y-1.5">
                    <div className="text-[11px] text-slate-400 font-bold">
                      選択社長の手持ちカード（タップで没収）:
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {adminPlayersCards[targetPlayerId].map((cid, idx) => {
                        const c = cardsMaster.find((x) => x.id === cid);
                        return (
                          <button
                            key={`${cid}_${idx}`}
                            onClick={() => onRemoveCard(targetPlayerId, idx)}
                            title="クリックで没収"
                            className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-rose-900 border border-slate-700 hover:border-rose-500 text-[11px] text-slate-200 font-bold flex items-center gap-1"
                          >
                            <span>{c?.icon ?? '🃏'}</span>
                            <span>{c?.name ?? cid}</span>
                            <span className="text-rose-400 ml-0.5">✕</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* 強制ワープ */}
              <div className="space-y-2 pt-3 border-t border-slate-800">
                <div className="text-xs font-bold text-slate-300">🚀 選択社長を任意の駅へ強制移動</div>
                <div className="flex gap-2">
                  <select
                    value={warpStationId}
                    onChange={(e) => setWarpStationId(e.target.value)}
                    className="flex-1 px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white"
                  >
                    {stations
                      .filter((s) => s.type === 'property' || s.type === 'shop' || s.type === 'warp')
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          [{s.region}] {s.name}
                        </option>
                      ))}
                  </select>
                  <button
                    disabled={!targetPlayerId}
                    onClick={() => onWarpPlayer(targetPlayerId, warpStationId)}
                    className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-extrabold text-white"
                  >
                    強制ワープ
                  </button>
                </div>
              </div>

              {/* ケチケチ大王・目的地操作 */}
              <div className="pt-3 border-t border-slate-800 space-y-2">
                <div className="text-xs font-bold text-slate-300">👹 ケチケチ大王・🚩 目的地コントロール</div>
                <div className="flex flex-wrap gap-2">
                  <button
                    disabled={!targetPlayerId}
                    onClick={() => onSetNuisance(targetPlayerId)}
                    className="px-3.5 py-2 rounded-xl bg-purple-700 hover:bg-purple-600 text-xs font-extrabold text-white"
                  >
                    👹 選択社長へ移動
                  </button>
                  <button
                    onClick={() => onSetNuisance(null)}
                    className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-600 text-xs font-bold text-slate-200"
                  >
                    ケチケチ大王を解除
                  </button>
                  <button
                    onClick={() => onChangeDest()}
                    className="px-3.5 py-2 rounded-xl bg-amber-700 hover:bg-amber-600 text-xs font-extrabold text-white flex items-center gap-1"
                  >
                    <Flag className="w-3.5 h-3.5" />
                    目的地をランダム変更
                  </button>
                </div>
                <div className="flex gap-2">
                  <select
                    value={destSelectStationId}
                    onChange={(e) => setDestSelectStationId(e.target.value)}
                    className="flex-1 px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white"
                  >
                    {stations
                      .filter((s) => s.type === 'property')
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          [{s.region}] {s.name}駅
                        </option>
                      ))}
                  </select>
                  <button
                    onClick={() => onChangeDest(destSelectStationId)}
                    className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-xs font-extrabold text-white"
                  >
                    この駅を目的地に
                  </button>
                </div>
              </div>

              {/* 運営メッセージ送信 */}
              <div className="pt-3 border-t border-slate-800 space-y-2">
                <div className="text-xs font-bold text-amber-300">📢 プレイヤーへメッセージ送信（カットイン表示）</div>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    value={broadcastTitle}
                    onChange={(e) => setBroadcastTitle(e.target.value)}
                    placeholder="タイトル（例: 緊急イベント！）"
                    className="px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white"
                  />
                  <select
                    value={broadcastTargetId}
                    onChange={(e) => setBroadcastTargetId(e.target.value)}
                    className="px-2.5 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white"
                  >
                    <option value="">全社長へ送信</option>
                    {gameState?.players.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} 宛て
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={broadcastMsg}
                    onChange={(e) => setBroadcastMsg(e.target.value)}
                    placeholder="全員の画面に表示するメッセージを入力…"
                    className="flex-1 px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white"
                  />
                  <button
                    disabled={!broadcastMsg.trim()}
                    onClick={() => {
                      onBroadcastMessage(
                        broadcastTitle,
                        broadcastMsg,
                        broadcastTargetId || undefined
                      );
                      setBroadcastMsg('');
                    }}
                    className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:bg-slate-800 disabled:text-slate-600 text-xs font-extrabold text-white"
                  >
                    送信
                  </button>
                </div>
              </div>
            </section>

            {/* ライブ履歴（大画面版） */}
            <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3">
              <h2 className="text-lg font-black text-white flex items-center gap-2">
                <ScrollText className="w-5 h-5 text-indigo-400" />
                ライブイベント履歴（直近30件）
              </h2>
              <div className="space-y-2 max-h-[460px] overflow-y-auto text-xs">
                {(gameState?.eventLogs?.length ?? 0) === 0 ? (
                  <div className="text-slate-500 text-center py-10">まだ履歴はありません</div>
                ) : (
                  gameState?.eventLogs.map((log, i) => (
                    <div
                      key={i}
                      className={`p-2.5 rounded-xl border ${
                        i === 0
                          ? 'bg-indigo-950/60 border-indigo-500/50 text-white font-bold'
                          : 'bg-slate-950/70 border-slate-800 text-slate-300'
                      }`}
                    >
                      {log}
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
};
