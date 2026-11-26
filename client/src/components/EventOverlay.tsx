import React, { useEffect, useState } from 'react';
import { Trophy } from 'lucide-react';
import type { CommentBroadcast, GameEventSeqItem, PlayerPublicState } from '../types';
import { soundManager } from '../utils/sound';
import { formatMoney } from './StatusBar';

interface EventOverlayProps {
  eventQueue: GameEventSeqItem[];
  players: PlayerPublicState[];
  comments: CommentBroadcast[];
  lowDataMode: boolean;
  currentTurnPlayerId?: string;
  turnCount?: number;
  currentYear?: number;
  currentMonth?: number;
  onConsumeEvent: () => void;
}

const AssetHistoryChart: React.FC<{
  history: { year: number; assets: Record<string, number> }[];
  players: { id: string; name: string; color: string }[];
}> = ({ history, players }) => {
  if (!history || history.length < 2 || players.length === 0) return null;
  const w = 320;
  const h = 110;
  const padX = 18;
  const padY = 14;
  const allVals = history.flatMap((pt) => players.map((p) => pt.assets[p.id] ?? 0));
  const minV = Math.min(0, ...allVals);
  const maxV = Math.max(10000, ...allVals);
  const range = Math.max(1, maxV - minV);
  const toX = (idx: number) =>
    padX + (idx / Math.max(1, history.length - 1)) * (w - padX * 2);
  const toY = (v: number) => h - padY - ((v - minV) / range) * (h - padY * 2);
  const zeroY = toY(0);

  return (
    <div className="mb-3 p-2.5 rounded-2xl bg-slate-950/80 border border-slate-700/80">
      <div className="text-[10px] font-bold text-slate-400 mb-1 flex items-center justify-between">
        <span>📈 総資産推移グラフ</span>
        <span>0年目 → {history[history.length - 1].year}年目</span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-24 overflow-visible">
        <line
          x1={padX}
          y1={zeroY}
          x2={w - padX}
          y2={zeroY}
          stroke="rgba(148,163,184,0.35)"
          strokeDasharray="3 3"
          strokeWidth="1"
        />
        {players.map((p) => {
          const pts = history
            .map((pt, idx) => `${toX(idx).toFixed(1)},${toY(pt.assets[p.id] ?? 0).toFixed(1)}`)
            .join(' ');
          const lastVal = history[history.length - 1].assets[p.id] ?? 0;
          return (
            <g key={p.id}>
              <polyline
                fill="none"
                stroke={p.color}
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                points={pts}
              />
              <circle
                cx={toX(history.length - 1)}
                cy={toY(lastVal)}
                r="3.5"
                fill={p.color}
                stroke="#fff"
                strokeWidth="1"
              />
            </g>
          );
        })}
      </svg>
    </div>
  );
};

// 本物のサイコロの目（1は赤丸、2〜6は黒丸）を描画するコンポーネント
const DiceFace: React.FC<{ value: number; isRolling: boolean; index: number }> = ({
  value,
  isRolling,
  index,
}) => {
  // 3x3 グリッドのどの位置にドットを置くか (0..8)
  const dotPositions: Record<number, number[]> = {
    1: [4],
    2: [0, 8],
    3: [0, 4, 8],
    4: [0, 2, 6, 8],
    5: [0, 2, 4, 6, 8],
    6: [0, 2, 3, 5, 6, 8],
  };
  const activeDots = dotPositions[value] ?? [4];

  return (
    <div
      style={{
        animationDelay: `${index * 60}ms`,
      }}
      className={`w-20 h-20 rounded-2xl bg-gradient-to-br from-white via-slate-50 to-slate-200 border-2 border-slate-300 shadow-[0_8px_20px_rgba(0,0,0,0.45),inset_0_2px_4px_rgba(255,255,255,0.9)] p-2.5 grid grid-cols-3 grid-rows-3 place-items-center transition-transform duration-150 ${
        isRolling ? 'animate-bounce scale-105 rotate-6' : 'scale-110 rotate-0'
      }`}
    >
      {Array.from({ length: 9 }).map((_, cellIdx) => {
        const hasDot = activeDots.includes(cellIdx);
        if (!hasDot) return <div key={cellIdx} />;
        const isOne = value === 1;
        return (
          <div
            key={cellIdx}
            className={`rounded-full ${
              isOne
                ? 'w-6 h-6 bg-rose-600 shadow-inner'
                : 'w-3.5 h-3.5 bg-slate-900 shadow-inner'
            }`}
          />
        );
      })}
    </div>
  );
};

export const EventOverlay: React.FC<EventOverlayProps> = ({
  eventQueue,
  players,
  comments,
  lowDataMode,
  onConsumeEvent,
}) => {
  const currentEvent = eventQueue[0];

  // サイコロの回転ステート
  const [isRollingDice, setIsRollingDice] = useState(false);
  const [rollingValues, setRollingValues] = useState<number[]>([1]);

  // 赤・青マスの金額スロット回転ステート
  const [isSpinningMoney, setIsSpinningMoney] = useState(false);
  const [displayAmount, setDisplayAmount] = useState<number>(0);

  // 割合ケチケチのサイコロ＆収益率ルーレットステート
  const [curseStage, setCurseStage] = useState<'dice' | 'roulette' | 'result'>('dice');
  const [curseDice, setCurseDice] = useState<number[]>([1, 1]);
  const [curseSlotIndex, setCurseSlotIndex] = useState<number>(0);

  useEffect(() => {
    if (!currentEvent) return;

    if (currentEvent.type === 'turn_start') {
      soundManager.playTurnStart();
      const timer = window.setTimeout(onConsumeEvent, lowDataMode ? 1100 : 1950);
      return () => window.clearTimeout(timer);
    }

    if (currentEvent.type === 'warp_move') {
      soundManager.playPlus();
      const timer = window.setTimeout(onConsumeEvent, lowDataMode ? 750 : 1200);
      return () => window.clearTimeout(timer);
    }

    if (currentEvent.type === 'turn_fade') {
      const timer = window.setTimeout(onConsumeEvent, lowDataMode ? 850 : 1750);
      return () => window.clearTimeout(timer);
    }

    if (currentEvent.type === 'dice_roll') {
      const targetRolls = (currentEvent.payload.rolls as number[]) ?? [1];
      const isFixed = Boolean(currentEvent.payload.isFixed);

      if (isFixed || lowDataMode) {
        setIsRollingDice(false);
        setRollingValues(targetRolls);
        soundManager.playDiceResult();
        const timer = window.setTimeout(onConsumeEvent, 850);
        return () => window.clearTimeout(timer);
      }

      // コロコロ回転アニメーション開始
      setIsRollingDice(true);
      setRollingValues(targetRolls.map(() => Math.floor(Math.random() * 6) + 1));

      let tick = 0;
      const rollInterval = window.setInterval(() => {
        tick++;
        soundManager.playDiceTick(tick);
        setRollingValues(targetRolls.map(() => Math.floor(Math.random() * 6) + 1));
      }, 75);

      // 0.68秒後に確定出目を表示
      const revealTimer = window.setTimeout(() => {
        window.clearInterval(rollInterval);
        setIsRollingDice(false);
        setRollingValues(targetRolls);
        soundManager.playDiceResult();
      }, 680);

      // 合計1.45秒後にイベント消化
      const endTimer = window.setTimeout(() => {
        onConsumeEvent();
      }, 1450);

      return () => {
        window.clearInterval(rollInterval);
        window.clearTimeout(revealTimer);
        window.clearTimeout(endTimer);
      };
    }

    if (currentEvent.type === 'rate_curse_roulette') {
      const targetDice = (currentEvent.payload.dice as number[]) ?? [1, 1];
      const targetPercent = Number(currentEvent.payload.cursePercent ?? -50);
      const rateSlots = [-10, -50, -80, -100];
      const finalSlotIdx = Math.max(0, rateSlots.indexOf(targetPercent));

      if (lowDataMode) {
        setCurseDice(targetDice);
        setCurseSlotIndex(finalSlotIdx);
        setCurseStage('result');
        soundManager.playNuisance();
        const timer = window.setTimeout(onConsumeEvent, 1400);
        return () => window.clearTimeout(timer);
      }

      setCurseStage('dice');
      setCurseDice([1, 1]);
      let tick = 0;
      const diceInterval = window.setInterval(() => {
        tick++;
        soundManager.playDiceTick(tick);
        setCurseDice([
          Math.floor(Math.random() * 6) + 1,
          Math.floor(Math.random() * 6) + 1,
        ]);
      }, 75);

      let rouletteInterval: number | undefined;
      const toRouletteTimer = window.setTimeout(() => {
        window.clearInterval(diceInterval);
        setCurseDice(targetDice);
        setCurseStage('roulette');
        soundManager.playDiceResult();

        let rTick = 0;
        rouletteInterval = window.setInterval(() => {
          rTick++;
          soundManager.playDiceTick(rTick);
          setCurseSlotIndex(rTick % 4);
        }, 80);
      }, 700);

      const toResultTimer = window.setTimeout(() => {
        if (rouletteInterval !== undefined) window.clearInterval(rouletteInterval);
        setCurseSlotIndex(finalSlotIdx);
        setCurseStage('result');
        soundManager.playNuisance();
      }, 1550);

      const endTimer = window.setTimeout(onConsumeEvent, 2800);

      return () => {
        window.clearInterval(diceInterval);
        if (rouletteInterval !== undefined) window.clearInterval(rouletteInterval);
        window.clearTimeout(toRouletteTimer);
        window.clearTimeout(toResultTimer);
        window.clearTimeout(endTimer);
      };
    }

    if (
      currentEvent.type === 'station_effect' &&
      (currentEvent.payload.stationType === 'plus' ||
        currentEvent.payload.stationType === 'minus')
    ) {
      const targetAmt = Number(currentEvent.payload.amount ?? 0);
      const isPlus = currentEvent.payload.stationType === 'plus';

      if (lowDataMode) {
        setIsSpinningMoney(false);
        setDisplayAmount(targetAmt);
        if (isPlus) soundManager.playPlus();
        else soundManager.playMinus();
        const timer = window.setTimeout(onConsumeEvent, 850);
        return () => window.clearTimeout(timer);
      }

      setIsSpinningMoney(true);
      const candidates = [1000, 1500, 2000, 2500, 3000, 4000, 5000, 6000];
      let tick = 0;
      const spinInterval = window.setInterval(() => {
        tick++;
        soundManager.playDiceTick(tick);
        const pick = candidates[Math.floor(Math.random() * candidates.length)];
        setDisplayAmount(isPlus ? pick : -pick);
      }, 65);

      const revealTimer = window.setTimeout(() => {
        window.clearInterval(spinInterval);
        setIsSpinningMoney(false);
        setDisplayAmount(targetAmt);
        if (isPlus) soundManager.playPlus();
        else soundManager.playMinus();
      }, 650);

      const endTimer = window.setTimeout(() => {
        onConsumeEvent();
      }, 1500);

      return () => {
        window.clearInterval(spinInterval);
        window.clearTimeout(revealTimer);
        window.clearTimeout(endTimer);
      };
    }

    // その他のイベントのSE再生
    if (currentEvent.type === 'step_move') {
      soundManager.playStep();
    } else if (
      currentEvent.type === 'destination_reached' ||
      currentEvent.type === 'monopoly_achieved'
    ) {
      soundManager.playGoal();
    } else if (currentEvent.type === 'admin_message') {
      soundManager.playTurnStart();
    } else if (
      currentEvent.type === 'nuisance_action' ||
      currentEvent.type === 'nuisance_attach'
    ) {
      soundManager.playNuisance();
    } else if (currentEvent.type === 'random_event') {
      if (currentEvent.payload.isPositive === false) soundManager.playMinus();
      else soundManager.playGoal();
    } else if (
      currentEvent.type === 'station_effect' ||
      currentEvent.type === 'property_bought' ||
      currentEvent.type === 'shop_traded'
    ) {
      soundManager.playPlus();
    } else if (currentEvent.type === 'duel_result') {
      if (currentEvent.payload.winnerId) soundManager.playGoal();
      else soundManager.playDiceResult();
    }

    const duration =
      currentEvent.type === 'step_move'
        ? 240
        : currentEvent.type === 'year_settlement' || currentEvent.type === 'game_finished'
          ? 0 // 手動で閉じる
          : currentEvent.type === 'duel_result'
            ? lowDataMode
              ? 1800
              : 3400
          : currentEvent.type === 'shop_traded'
            ? lowDataMode
              ? 700
              : 1200
            : currentEvent.type === 'property_bought'
              ? lowDataMode
                ? 850
                : 1400
              : currentEvent.type === 'destination_reached' ||
                  currentEvent.type === 'monopoly_achieved' ||
                  currentEvent.type === 'admin_message' ||
                  currentEvent.type === 'nuisance_action' ||
                  currentEvent.type === 'nuisance_attach' ||
                  currentEvent.type === 'random_event'
                ? lowDataMode
                  ? 1100
                  : 2000
                : lowDataMode
                  ? 850
                  : 1450;

    if (duration > 0) {
      const timer = window.setTimeout(onConsumeEvent, duration);
      return () => window.clearTimeout(timer);
    }
  }, [currentEvent, lowDataMode, onConsumeEvent]);

  // コメント受信時の効果音
  useEffect(() => {
    if (comments.length > 0) {
      soundManager.playStamp();
    }
  }, [comments.length]);

  const actor = currentEvent
    ? players.find((p) => p.id === currentEvent.playerId)
    : undefined;

  const isSkippableCutIn =
    Boolean(currentEvent) &&
    currentEvent.type !== 'turn_start' &&
    currentEvent.type !== 'year_settlement' &&
    currentEvent.type !== 'game_finished' &&
    !(currentEvent.type === 'dice_roll' && isRollingDice) &&
    !(
      currentEvent.type === 'station_effect' &&
      (currentEvent.payload.stationType === 'plus' ||
        currentEvent.payload.stationType === 'minus') &&
      isSpinningMoney
    ) &&
    !(currentEvent.type === 'rate_curse_roulette' && curseStage !== 'result');

  const handleCutInTap = () => {
    if (isSkippableCutIn) {
      onConsumeEvent();
    }
  };

  return (
    <>
      {/* 画面右上のひとことコメント吹き出し */}
      <div className="fixed top-28 right-3 z-40 flex flex-col gap-1.5 max-w-[240px] pointer-events-none">
        {comments.map((c) => (
          <div
            key={c.id}
            className="animate-event-pop flex items-start gap-2 px-3 py-2 rounded-2xl bg-slate-900/95 border border-sky-500/50 shadow-xl"
          >
            <span className="text-lg shrink-0 mt-0.5">{c.playerAvatar}</span>
            <div className="text-xs min-w-0">
              <div className="font-bold truncate" style={{ color: c.playerColor }}>
                {c.playerName}
              </div>
              <div className="text-white font-bold break-words leading-snug">{c.text}</div>
            </div>
          </div>
        ))}
      </div>

      {/* ワープ先の確認バナー（マップを暗くせずカメラ移動を見せる） */}
      {currentEvent && currentEvent.type === 'warp_move' && (
        <div className="fixed top-24 left-1/2 -translate-x-1/2 z-50 pointer-events-none px-5 py-2.5 rounded-full bg-gradient-to-r from-indigo-900/95 via-purple-900/95 to-indigo-900/95 border-2 border-amber-300 shadow-[0_8px_30px_rgba(0,0,0,0.65)] text-center">
          <div className="text-sm font-black text-amber-300 whitespace-nowrap">
            🌀 {actor?.name ? `${actor.name}：` : ''}
            {String(currentEvent.payload.stationName ?? '')}へワープ！
          </div>
        </div>
      )}

      {/* ターン終了後の余韻＆暗転フェード */}
      {currentEvent && currentEvent.type === 'turn_fade' && (
        <div className="fixed inset-0 z-50 bg-black pointer-events-none animate-turn-blackout" />
      )}

      {/* イベントカットイン（確定後はタップで早送り可能） */}
      {currentEvent &&
        currentEvent.type !== 'step_move' &&
        currentEvent.type !== 'warp_move' &&
        currentEvent.type !== 'turn_fade' && (
        <div
          onClick={handleCutInTap}
          className={`fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/60 backdrop-blur-[3px] p-4 ${
            isSkippableCutIn ? 'cursor-pointer' : ''
          }`}
        >
          {currentEvent.type === 'turn_start' && (
            <div
              className="w-full max-w-sm rounded-3xl p-6 text-center shadow-[0_15px_50px_rgba(0,0,0,0.75)] border-4 border-amber-300"
              style={{
                background: `linear-gradient(155deg, ${String(currentEvent.payload.color ?? '#0284c7')}f2 0%, #1e1b4bf5 100%)`,
              }}
            >
              {Boolean(currentEvent.payload.isNewMonth) && (
                <div className="inline-block mb-2 px-3 py-0.5 rounded-full bg-amber-400 text-slate-950 text-xs font-black shadow">
                  📅 {String(currentEvent.payload.year)}年目 {String(currentEvent.payload.month)}月に突入！
                </div>
              )}
              <div className="text-xs font-extrabold text-amber-200 tracking-wider">
                {String(currentEvent.payload.year)}年目 {String(currentEvent.payload.month)}月
              </div>
              <div className="my-3 flex items-center justify-center">
                <div className="w-16 h-16 rounded-2xl bg-white/20 border-3 border-white flex items-center justify-center text-4xl shadow-lg animate-bounce">
                  {String(currentEvent.payload.avatar ?? '🚄')}
                </div>
              </div>
              <div className="text-2xl font-black text-white drop-shadow">
                {String(currentEvent.payload.playerName ?? actor?.name ?? '')}のターン！
              </div>
              <div className="mt-3 inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-black/40 border border-white/25 text-sm font-black text-amber-300">
                <span>🚩 目的地まで あと {String(currentEvent.payload.distanceToDest ?? 0)} マス</span>
              </div>
            </div>
          )}
          {currentEvent.type === 'dice_roll' && (
            <div className="bg-gradient-to-b from-slate-900 via-indigo-950 to-slate-900 border-4 border-amber-400 rounded-3xl px-8 py-7 text-center shadow-[0_0_50px_rgba(251,191,36,0.4)] max-w-sm w-full">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 text-sm text-amber-200 font-extrabold mb-3">
                <span>{actor?.avatar}</span>
                <span>{actor?.name}</span>
              </div>

              <div className="flex flex-wrap items-center justify-center gap-4 my-5 min-h-[96px]">
                {rollingValues.map((val, i) => (
                  <DiceFace key={i} value={val} isRolling={isRollingDice} index={i} />
                ))}
              </div>

              <div className="h-10 flex items-center justify-center">
                {!isRollingDice && (
                  <div className="text-3xl font-black text-amber-400 drop-shadow animate-bounce">
                    {String(currentEvent.payload.total)} マス！
                  </div>
                )}
              </div>
            </div>
          )}

          {currentEvent.type === 'station_effect' && (
            <div
              className={`animate-event-pop rounded-3xl px-8 py-7 text-center shadow-2xl max-w-xs w-full border-4 transition-transform ${
                currentEvent.payload.stationType === 'plus'
                  ? 'bg-gradient-to-b from-sky-900 via-blue-950 to-slate-950 border-sky-400 shadow-[0_0_45px_rgba(56,189,248,0.5)]'
                  : currentEvent.payload.stationType === 'minus'
                    ? 'animate-event-shake bg-gradient-to-b from-rose-950 via-red-950 to-slate-950 border-rose-500 shadow-[0_0_45px_rgba(244,63,94,0.5)]'
                    : 'bg-slate-900 border-amber-400'
              }`}
            >
              {Boolean(currentEvent.payload.seasonTag) && (
                <div className="inline-block mb-2 px-3 py-0.5 rounded-full bg-white/15 border border-white/25 text-[11px] font-extrabold text-amber-200">
                  {String(currentEvent.payload.seasonTag)}
                </div>
              )}
              {currentEvent.payload.stationType === 'plus' && (
                <>
                  <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-blue-600 border-4 border-white text-white font-black text-3xl shadow-lg mb-3">
                    ＋
                  </div>
                  <div
                    className={`py-3 px-4 rounded-2xl bg-black/45 border border-sky-400/50 font-black tabular-nums transition-transform ${
                      isSpinningMoney
                        ? 'text-2xl text-sky-200 scale-95'
                        : 'text-3xl text-yellow-300 scale-110 animate-bounce'
                    }`}
                  >
                    +{formatMoney(Math.abs(displayAmount))}
                  </div>
                </>
              )}
              {currentEvent.payload.stationType === 'minus' && (
                <>
                  <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-red-600 border-4 border-white text-white font-black text-3xl shadow-lg mb-3">
                    －
                  </div>
                  <div
                    className={`py-3 px-4 rounded-2xl bg-black/45 border border-rose-400/50 font-black tabular-nums transition-transform ${
                      isSpinningMoney
                        ? 'text-2xl text-rose-200 scale-95'
                        : 'text-3xl text-rose-400 scale-110 animate-bounce'
                    }`}
                  >
                    -{formatMoney(Math.abs(displayAmount))}
                  </div>
                </>
              )}
              {currentEvent.payload.stationType === 'card' && (
                <div>
                  <div className="text-5xl mb-2">
                    {String(currentEvent.payload.cardIcon ?? '🟡')}
                  </div>
                  <div className="text-lg font-black text-amber-300">
                    {currentEvent.payload.cardName
                      ? `「${String(currentEvent.payload.cardName)}」入手！`
                      : '手札がいっぱいです'}
                  </div>
                </div>
              )}
            </div>
          )}

          {currentEvent.type === 'destination_reached' && (
            <div className="animate-event-pop bg-gradient-to-b from-amber-500 via-amber-700 to-amber-900 border-4 border-yellow-200 rounded-3xl px-7 py-7 text-center shadow-[0_0_60px_rgba(250,204,21,0.6)] max-w-sm w-full">
              <div className="text-5xl mb-2 animate-bounce">🎊🏆🎊</div>
              {Number(currentEvent.payload.streak ?? 1) >= 2 && (
                <div className="inline-block mb-1.5 px-3 py-0.5 rounded-full bg-yellow-300 text-slate-950 text-xs font-black shadow">
                  🔥 {String(currentEvent.payload.streak)}回連続到着ボーナス！
                </div>
              )}
              <div className="text-2xl font-black text-white mt-1">
                {actor?.name} が目的地
                <br />「{String(currentEvent.payload.stationName)}」に到着！
              </div>
              <div className="mt-4 py-2 px-4 rounded-2xl bg-black/30 border border-yellow-300/50 text-2xl font-black text-yellow-200">
                援助金 +{formatMoney(Number(currentEvent.payload.bonus))}
              </div>
              {Boolean(currentEvent.payload.nextDestName) && (
                <div className="mt-3 py-1.5 px-3 rounded-xl bg-white/15 border border-yellow-200/40 text-xs font-extrabold text-white">
                  🚩 次の目的地は「<span className="text-yellow-300">{String(currentEvent.payload.nextDestName)}</span>」！
                </div>
              )}
            </div>
          )}

          {currentEvent.type === 'property_bought' && (
            <div className="animate-event-pop bg-gradient-to-b from-emerald-900 via-teal-950 to-slate-950 border-4 border-emerald-400 rounded-3xl px-6 py-6 text-center shadow-[0_0_50px_rgba(16,185,129,0.5)] max-w-sm w-full">
              <div className="text-4xl mb-2">🏢✨</div>
              <div className="text-base font-black text-emerald-300">
                {actor?.name} が {String(currentEvent.payload.stationName ?? '')}駅で物件購入！
              </div>
              <div className="mt-3 flex flex-wrap justify-center gap-1.5">
                {((currentEvent.payload.items as string[]) ?? []).map((name, i) => (
                  <span
                    key={i}
                    className="px-2.5 py-1 rounded-full bg-black/40 border border-emerald-400/50 text-xs font-extrabold text-white"
                  >
                    {name}
                  </span>
                ))}
              </div>
              <div className="mt-3 text-sm font-black text-amber-300">
                合計 {formatMoney(Number(currentEvent.payload.totalSpent ?? 0))}
              </div>
            </div>
          )}

          {currentEvent.type === 'shop_traded' && (
            <div className="animate-event-pop bg-gradient-to-b from-amber-800 via-orange-950 to-slate-950 border-4 border-amber-400 rounded-3xl px-6 py-6 text-center shadow-[0_0_50px_rgba(245,158,11,0.5)] max-w-xs w-full">
              <div className="text-5xl mb-2">
                {String(currentEvent.payload.cardIcon ?? '🛒')}
              </div>
              <div className="text-base font-black text-amber-200">
                {actor?.name} がカード売り場で
                <br />
                「{String(currentEvent.payload.cardName ?? '')}」を
                {currentEvent.payload.action === 'sell' ? '売却！' : '購入！'}
              </div>
              <div className="mt-2.5 text-sm font-black text-white">
                {currentEvent.payload.action === 'sell' ? '+' : '-'}
                {formatMoney(Number(currentEvent.payload.price ?? 0))}
              </div>
            </div>
          )}

          {currentEvent.type === 'monopoly_achieved' && (
            <div className="animate-event-pop bg-gradient-to-b from-yellow-500 via-amber-600 to-orange-800 border-4 border-yellow-200 rounded-3xl px-7 py-7 text-center shadow-[0_0_60px_rgba(250,204,21,0.7)] max-w-sm w-full">
              <div className="text-5xl mb-2 animate-bounce">👑✨🏢</div>
              <div className="text-xs font-black text-yellow-100 tracking-wider">MONOPOLY!</div>
              <div className="text-2xl font-black text-white mt-1">
                {actor?.name} が<br />「{String(currentEvent.payload.stationName)}駅」を独占！
              </div>
              <div className="mt-3 py-2 px-4 rounded-2xl bg-black/35 border border-yellow-200/50 text-base font-black text-yellow-200">
                この駅の年間収益が 2倍 に！
              </div>
              {Boolean(currentEvent.payload.heroName) && (
                <div className="mt-2.5 text-xs font-extrabold text-white bg-white/15 py-1.5 px-3 rounded-xl">
                  {String(currentEvent.payload.heroIcon ?? '⚔️')} 歴史ヒーロー「
                  {String(currentEvent.payload.heroName)}」が味方になった！
                </div>
              )}
            </div>
          )}

          {currentEvent.type === 'admin_message' && (
            <div className="animate-event-pop bg-gradient-to-b from-purple-900 via-indigo-950 to-slate-950 border-4 border-amber-300 rounded-3xl px-7 py-7 text-center shadow-[0_0_60px_rgba(168,85,247,0.65)] max-w-sm w-full">
              <div className="text-5xl mb-2 animate-bounce">📢</div>
              {Boolean(currentEvent.payload.targetName) && (
                <div className="inline-block mb-1.5 px-3 py-0.5 rounded-full bg-amber-400 text-slate-950 text-xs font-black">
                  {String(currentEvent.payload.targetName)} 宛て
                </div>
              )}
              <div className="text-xl font-black text-amber-300">
                {String(currentEvent.payload.title ?? '運営からのお知らせ')}
              </div>
              <p className="text-sm text-white font-bold mt-3 leading-relaxed bg-black/40 p-3.5 rounded-2xl border border-white/20 whitespace-pre-wrap">
                {String(currentEvent.payload.message ?? '')}
              </p>
            </div>
          )}

          {currentEvent.type === 'rate_curse_roulette' && (
            <div className="animate-event-shake bg-gradient-to-b from-fuchsia-950 via-purple-950 to-slate-950 border-4 border-fuchsia-400 rounded-3xl px-6 py-6 text-center shadow-[0_0_55px_rgba(217,70,239,0.55)] max-w-sm w-full space-y-3">
              <div className="text-4xl animate-bounce">📉👹</div>
              <div className="text-lg font-black text-fuchsia-300">
                割合ケチケチのマイナスルーレット！
              </div>
              <div className="text-xs text-slate-200 font-bold">
                対象：{actor?.name}（サイコロ2個＝物件件数）
              </div>

              {/* サイコロ2個 */}
              <div className="flex items-center justify-center gap-3 py-1">
                {curseDice.map((val, i) => (
                  <DiceFace key={i} value={val} isRolling={curseStage === 'dice'} index={i} />
                ))}
              </div>
              {curseStage !== 'dice' && (
                <div className="text-sm font-black text-amber-300">
                  対象件数：最大 {String(currentEvent.payload.total)} 件！
                </div>
              )}

              {/* -10 / -50 / -80 / -100% ルーレット */}
              <div className="grid grid-cols-4 gap-1.5 pt-1">
                {[-10, -50, -80, -100].map((pct, idx) => {
                  const active = curseStage !== 'dice' && curseSlotIndex === idx;
                  const confirmed = curseStage === 'result' && active;
                  return (
                    <div
                      key={pct}
                      className={`py-2.5 rounded-xl font-black text-sm border-2 transition-all ${
                        confirmed
                          ? 'bg-rose-600 border-yellow-300 text-white scale-110 shadow-[0_0_20px_rgba(244,63,94,0.85)]'
                          : active
                            ? 'bg-fuchsia-600 border-white text-white scale-105'
                            : 'bg-slate-900/80 border-slate-700 text-slate-400'
                      }`}
                    >
                      {pct}%
                    </div>
                  );
                })}
              </div>

              {curseStage === 'result' && (
                <div className="bg-black/45 border border-rose-500/50 rounded-2xl p-2.5 text-xs text-left space-y-1">
                  {Number(currentEvent.payload.affectedCount ?? 0) > 0 ? (
                    <>
                      <div className="font-black text-rose-300 text-center">
                        {String(currentEvent.payload.affectedCount)}件の収益率が2期連続で{' '}
                        {String(currentEvent.payload.cursePercent)}% に！！
                      </div>
                      <div className="text-[11px] text-slate-200 flex flex-wrap gap-1 justify-center pt-1">
                        {((currentEvent.payload.affectedNames as string[]) ?? [])
                          .slice(0, 6)
                          .map((name, i) => (
                            <span
                              key={i}
                              className="px-2 py-0.5 rounded-full bg-rose-950/90 border border-rose-500/40"
                            >
                              {name}
                            </span>
                          ))}
                        {((currentEvent.payload.affectedNames as string[]) ?? []).length > 6 && (
                          <span className="px-2 py-0.5 text-rose-300 font-bold">
                            他{((currentEvent.payload.affectedNames as string[]) ?? []).length - 6}件
                          </span>
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="font-black text-rose-300 text-center">
                      物件がないため -{formatMoney(Number(currentEvent.payload.fallbackPenalty ?? 0))} を奪われた！
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {(currentEvent.type === 'nuisance_attach' ||
            currentEvent.type === 'nuisance_action') && (
            <div className="animate-event-shake bg-gradient-to-b from-purple-950 via-slate-900 to-black border-4 border-purple-500 rounded-3xl px-6 py-7 text-center shadow-[0_0_50px_rgba(168,85,247,0.5)] max-w-sm w-full">
              <div className="text-6xl mb-3 animate-bounce">
                {String(currentEvent.payload.icon ?? '👹')}
              </div>
              <div className="text-lg font-black text-purple-300">
                {currentEvent.type === 'nuisance_attach'
                  ? `ケチケチ大王が ${String(currentEvent.payload.targetName)} にとりついた！`
                  : String(currentEvent.payload.title)}
              </div>
              {currentEvent.type === 'nuisance_action' && (
                <p className="text-sm text-slate-100 mt-3 leading-relaxed bg-purple-950/60 p-3 rounded-2xl border border-purple-700/50">
                  {String(currentEvent.payload.description)}
                </p>
              )}
            </div>
          )}

          {currentEvent.type === 'random_event' && (
            <div
              className={`border-4 rounded-3xl px-7 py-7 text-center shadow-2xl max-w-sm w-full ${
                currentEvent.payload.isPositive === false
                  ? 'bg-gradient-to-b from-rose-950 via-slate-900 to-black border-rose-500'
                  : 'bg-gradient-to-b from-indigo-900 via-slate-900 to-slate-950 border-amber-400'
              }`}
            >
              <div className="text-5xl mb-2 animate-bounce">
                {String(currentEvent.payload.icon ?? '✨')}
              </div>
              <div className="text-xl font-black text-white mt-1">
                {String(currentEvent.payload.title)}
              </div>
              <p className="text-sm text-slate-100 mt-3 leading-relaxed bg-black/35 p-3 rounded-2xl border border-white/15">
                {String(currentEvent.payload.description)}
              </p>
            </div>
          )}

          {currentEvent.type === 'card_used' && (
            <div className="bg-slate-900 border-4 border-amber-400 rounded-3xl px-7 py-6 text-center shadow-2xl">
              <div className="text-5xl mb-2 animate-bounce">
                {String(currentEvent.payload.icon ?? '🃏')}
              </div>
              <div className="text-base font-black text-amber-300">
                {actor?.name} が
                <br />「{String(currentEvent.payload.cardName)}」を使った！
              </div>
            </div>
          )}

          {currentEvent.type === 'duel_result' && (() => {
            const c = currentEvent.payload.challenger as {
              id: string;
              name: string;
              avatar: string;
              color: string;
              dice: number[];
              tries: number;
              handName: string;
              mult: number;
              isHifumi: boolean;
            };
            const o = currentEvent.payload.opponent as typeof c;
            const bet = Number(currentEvent.payload.bet ?? 0);
            const payout = Number(currentEvent.payload.payout ?? 0);
            const mult = Number(currentEvent.payload.multiplier ?? 1);
            const winnerId = currentEvent.payload.winnerId as string | null;
            const winnerName = currentEvent.payload.winnerName as string | null;
            const renderMiniDice = (dice: number[]) => (
              <div className="flex items-center justify-center gap-1.5 my-1.5">
                {dice.map((v, i) => (
                  <span
                    key={i}
                    className={`w-9 h-9 rounded-xl bg-white border-2 border-slate-300 shadow flex items-center justify-center text-lg font-black ${
                      v === 1 ? 'text-rose-600' : 'text-slate-900'
                    }`}
                  >
                    {v}
                  </span>
                ))}
              </div>
            );
            return (
              <div className="animate-event-pop bg-gradient-to-b from-rose-950 via-slate-900 to-purple-950 border-4 border-amber-400 rounded-3xl p-5 shadow-2xl max-w-sm w-full text-center">
                <div className="text-xs font-extrabold text-amber-300 tracking-wider">
                  ⚔️ チンチロ決闘結果（掛け金 {formatMoney(bet)}）
                </div>
                <div className="grid grid-cols-2 gap-2.5 mt-3">
                  <div
                    className={`p-2.5 rounded-2xl border ${
                      winnerId === c?.id
                        ? 'bg-amber-500/20 border-amber-400'
                        : 'bg-slate-900/80 border-slate-700'
                    }`}
                  >
                    <div className="text-xs font-black truncate" style={{ color: c?.color }}>
                      {c?.avatar} {c?.name}
                    </div>
                    {c?.dice && renderMiniDice(c.dice)}
                    <div
                      className={`text-xs font-black ${
                        c?.isHifumi ? 'text-rose-400' : 'text-amber-200'
                      }`}
                    >
                      {c?.handName}
                    </div>
                  </div>
                  <div
                    className={`p-2.5 rounded-2xl border ${
                      winnerId === o?.id
                        ? 'bg-amber-500/20 border-amber-400'
                        : 'bg-slate-900/80 border-slate-700'
                    }`}
                  >
                    <div className="text-xs font-black truncate" style={{ color: o?.color }}>
                      {o?.avatar} {o?.name}
                    </div>
                    {o?.dice && renderMiniDice(o.dice)}
                    <div
                      className={`text-xs font-black ${
                        o?.isHifumi ? 'text-rose-400' : 'text-amber-200'
                      }`}
                    >
                      {o?.handName}
                    </div>
                  </div>
                </div>
                <div className="mt-3 py-2.5 px-3 rounded-2xl bg-black/45 border border-amber-400/50">
                  {winnerName ? (
                    <>
                      <div className="text-base font-black text-amber-300">
                        🏆 {winnerName} の勝利！{mult > 1 ? `（${mult}倍！）` : ''}
                      </div>
                      <div className="text-sm font-black text-emerald-400 mt-0.5">
                        +{formatMoney(payout)} 獲得！
                      </div>
                    </>
                  ) : (
                    <div className="text-base font-black text-slate-200">
                      🤝 引き分け！（移動なし）
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {currentEvent.type === 'year_settlement' && (
            <div
              onClick={(e) => e.stopPropagation()}
              className="animate-event-pop bg-gradient-to-b from-slate-900 to-emerald-950/90 border-4 border-emerald-400 rounded-3xl p-5 shadow-2xl max-w-md w-full"
            >
              <div className="text-center mb-3">
                <div className="text-xs font-extrabold text-emerald-300 tracking-wider">
                  3月終了・年度末総決算
                </div>
                <h2 className="text-2xl font-black text-white mt-0.5">
                  📊 {String(currentEvent.payload.year)}年目 決算発表！
                </h2>
              </div>
              <AssetHistoryChart
                history={
                  (currentEvent.payload.assetHistory as {
                    year: number;
                    assets: Record<string, number>;
                  }[]) ?? []
                }
                players={players}
              />
              <div className="space-y-2.5 max-h-[58vh] overflow-y-auto">
                {(() => {
                  const rows =
                    (currentEvent.payload.summary as {
                      playerId: string;
                      name: string;
                      avatar?: string;
                      color: string;
                      rank?: number;
                      income: number;
                      moneyAfter: number;
                      propertyAssets?: number;
                      totalAssets?: number;
                    }[]) ?? [];
                  const maxAssets = Math.max(
                    10000,
                    ...rows.map((r) => Math.max(0, r.totalAssets ?? r.moneyAfter))
                  );
                  return rows.map((row, idx) => {
                    const tot = row.totalAssets ?? row.moneyAfter;
                    const barPct = Math.min(100, Math.max(6, (Math.max(0, tot) / maxAssets) * 100));
                    return (
                      <div
                        key={row.playerId}
                        className="bg-slate-900/90 border border-slate-700/80 rounded-2xl p-3 space-y-1.5"
                      >
                        <div className="flex items-center justify-between text-xs font-bold">
                          <div className="flex items-center gap-1.5">
                            <span className="text-amber-400 font-black text-sm">
                              {row.rank ?? idx + 1}位
                            </span>
                            {row.avatar && <span>{row.avatar}</span>}
                            <span style={{ color: row.color }}>{row.name}</span>
                          </div>
                          <span className="text-emerald-400 font-black">
                            収益 +{formatMoney(row.income)}
                          </span>
                        </div>
                        <div className="w-full h-3 bg-slate-800 rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all duration-700"
                            style={{ backgroundColor: row.color, width: `${barPct}%` }}
                          />
                        </div>
                        <div className="flex justify-between text-[11px] text-slate-300">
                          <span>現金 {formatMoney(row.moneyAfter)}</span>
                          <span>物件 {formatMoney(row.propertyAssets ?? 0)}</span>
                          <span className="font-black text-amber-300">
                            総資産 {formatMoney(tot)}
                          </span>
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
              <button
                onClick={onConsumeEvent}
                className="mt-4 w-full py-3 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-sm shadow-lg"
              >
                次の年へ進む
              </button>
            </div>
          )}

          {currentEvent.type === 'game_finished' && (
            <div
              onClick={(e) => e.stopPropagation()}
              className="bg-gradient-to-b from-slate-900 to-indigo-950 border-4 border-amber-400 rounded-3xl p-5 shadow-2xl max-w-md w-full text-center max-h-[88vh] overflow-y-auto"
            >
              <Trophy className="w-12 h-12 text-amber-400 mx-auto mb-1.5 animate-bounce" />
              <h2 className="text-2xl font-black text-white mb-3">🏆 最終結果発表！</h2>
              <AssetHistoryChart
                history={
                  (currentEvent.payload.assetHistory as {
                    year: number;
                    assets: Record<string, number>;
                  }[]) ?? []
                }
                players={players}
              />
              <div className="space-y-2 text-left">
                {[...players]
                  .sort((a, b) => a.rank - b.rank)
                  .map((p) => (
                    <div
                      key={p.id}
                      className="flex items-center justify-between p-2.5 rounded-2xl bg-slate-800/90 border border-slate-700"
                    >
                      <div className="flex items-center gap-2.5">
                        <span className="text-lg font-black text-amber-400 w-6">
                          {p.rank}位
                        </span>
                        <span className="text-xl">{p.avatar}</span>
                        <span className="font-bold text-white text-sm">{p.name}</span>
                      </div>
                      <div className="text-sm font-extrabold text-emerald-400">
                        {formatMoney(p.totalAssets)}
                      </div>
                    </div>
                  ))}
              </div>
              {Array.isArray(currentEvent.payload.awards) &&
                (currentEvent.payload.awards as unknown[]).length > 0 && (
                  <div className="mt-4 pt-3 border-t border-indigo-700/60 text-left">
                    <div className="text-xs font-extrabold text-amber-300 mb-2 text-center">
                      🎖️ 特別表彰式
                    </div>
                    <div className="grid grid-cols-1 gap-1.5">
                      {(
                        currentEvent.payload.awards as {
                          title: string;
                          icon: string;
                          playerName: string;
                          playerColor: string;
                          detail: string;
                        }[]
                      ).map((aw) => (
                        <div
                          key={aw.title}
                          className="flex items-center justify-between px-3 py-2 rounded-xl bg-slate-950/75 border border-amber-500/30 text-xs"
                        >
                          <div className="font-extrabold text-amber-200">
                            {aw.icon} {aw.title}
                          </div>
                          <div className="text-right">
                            <span className="font-black" style={{ color: aw.playerColor }}>
                              {aw.playerName}
                            </span>
                            <span className="text-slate-400 ml-1.5 text-[11px]">{aw.detail}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
            </div>
          )}
          {isSkippableCutIn && (
            <div className="mt-3 text-[11px] font-bold text-white/60 tracking-wider animate-pulse select-none">
              タップで次へ ▸
            </div>
          )}
        </div>
      )}
    </>
  );
};
