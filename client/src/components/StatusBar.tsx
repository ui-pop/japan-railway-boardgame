import React, { useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Flag,
  Music,
  Volume2,
  VolumeX,
  Wifi,
  Zap,
} from 'lucide-react';
import type { PublicGameState, StationDef } from '../types';

interface StatusBarProps {
  gameState: PublicGameState;
  myPlayerId: string | null;
  stations: StationDef[];
  bgmOn: boolean;
  seOn: boolean;
  lowDataMode: boolean;
  onToggleBgm: () => void;
  onToggleSe: () => void;
  onToggleLowData: () => void;
}

export function formatMoney(manYen: number): string {
  const sign = manYen < 0 ? '-' : '';
  const abs = Math.abs(manYen);
  if (abs >= 10000) {
    const oku = Math.floor(abs / 10000);
    const man = abs % 10000;
    return man > 0 ? `${sign}${oku}億${man.toLocaleString()}万` : `${sign}${oku}億円`;
  }
  return `${sign}${abs.toLocaleString()}万円`;
}

export const StatusBar: React.FC<StatusBarProps> = ({
  gameState,
  myPlayerId,
  stations,
  bgmOn,
  seOn,
  lowDataMode,
  onToggleBgm,
  onToggleSe,
  onToggleLowData,
}) => {
  const [drawerOpen, setDrawerOpen] = useState(false);

  const me = gameState.players.find((p) => p.id === myPlayerId);
  const currentTurnPlayer = gameState.players.find(
    (p) => p.id === gameState.currentTurnPlayerId
  );
  const destStation = stations.find((s) => s.id === gameState.destinationStationId);

  const sortedPlayers = [...gameState.players].sort((a, b) => a.rank - b.rank);

  return (
    <div className="fixed top-0 left-0 right-0 z-30 pointer-events-none">
      <div className="pointer-events-auto bg-gradient-to-b from-amber-50/95 to-yellow-100/95 backdrop-blur-md border-b-4 border-red-600 shadow-xl px-3 py-2 text-slate-900">
        {/* 1行目: 桃鉄風カレンダー / 目的地看板 / 設定ボタン */}
        <div className="flex items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-1 rounded-lg bg-gradient-to-b from-red-600 to-red-700 text-yellow-200 font-black border-2 border-amber-300 shadow">
              {gameState.currentYear}年目 {gameState.currentMonth}月
            </span>
            <span className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-yellow-300 text-red-900 font-black border-2 border-red-600 shadow truncate max-w-[150px]">
              <Flag className="w-3.5 h-3.5 shrink-0 text-red-600" />
              {destStation?.name ?? '---'}
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={onToggleSe}
              title="効果音切替"
              className={`p-1.5 rounded-lg border-2 text-xs font-bold ${
                seOn
                  ? 'bg-sky-500 border-sky-700 text-white'
                  : 'bg-slate-200 border-slate-400 text-slate-500'
              }`}
            >
              {seOn ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
            </button>
            <button
              onClick={onToggleBgm}
              title="BGM切替"
              className={`p-1.5 rounded-lg border-2 text-xs font-bold ${
                bgmOn
                  ? 'bg-emerald-500 border-emerald-700 text-white'
                  : 'bg-slate-200 border-slate-400 text-slate-500'
              }`}
            >
              <Music className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={onToggleLowData}
              title="省データモード"
              className={`p-1.5 rounded-lg border-2 text-xs flex items-center gap-0.5 ${
                lowDataMode
                  ? 'bg-amber-500 border-amber-700 text-white'
                  : 'bg-slate-200 border-slate-400 text-slate-500'
              }`}
            >
              <Zap className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* 2行目: 自分のステータス（桃鉄風白カード＋社長カラー太枠） */}
        {me && (
          <button
            onClick={() => setDrawerOpen((v) => !v)}
            style={{ borderColor: me.color }}
            className="mt-1.5 w-full flex items-center justify-between bg-white hover:bg-amber-50 border-3 rounded-2xl px-3 py-1.5 text-left shadow transition"
          >
            <div className="flex items-center gap-2">
              <span
                className="w-8 h-8 rounded-full flex items-center justify-center text-base border-2 border-white shadow shrink-0"
                style={{ backgroundColor: me.color }}
              >
                {me.avatar}
              </span>
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="px-1.5 py-0.2 rounded bg-red-600 text-yellow-200 font-black text-xs">
                    {me.rank}位
                  </span>
                  <span className="text-xs text-slate-900 font-black">{me.name}</span>
                  {me.hasNuisance && <span title="ケチケチ大王憑依中">👹</span>}
                </div>
                <div className="text-xs text-emerald-700 font-black">
                  現金 {formatMoney(me.money)}
                  <span className="text-slate-500 font-bold ml-2">
                    総資産 {formatMoney(me.totalAssets)}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className="text-right">
                <div className="text-[10px] text-slate-500 font-bold">目的地まで</div>
                <div className="text-sm font-black text-red-600">
                  あと {me.distanceToDest} マス
                </div>
              </div>
              {drawerOpen ? (
                <ChevronUp className="w-4 h-4 text-slate-500" />
              ) : (
                <ChevronDown className="w-4 h-4 text-slate-500" />
              )}
            </div>
          </button>
        )}

        {/* 流れるライブテロップ（常駐固定ではなく右から左へ流れる） */}
        {gameState.status === 'playing' && currentTurnPlayer && (
          <div className="mt-1.5 overflow-hidden bg-slate-900/90 rounded-lg py-1 px-2 border border-red-600/50">
            <div className="animate-ticker text-xs font-bold text-amber-200">
              <span
                className="inline-block w-2 h-2 rounded-full mr-1.5 align-middle"
                style={{ backgroundColor: currentTurnPlayer.color }}
              />
              <span className="font-black text-white mr-3">
                {currentTurnPlayer.id === myPlayerId
                  ? '🚃 あなたのターン！'
                  : `🚃 ${currentTurnPlayer.name}が行動中…`}
              </span>
              <span className="text-amber-200">{gameState.lastEventMessage}</span>
            </div>
          </div>
        )}

        {gameState.status === 'paused' && (
          <div className="mt-1.5 text-center text-xs font-bold text-amber-300 bg-amber-950/70 rounded py-1 border border-amber-600/50">
            ⏸️ 管理者により一時停止中です
          </div>
        )}
      </div>

      {/* 全プレイヤー一覧ドロワー */}
      {drawerOpen && (
        <div className="pointer-events-auto bg-slate-900/95 backdrop-blur-lg border-b border-slate-700 shadow-2xl p-3 max-h-[60vh] overflow-y-auto">
          <div className="text-xs font-bold text-slate-400 mb-2 flex items-center justify-between">
            <span>全社長ランキング（{sortedPlayers.length}人）</span>
            <span className="flex items-center gap-1">
              <Wifi className="w-3 h-3 text-emerald-400" /> リアルタイム同期中
            </span>
          </div>
          <div className="space-y-1.5">
            {sortedPlayers.map((p) => (
              <div
                key={p.id}
                className={`flex items-center justify-between p-2 rounded-xl border ${
                  p.id === myPlayerId
                    ? 'bg-sky-950/60 border-sky-500/60'
                    : 'bg-slate-800/70 border-slate-700/70'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="w-5 text-center font-extrabold text-sm text-amber-300">
                    {p.rank}
                  </span>
                  <span
                    className="w-7 h-7 rounded-full flex items-center justify-center text-sm border border-white"
                    style={{ backgroundColor: p.color }}
                  >
                    {p.avatar}
                  </span>
                  <div>
                    <div className="flex items-center gap-1 text-xs font-bold text-white">
                      <span>{p.name}</span>
                      {p.isCpu && (
                        <span className="px-1 py-0.2 bg-slate-700 text-[10px] rounded text-slate-300">
                          CPU
                        </span>
                      )}
                      {p.isMasterOverrideCpu && (
                        <span className="px-1 py-0.2 bg-amber-700 text-[10px] rounded text-amber-200">
                          代打
                        </span>
                      )}
                      {!p.isConnected && !p.isCpu && (
                        <span className="px-1 py-0.2 bg-rose-900 text-[10px] rounded text-rose-200">
                          離脱
                        </span>
                      )}
                      {p.hasNuisance && <span>👹</span>}
                    </div>
                    <div className="text-[11px] text-slate-400">
                      カード {p.cardCount}枚 ・ 目的地まで {p.distanceToDest}マス
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs font-bold text-emerald-400">
                    {formatMoney(p.money)}
                  </div>
                  <div className="text-[10px] text-slate-400">
                    総資産 {formatMoney(p.totalAssets)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
