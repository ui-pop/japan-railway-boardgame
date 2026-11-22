import React, { useEffect, useRef, useState } from 'react';
import { Trophy } from 'lucide-react';
import type { GameEventSeqItem, PlayerPublicState, StampBroadcast } from '../types';
import { soundManager } from '../utils/sound';
import { formatMoney } from './StatusBar';

interface EventOverlayProps {
  eventQueue: GameEventSeqItem[];
  players: PlayerPublicState[];
  stamps: StampBroadcast[];
  lowDataMode: boolean;
  currentTurnPlayerId?: string;
  turnCount?: number;
  currentYear?: number;
  currentMonth?: number;
  onConsumeEvent: () => void;
}

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
  stamps,
  lowDataMode,
  currentTurnPlayerId,
  turnCount,
  currentYear,
  currentMonth,
  onConsumeEvent,
}) => {
  const currentEvent = eventQueue[0];

  // サイコロの回転ステート
  const [isRollingDice, setIsRollingDice] = useState(false);
  const [rollingValues, setRollingValues] = useState<number[]>([1]);

  // 赤・青マスの金額スロット回転ステート
  const [isSpinningMoney, setIsSpinningMoney] = useState(false);
  const [displayAmount, setDisplayAmount] = useState<number>(0);

  // ターン開始アイキャッチ＆月替わり検知
  const [turnBannerPlayer, setTurnBannerPlayer] = useState<PlayerPublicState | null>(null);
  const [isNewMonthBanner, setIsNewMonthBanner] = useState(false);
  const lastTurnCountRef = useRef<number>(0);
  const lastMonthRef = useRef<number | undefined>(undefined);
  const bannerTimerRef = useRef<number | null>(null);

  // ターン切り替わり時の桃鉄風大型アイキャッチ表示（前のイベントが全部終わってから表示）
  useEffect(() => {
    if (!turnCount || !currentTurnPlayerId) return;
    if (eventQueue.length > 0) return;
    if (turnCount !== lastTurnCountRef.current) {
      lastTurnCountRef.current = turnCount;
      const monthChanged =
        lastMonthRef.current !== undefined && lastMonthRef.current !== currentMonth;
      lastMonthRef.current = currentMonth;

      const p = players.find((x) => x.id === currentTurnPlayerId);
      if (p) {
        setIsNewMonthBanner(monthChanged);
        setTurnBannerPlayer(p);
        soundManager.playTurnStart();
        if (bannerTimerRef.current) window.clearTimeout(bannerTimerRef.current);
        bannerTimerRef.current = window.setTimeout(() => {
          setTurnBannerPlayer(null);
          bannerTimerRef.current = null;
        }, 1900);
      }
    }
  }, [turnCount, currentTurnPlayerId, currentMonth, players, eventQueue.length]);

  useEffect(() => {
    return () => {
      if (bannerTimerRef.current) window.clearTimeout(bannerTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!currentEvent) return;

    if (currentEvent.type === 'dice_roll') {
      const targetRolls = (currentEvent.payload.rolls as number[]) ?? [1];
      const isFixed = Boolean(currentEvent.payload.isFixed);

      if (isFixed || lowDataMode) {
        setIsRollingDice(false);
        setRollingValues(targetRolls);
        soundManager.playDiceResult();
        const timer = window.setTimeout(onConsumeEvent, 1200);
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
      }, 85);

      // 1.15秒後に確定出目を表示
      const revealTimer = window.setTimeout(() => {
        window.clearInterval(rollInterval);
        setIsRollingDice(false);
        setRollingValues(targetRolls);
        soundManager.playDiceResult();
      }, 1150);

      // 合計2.35秒後にイベント消化
      const endTimer = window.setTimeout(() => {
        onConsumeEvent();
      }, 2350);

      return () => {
        window.clearInterval(rollInterval);
        window.clearTimeout(revealTimer);
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
        const timer = window.setTimeout(onConsumeEvent, 1200);
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
      }, 75);

      const revealTimer = window.setTimeout(() => {
        window.clearInterval(spinInterval);
        setIsSpinningMoney(false);
        setDisplayAmount(targetAmt);
        if (isPlus) soundManager.playPlus();
        else soundManager.playMinus();
      }, 1050);

      const endTimer = window.setTimeout(() => {
        onConsumeEvent();
      }, 2400);

      return () => {
        window.clearInterval(spinInterval);
        window.clearTimeout(revealTimer);
        window.clearTimeout(endTimer);
      };
    }

    // その他のイベントのSE再生
    if (currentEvent.type === 'step_move') {
      soundManager.playStep();
    } else if (currentEvent.type === 'destination_reached') {
      soundManager.playGoal();
    } else if (
      currentEvent.type === 'nuisance_action' ||
      currentEvent.type === 'nuisance_attach'
    ) {
      soundManager.playNuisance();
    } else if (currentEvent.type === 'random_event') {
      if (currentEvent.payload.isPositive === false) soundManager.playMinus();
      else soundManager.playGoal();
    } else if (currentEvent.type === 'station_effect') {
      soundManager.playPlus();
    }

    const duration =
      currentEvent.type === 'step_move'
        ? 550
        : currentEvent.type === 'year_settlement' || currentEvent.type === 'game_finished'
          ? 0 // 手動で閉じる
          : currentEvent.type === 'destination_reached' ||
              currentEvent.type === 'nuisance_action' ||
              currentEvent.type === 'nuisance_attach' ||
              currentEvent.type === 'random_event'
            ? lowDataMode
              ? 1600
              : 3000
            : lowDataMode
              ? 1200
              : 2300;

    if (duration > 0) {
      const timer = window.setTimeout(onConsumeEvent, duration);
      return () => window.clearTimeout(timer);
    }
  }, [currentEvent, lowDataMode, onConsumeEvent]);

  // スタンプ受信時の効果音
  useEffect(() => {
    if (stamps.length > 0) {
      soundManager.playStamp();
    }
  }, [stamps.length]);

  const actor = currentEvent
    ? players.find((p) => p.id === currentEvent.playerId)
    : undefined;

  return (
    <>
      {/* 桃鉄風 ターン間大型アイキャッチ幕 */}
      {turnBannerPlayer && !currentEvent && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/45 backdrop-blur-[2px] pointer-events-none p-4">
          <div
            className="w-full max-w-sm rounded-3xl p-6 text-center shadow-[0_15px_50px_rgba(0,0,0,0.75)] border-4 border-amber-300"
            style={{
              background: `linear-gradient(155deg, ${turnBannerPlayer.color}f2 0%, #1e1b4bf5 100%)`,
            }}
          >
            {isNewMonthBanner && (
              <div className="inline-block mb-2 px-3 py-0.5 rounded-full bg-amber-400 text-slate-950 text-xs font-black shadow">
                📅 {currentYear}年目 {currentMonth}月に突入！
              </div>
            )}
            <div className="text-xs font-extrabold text-amber-200 tracking-wider">
              {currentYear}年目 {currentMonth}月
            </div>
            <div className="my-3 flex items-center justify-center gap-3">
              <div className="w-16 h-16 rounded-2xl bg-white/20 border-3 border-white flex items-center justify-center text-4xl shadow-lg animate-bounce">
                {turnBannerPlayer.avatar}
              </div>
            </div>
            <div className="text-2xl font-black text-white drop-shadow">
              {turnBannerPlayer.name}のターン！
            </div>
            <div className="mt-3 inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-black/40 border border-white/25 text-sm font-black text-amber-300">
              <span>🚩 目的地まで あと {turnBannerPlayer.distanceToDest} マス</span>
            </div>
          </div>
        </div>
      )}

      {/* 画面右上のスタンプポップアップ */}
      <div className="fixed top-28 right-3 z-40 flex flex-col gap-1.5 pointer-events-none">
        {stamps.map((s) => (
          <div
            key={s.id}
            className="flex items-center gap-2 px-3 py-1.5 rounded-2xl bg-slate-900/95 border border-slate-600 shadow-xl animate-bounce"
          >
            <span className="text-xl">{s.stamp.icon}</span>
            <div className="text-xs">
              <div className="font-bold" style={{ color: s.playerColor }}>
                {s.playerName}
              </div>
              <div className="text-white font-extrabold">{s.stamp.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* イベントカットイン（スキップ不可・順番に最後まで再生） */}
      {currentEvent && currentEvent.type !== 'step_move' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-[3px] p-4">
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
              className={`rounded-3xl px-8 py-7 text-center shadow-2xl max-w-xs w-full border-4 transition-transform ${
                currentEvent.payload.stationType === 'plus'
                  ? 'bg-gradient-to-b from-sky-900 via-blue-950 to-slate-950 border-sky-400 shadow-[0_0_45px_rgba(56,189,248,0.5)]'
                  : currentEvent.payload.stationType === 'minus'
                    ? 'bg-gradient-to-b from-rose-950 via-red-950 to-slate-950 border-rose-500 shadow-[0_0_45px_rgba(244,63,94,0.5)]'
                    : 'bg-slate-900 border-amber-400'
              }`}
            >
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
            <div className="bg-gradient-to-b from-amber-500 via-amber-700 to-amber-900 border-4 border-yellow-200 rounded-3xl px-7 py-7 text-center shadow-[0_0_60px_rgba(250,204,21,0.6)] max-w-sm w-full">
              <div className="text-5xl mb-2 animate-bounce">🎊🏆🎊</div>
              <div className="text-2xl font-black text-white mt-1">
                {actor?.name} が目的地
                <br />「{String(currentEvent.payload.stationName)}」に到着！
              </div>
              <div className="mt-4 py-2 px-4 rounded-2xl bg-black/30 border border-yellow-300/50 text-2xl font-black text-yellow-200">
                援助金 +{formatMoney(Number(currentEvent.payload.bonus))}
              </div>
            </div>
          )}

          {(currentEvent.type === 'nuisance_attach' ||
            currentEvent.type === 'nuisance_action') && (
            <div className="bg-gradient-to-b from-purple-950 via-slate-900 to-black border-4 border-purple-500 rounded-3xl px-6 py-7 text-center shadow-[0_0_50px_rgba(168,85,247,0.5)] max-w-sm w-full">
              <div className="text-6xl mb-3 animate-bounce">👹</div>
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

          {currentEvent.type === 'year_settlement' && (
            <div
              onClick={(e) => e.stopPropagation()}
              className="bg-slate-900 border-4 border-emerald-500 rounded-3xl p-5 shadow-2xl max-w-md w-full"
            >
              <div className="text-center mb-4">
                <h2 className="text-xl font-black text-white">
                  📊 {String(currentEvent.payload.year)}年目 年度末決算
                </h2>
              </div>
              <div className="space-y-2.5 max-h-[55vh] overflow-y-auto">
                {((currentEvent.payload.summary as {
                  playerId: string;
                  name: string;
                  color: string;
                  income: number;
                  moneyAfter: number;
                }[]) ?? []).map((row) => (
                  <div key={row.playerId} className="bg-slate-800/80 rounded-xl p-2.5">
                    <div className="flex justify-between text-xs font-bold mb-1">
                      <span style={{ color: row.color }}>{row.name}</span>
                      <span className="text-emerald-400">
                        収益 +{formatMoney(row.income)}
                      </span>
                    </div>
                    <div className="w-full h-2.5 bg-slate-700 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          backgroundColor: row.color,
                          width: `${Math.min(100, Math.max(8, (row.income / 10000) * 100))}%`,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
              <button
                onClick={onConsumeEvent}
                className="mt-4 w-full py-3 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-sm"
              >
                次の年へ進む
              </button>
            </div>
          )}

          {currentEvent.type === 'game_finished' && (
            <div
              onClick={(e) => e.stopPropagation()}
              className="bg-gradient-to-b from-slate-900 to-indigo-950 border-4 border-amber-400 rounded-3xl p-6 shadow-2xl max-w-md w-full text-center"
            >
              <Trophy className="w-12 h-12 text-amber-400 mx-auto mb-2" />
              <h2 className="text-2xl font-black text-white mb-4">最終結果発表！</h2>
              <div className="space-y-2 text-left max-h-[55vh] overflow-y-auto">
                {[...players]
                  .sort((a, b) => a.rank - b.rank)
                  .map((p) => (
                    <div
                      key={p.id}
                      className="flex items-center justify-between p-3 rounded-2xl bg-slate-800/90 border border-slate-700"
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
            </div>
          )}
        </div>
      )}
    </>
  );
};
