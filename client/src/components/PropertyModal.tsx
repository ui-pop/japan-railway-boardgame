import React, { useMemo, useState } from 'react';
import { Building2, Check, X } from 'lucide-react';
import type { PublicGameState, StationDef } from '../types';
import { formatMoney } from './StatusBar';

interface PropertyModalProps {
  mode: 'buy' | 'portfolio' | 'debt_sell';
  gameState: PublicGameState;
  myPlayerId: string;
  stations: StationDef[];
  onBuy: (propertyIds: string[], upgradeIds: string[]) => void;
  onSkip: () => void;
  onSellDebt?: (propertyIds: string[]) => void;
  onClose: () => void;
}

export const PropertyModal: React.FC<PropertyModalProps> = ({
  mode,
  gameState,
  myPlayerId,
  stations,
  onBuy,
  onSkip,
  onSellDebt,
  onClose,
}) => {
  const me = gameState.players.find((p) => p.id === myPlayerId);
  const currentStation = stations.find((s) => s.id === me?.stationId);

  const [selectedBuy, setSelectedBuy] = useState<string[]>([]);
  const [selectedSell, setSelectedSell] = useState<string[]>([]);

  const totalCost = useMemo(() => {
    if (!currentStation?.properties) return 0;
    let sum = 0;
    for (const pid of selectedBuy) {
      const p = currentStation.properties.find((x) => x.id === pid);
      if (p) sum += p.price;
    }
    return sum;
  }, [currentStation, selectedBuy]);

  const remainingMoney = (me?.money ?? 0) - totalCost;

  const toggleBuy = (pid: string, price: number) => {
    if (selectedBuy.includes(pid)) {
      setSelectedBuy((prev) => prev.filter((id) => id !== pid));
    } else if (remainingMoney >= price) {
      setSelectedBuy((prev) => [...prev, pid]);
    }
  };

  // 所持物件一覧（portfolio / debt_sell モード用）
  const myOwnedList = useMemo(() => {
    const result: {
      propertyId: string;
      stationName: string;
      propName: string;
      category: string;
      price: number;
      rate: number;
      level: number;
      isMonopolized: boolean;
      curseRate?: number;
      curseRemainingSettlements?: number;
      annualIncome: number;
      sellValue: number;
    }[] = [];

    for (const owned of Object.values(gameState.ownedProperties)) {
      if (owned.ownerId !== myPlayerId) continue;
      const st = stations.find((s) => s.id === owned.stationId);
      const prop = st?.properties?.find((p) => p.id === owned.propertyId);
      if (!st || !prop) continue;
      const isMono =
        st.properties && st.properties.length > 0
          ? st.properties.every((p) => gameState.ownedProperties[p.id]?.ownerId === myPlayerId)
          : false;
      const effectiveRate =
        owned.curseRate !== undefined ? owned.curseRate : prop.rate + (owned.level - 1) * 0.05;
      const annualIncome =
        owned.curseRate !== undefined
          ? Math.round(prop.price * owned.level * owned.curseRate)
          : Math.round(prop.price * owned.level * effectiveRate * (isMono ? 2.0 : 1.0));
      const sellValue = Math.floor(prop.price * owned.level * 0.5);
      result.push({
        propertyId: owned.propertyId,
        stationName: st.name,
        propName: prop.name,
        category: prop.category,
        price: prop.price,
        rate: effectiveRate,
        level: owned.level,
        isMonopolized: isMono,
        curseRate: owned.curseRate,
        curseRemainingSettlements: owned.curseRemainingSettlements,
        annualIncome,
        sellValue,
      });
    }
    return result;
  }, [gameState.ownedProperties, myPlayerId, stations]);

  if (mode === 'debt_sell') {
    const sellableList = myOwnedList.filter((item) => item.category !== '農林');
    const selectedRefund = sellableList
      .filter((item) => selectedSell.includes(item.propertyId))
      .reduce((acc, item) => acc + item.sellValue, 0);
    const currentMoney = me?.money ?? 0;
    const afterMoney = currentMoney + selectedRefund;
    const canConfirm = afterMoney >= 0 || selectedSell.length >= sellableList.length;

    const toggleSell = (pid: string) => {
      setSelectedSell((prev) =>
        prev.includes(pid) ? prev.filter((x) => x !== pid) : [...prev, pid]
      );
    };

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
        <div className="w-full max-w-md bg-slate-900 border-2 border-rose-500 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[86vh]">
          <div className="px-5 py-4 bg-gradient-to-r from-rose-900 to-red-950 border-b border-rose-700/60">
            <div className="text-xs text-rose-200 font-bold">💸 借金返済（評価額の半額で売却）</div>
            <h2 className="text-lg font-black text-white mt-0.5">
              売却する物件を選んでください
            </h2>
            <div className="mt-2 grid grid-cols-3 gap-2 text-xs bg-black/35 rounded-xl p-2">
              <div>
                <div className="text-[10px] text-slate-400">現在所持金</div>
                <div className="font-black text-rose-400">{formatMoney(currentMoney)}</div>
              </div>
              <div>
                <div className="text-[10px] text-slate-400">売却合計</div>
                <div className="font-black text-amber-300">+{formatMoney(selectedRefund)}</div>
              </div>
              <div>
                <div className="text-[10px] text-slate-400">売却後</div>
                <div
                  className={`font-black ${
                    afterMoney >= 0 ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {formatMoney(afterMoney)}
                </div>
              </div>
            </div>
          </div>

          <div className="p-4 overflow-y-auto space-y-2 flex-1">
            {myOwnedList.map((item) => {
              const isFarm = item.category === '農林';
              const checked = !isFarm && selectedSell.includes(item.propertyId);
              return (
                <button
                  key={item.propertyId}
                  disabled={isFarm}
                  onClick={() => !isFarm && toggleSell(item.propertyId)}
                  className={`w-full text-left flex items-center justify-between p-3 rounded-2xl border transition ${
                    isFarm
                      ? 'bg-emerald-950/40 border-emerald-700/50 opacity-75 cursor-not-allowed'
                      : checked
                        ? 'bg-rose-950/80 border-rose-400 shadow'
                        : 'bg-slate-800/80 border-slate-700 hover:bg-slate-800'
                  }`}
                >
                  <div>
                    <div className="text-[11px] text-sky-400 font-bold flex items-center gap-1.5">
                      <span>
                        {item.stationName}駅 ・ {item.category}
                      </span>
                      {isFarm && (
                        <span className="px-1.5 py-0.5 rounded bg-emerald-600/30 border border-emerald-400/60 text-emerald-200 text-[10px]">
                          🌾 売却免除
                        </span>
                      )}
                      {item.isMonopolized && (
                        <span className="px-1.5 py-0.5 rounded bg-amber-500/20 border border-amber-400/50 text-amber-300 text-[10px]">
                          👑独占中
                        </span>
                      )}
                    </div>
                    <div className="text-sm font-bold text-white">
                      {item.propName}
                    </div>
                    <div className="text-[10px] text-slate-400">
                      年間収益 {item.annualIncome >= 0 ? '+' : ''}
                      {formatMoney(item.annualIncome)}
                    </div>
                  </div>
                  <div className="text-right shrink-0 pl-2">
                    {isFarm ? (
                      <span className="px-2.5 py-1.5 rounded-xl bg-emerald-900/70 text-emerald-200 text-[11px] font-bold">
                        保護対象
                      </span>
                    ) : (
                      <div
                        className={`px-2.5 py-1.5 rounded-xl text-xs font-black flex items-center gap-1 ${
                          checked ? 'bg-rose-600 text-white' : 'bg-slate-700 text-amber-300'
                        }`}
                      >
                        {checked && <Check className="w-3.5 h-3.5" />}
                        +{formatMoney(item.sellValue)}
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          <div className="p-4 bg-slate-950/90 border-t border-slate-800 space-y-2">
            {!canConfirm && (
              <div className="text-[11px] text-rose-300 text-center font-bold">
                借金が0円以上になるまで（あと {formatMoney(Math.abs(afterMoney))} 分）選んでください
              </div>
            )}
            <button
              disabled={!canConfirm}
              onClick={() => onSellDebt?.(selectedSell)}
              className="w-full py-3 rounded-2xl bg-rose-600 hover:bg-rose-500 disabled:bg-slate-700 disabled:text-slate-500 text-white font-black text-sm shadow-lg"
            >
              選択した {selectedSell.length} 件を売却して返済する
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (mode === 'portfolio') {
    const totalAnnual = myOwnedList.reduce((acc, x) => acc + x.annualIncome, 0);
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
        <div className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[82vh]">
          <div className="px-5 py-4 bg-slate-800/90 border-b border-slate-700 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Building2 className="w-5 h-5 text-emerald-400" />
              <h2 className="text-base font-extrabold text-white">所持物件一覧</h2>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-full bg-slate-700 text-slate-300">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="px-5 py-3 bg-emerald-950/50 border-b border-emerald-800/40 flex justify-between text-xs">
            <span className="text-slate-300">所有件数: {myOwnedList.length}件</span>
            <span className="font-bold text-emerald-400">
              年間予想収益: +{formatMoney(totalAnnual)}
            </span>
          </div>

          <div className="p-4 overflow-y-auto space-y-2 flex-1">
            {myOwnedList.length === 0 ? (
              <div className="text-center text-slate-400 py-10 text-sm">
                まだ物件を所有していません。
              </div>
            ) : (
              myOwnedList.map((item, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between p-3 rounded-2xl bg-slate-800/80 border border-slate-700"
                >
                  <div>
                    <div className="text-[11px] text-sky-400 font-bold">
                      {item.stationName}駅 ・ {item.category}
                    </div>
                    <div className="text-sm font-bold text-white flex items-center gap-1.5 flex-wrap">
                      <span>{item.propName}</span>
                      <span className="text-amber-400 text-xs">Lv.{item.level}</span>
                      {item.curseRate !== undefined && (
                        <span className="px-1.5 py-0.5 rounded bg-rose-900/90 border border-rose-500 text-rose-200 text-[10px] font-black">
                          📉 呪い {Math.round(item.curseRate * 100)}% (あと{item.curseRemainingSettlements ?? 1}期)
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <div
                      className={`text-xs font-bold ${
                        item.annualIncome < 0 ? 'text-rose-400' : 'text-emerald-400'
                      }`}
                    >
                      {item.annualIncome >= 0 ? '+' : ''}
                      {formatMoney(item.annualIncome)}/年
                    </div>
                    <div className="text-[10px] text-slate-400">
                      評価額 {formatMoney(item.price * item.level)}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    );
  }

  // mode === 'buy'
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
      <div className="w-full max-w-md bg-slate-900 border border-sky-500/50 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        <div className="px-5 py-4 bg-gradient-to-r from-sky-900 to-indigo-900 border-b border-sky-700/60">
          <div className="text-xs text-sky-300 font-bold">物件駅に到着！</div>
          <h2 className="text-xl font-extrabold text-white">
            🏢 {currentStation?.name}駅
          </h2>
          <div className="mt-1 flex justify-between text-xs text-slate-200">
            <span>所持金: {formatMoney(me?.money ?? 0)}</span>
            <span className={remainingMoney < 0 ? 'text-rose-400 font-bold' : 'text-emerald-300 font-bold'}>
              購入後: {formatMoney(remainingMoney)}
            </span>
          </div>
        </div>

        <div className="p-4 overflow-y-auto space-y-2.5 flex-1">
          {currentStation?.properties?.map((prop) => {
            const owned = gameState.ownedProperties[prop.id];
            const ownerPlayer = owned
              ? gameState.players.find((p) => p.id === owned.ownerId)
              : null;
            const isMine = owned?.ownerId === myPlayerId;
            const isSelectedBuy = selectedBuy.includes(prop.id);

            return (
              <div
                key={prop.id}
                className={`p-3 rounded-2xl border transition ${
                  isSelectedBuy
                    ? 'bg-sky-950/80 border-sky-400'
                    : 'bg-slate-800/80 border-slate-700'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-[11px] text-slate-400">
                      {prop.category} ・ 収益率 {Math.round(prop.rate * 100)}%
                    </div>
                    <div className="text-sm font-extrabold text-white">{prop.name}</div>
                    {owned && (
                      <div className="text-xs mt-1 font-bold" style={{ color: ownerPlayer?.color }}>
                        所有者: {ownerPlayer?.name} (Lv.{owned.level})
                      </div>
                    )}
                  </div>

                  {!owned ? (
                    <button
                      onClick={() => toggleBuy(prop.id, prop.price)}
                      disabled={!isSelectedBuy && remainingMoney < prop.price}
                      className={`px-3 py-2 rounded-xl text-xs font-extrabold flex items-center gap-1 transition ${
                        isSelectedBuy
                          ? 'bg-sky-500 text-white'
                          : remainingMoney >= prop.price
                            ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                            : 'bg-slate-700 text-slate-500 cursor-not-allowed'
                      }`}
                    >
                      {isSelectedBuy && <Check className="w-3.5 h-3.5" />}
                      {formatMoney(prop.price)}
                    </button>
                  ) : (
                    <span className="px-2.5 py-1.5 rounded-xl bg-slate-700/70 text-[11px] text-slate-400 font-bold">
                      {isMine ? '所有済み' : '他社所有'}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="p-4 bg-slate-950/90 border-t border-slate-800 flex gap-2">
          <button
            onClick={onSkip}
            className="flex-1 py-3 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-sm"
          >
            買わずに終了
          </button>
          <button
            onClick={() => onBuy(selectedBuy, [])}
            disabled={selectedBuy.length === 0}
            className="flex-1 py-3 rounded-2xl bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 disabled:text-slate-500 text-white font-extrabold text-sm shadow-lg"
          >
            購入確定 ({formatMoney(totalCost)})
          </button>
        </div>
      </div>
    </div>
  );
};
