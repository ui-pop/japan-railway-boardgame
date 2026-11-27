import React, { useMemo, useState } from 'react';
import { Swords } from 'lucide-react';
import type { PublicGameState } from '../types';
import { formatMoney } from './StatusBar';

interface DuelModalProps {
  gameState: PublicGameState;
  myPlayerId: string;
  onStartDuel: (opponentId: string, bet: number) => void;
  onSkip: () => void;
}

export const DuelModal: React.FC<DuelModalProps> = ({
  gameState,
  myPlayerId,
  onStartDuel,
  onSkip,
}) => {
  const me = gameState.players.find((p) => p.id === myPlayerId);
  const isSameStationDuel = Boolean(
    gameState.duelOpponentIds && gameState.duelOpponentIds.length > 0
  );
  const rivals = useMemo(() => {
    const allowed =
      gameState.duelOpponentIds && gameState.duelOpponentIds.length > 0
        ? new Set(gameState.duelOpponentIds)
        : null;
    return gameState.players.filter(
      (p) => p.id !== myPlayerId && (!allowed || allowed.has(p.id))
    );
  }, [gameState.players, gameState.duelOpponentIds, myPlayerId]);

  const infl = gameState.shopPriceMultiplier ?? 1;
  const minBet = Math.max(1000, Math.round((1000 * infl) / 100) * 100);
  const myMoney = me?.money ?? 0;
  const maxBet = Math.max(minBet * 5, Math.max(0, myMoney));

  const [selectedOpponentId, setSelectedOpponentId] = useState<string>(rivals[0]?.id ?? '');
  const [bet, setBet] = useState<number>(minBet);

  const presets = useMemo(() => {
    const raw = [
      { label: '最低額', value: minBet },
      { label: '25%', value: Math.max(minBet, Math.round((maxBet * 0.25) / 100) * 100) },
      { label: '半分', value: Math.max(minBet, Math.round((maxBet * 0.5) / 100) * 100) },
      { label: '全額勝負', value: maxBet },
    ];
    return raw;
  }, [minBet, maxBet]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-md bg-slate-900 border-2 border-rose-500/80 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[88vh]">
        <div className="px-5 py-4 bg-gradient-to-r from-rose-800 via-red-900 to-purple-900 border-b border-rose-500/50">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-black text-white flex items-center gap-2">
              <Swords className="w-5 h-5 text-amber-300" />
              {isSameStationDuel ? '⚔️ 同じマスで鉢合わせ！チンチロ決闘' : '⚔️ チンチロ決闘マス！'}
            </h2>
            <span className="text-xs font-bold text-amber-200">
              所持金: {formatMoney(myMoney)}
            </span>
          </div>
          <p className="text-[11px] text-rose-100 mt-1 leading-snug">
            対戦相手と掛け金を決めて3個のサイコロで真剣勝負！
          </p>
        </div>

        <div className="p-4 overflow-y-auto space-y-4 flex-1">
          {/* 役と倍率ガイド */}
          <div className="p-2.5 rounded-2xl bg-slate-950/80 border border-slate-700/80 text-[11px] text-slate-300 grid grid-cols-2 gap-1">
            <div><span className="text-amber-300 font-black">ピンゾロ(1-1-1)</span>：5倍</div>
            <div><span className="text-orange-300 font-black">アラシ(ゾロ目)</span>：3倍</div>
            <div><span className="text-sky-300 font-black">シゴロ(4-5-6)</span>：2倍</div>
            <div><span className="text-rose-400 font-black">ヒフミ(1-2-3)</span>：2倍払い</div>
          </div>

          {/* 対戦相手選択 */}
          <div>
            <div className="text-xs font-extrabold text-slate-300 mb-2">
              1. 対戦相手を選択
            </div>
            <div className="space-y-1.5">
              {rivals.map((r) => {
                const selected = r.id === selectedOpponentId;
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setSelectedOpponentId(r.id)}
                    className={`w-full flex items-center justify-between p-2.5 rounded-2xl border transition text-left ${
                      selected
                        ? 'bg-rose-950/80 border-amber-400 shadow-[0_0_15px_rgba(251,191,36,0.25)]'
                        : 'bg-slate-800/80 border-slate-700 hover:bg-slate-800'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <span
                        className="w-8 h-8 rounded-full flex items-center justify-center border border-white text-base"
                        style={{ backgroundColor: r.color }}
                      >
                        {r.avatar}
                      </span>
                      <div>
                        <div className="text-sm font-black text-white">
                          {r.name} <span className="text-[11px] text-amber-300">({r.rank}位)</span>
                        </div>
                        <div className="text-[11px] text-slate-400">
                          現金 {formatMoney(r.money)} / 総資産 {formatMoney(r.totalAssets)}
                        </div>
                      </div>
                    </div>
                    {selected && (
                      <span className="px-2.5 py-1 rounded-xl bg-amber-400 text-slate-950 text-xs font-black">
                        選択中
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 掛け金設定 */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-extrabold text-slate-300">2. 掛け金を設定</span>
              <span className="text-base font-black text-amber-300 tabular-nums">
                {formatMoney(bet)}
              </span>
            </div>
            <input
              type="range"
              min={minBet}
              max={maxBet}
              step={100}
              value={Math.min(maxBet, Math.max(minBet, bet))}
              onChange={(e) => setBet(Number(e.target.value))}
              className="w-full accent-amber-400"
            />
            <div className="grid grid-cols-4 gap-1.5 mt-2">
              {presets.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => setBet(p.value)}
                  className="py-1.5 px-1 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-600 text-[11px] font-bold text-slate-200"
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="text-[10px] text-slate-400 mt-1.5">
              ※ピンゾロで最大 {formatMoney(bet * 5)} が動きます
            </div>
          </div>
        </div>

        <div className="p-4 border-t border-slate-800 bg-slate-950/60 flex gap-2">
          <button
            type="button"
            onClick={onSkip}
            className="px-4 py-3 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-extrabold text-xs"
          >
            見送る
          </button>
          <button
            type="button"
            disabled={!selectedOpponentId}
            onClick={() => onStartDuel(selectedOpponentId, bet)}
            className="flex-1 py-3 rounded-2xl bg-gradient-to-r from-rose-600 to-amber-500 hover:from-rose-500 hover:to-amber-400 active:scale-[0.98] text-white font-black text-sm shadow-lg disabled:opacity-40"
          >
            🎲 {formatMoney(bet)} で決闘する！
          </button>
        </div>
      </div>
    </div>
  );
};
