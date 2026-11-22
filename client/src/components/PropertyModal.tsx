import React, { useMemo, useState } from 'react';
import { Building2, Check, X } from 'lucide-react';
import type { PublicGameState, StationDef } from '../types';
import { formatMoney } from './StatusBar';

interface PropertyModalProps {
  mode: 'buy' | 'portfolio';
  gameState: PublicGameState;
  myPlayerId: string;
  stations: StationDef[];
  onBuy: (propertyIds: string[], upgradeIds: string[]) => void;
  onSkip: () => void;
  onClose: () => void;
}

export const PropertyModal: React.FC<PropertyModalProps> = ({
  mode,
  gameState,
  myPlayerId,
  stations,
  onBuy,
  onSkip,
  onClose,
}) => {
  const me = gameState.players.find((p) => p.id === myPlayerId);
  const currentStation = stations.find((s) => s.id === me?.stationId);

  const [selectedBuy, setSelectedBuy] = useState<string[]>([]);
  const [selectedUpgrade, setSelectedUpgrade] = useState<string[]>([]);

  const totalCost = useMemo(() => {
    if (!currentStation?.properties) return 0;
    let sum = 0;
    for (const pid of selectedBuy) {
      const p = currentStation.properties.find((x) => x.id === pid);
      if (p) sum += p.price;
    }
    for (const pid of selectedUpgrade) {
      const p = currentStation.properties.find((x) => x.id === pid);
      if (p) sum += Math.floor(p.price * 0.8);
    }
    return sum;
  }, [currentStation, selectedBuy, selectedUpgrade]);

  const remainingMoney = (me?.money ?? 0) - totalCost;

  const toggleBuy = (pid: string, price: number) => {
    if (selectedBuy.includes(pid)) {
      setSelectedBuy((prev) => prev.filter((id) => id !== pid));
    } else if (remainingMoney >= price) {
      setSelectedBuy((prev) => [...prev, pid]);
    }
  };

  const toggleUpgrade = (pid: string, cost: number) => {
    if (selectedUpgrade.includes(pid)) {
      setSelectedUpgrade((prev) => prev.filter((id) => id !== pid));
    } else if (remainingMoney >= cost) {
      setSelectedUpgrade((prev) => [...prev, pid]);
    }
  };

  // 所持物件一覧（portfolioモード用）
  const myOwnedList = useMemo(() => {
    const result: {
      stationName: string;
      propName: string;
      category: string;
      price: number;
      rate: number;
      level: number;
      annualIncome: number;
    }[] = [];

    for (const owned of Object.values(gameState.ownedProperties)) {
      if (owned.ownerId !== myPlayerId) continue;
      const st = stations.find((s) => s.id === owned.stationId);
      const prop = st?.properties?.find((p) => p.id === owned.propertyId);
      if (!st || !prop) continue;
      const mult = owned.level === 1 ? 1 : owned.level === 2 ? 1.5 : 2.0;
      result.push({
        stationName: st.name,
        propName: prop.name,
        category: prop.category,
        price: prop.price,
        rate: prop.rate,
        level: owned.level,
        annualIncome: Math.round(prop.price * prop.rate * mult),
      });
    }
    return result;
  }, [gameState.ownedProperties, myPlayerId, stations]);

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
                    <div className="text-sm font-bold text-white">
                      {item.propName}{' '}
                      <span className="text-amber-400 text-xs">Lv.{item.level}</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs font-bold text-emerald-400">
                      +{formatMoney(item.annualIncome)}/年
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
            const upgradeCost = Math.floor(prop.price * 0.8);
            const isSelectedBuy = selectedBuy.includes(prop.id);
            const isSelectedUp = selectedUpgrade.includes(prop.id);

            return (
              <div
                key={prop.id}
                className={`p-3 rounded-2xl border transition ${
                  isSelectedBuy || isSelectedUp
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
                  ) : isMine && owned.level < 3 ? (
                    <button
                      onClick={() => toggleUpgrade(prop.id, upgradeCost)}
                      disabled={!isSelectedUp && remainingMoney < upgradeCost}
                      className={`px-3 py-2 rounded-xl text-xs font-extrabold flex items-center gap-1 transition ${
                        isSelectedUp
                          ? 'bg-amber-500 text-white'
                          : remainingMoney >= upgradeCost
                            ? 'bg-amber-600 hover:bg-amber-500 text-white'
                            : 'bg-slate-700 text-slate-500 cursor-not-allowed'
                      }`}
                    >
                      {isSelectedUp && <Check className="w-3.5 h-3.5" />}
                      増資 {formatMoney(upgradeCost)}
                    </button>
                  ) : (
                    <span className="px-2.5 py-1.5 rounded-xl bg-slate-700/70 text-[11px] text-slate-400 font-bold">
                      {isMine ? 'MAX Lv.3' : '他社所有'}
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
            onClick={() => onBuy(selectedBuy, selectedUpgrade)}
            disabled={selectedBuy.length === 0 && selectedUpgrade.length === 0}
            className="flex-1 py-3 rounded-2xl bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 disabled:text-slate-500 text-white font-extrabold text-sm shadow-lg"
          >
            購入確定 ({formatMoney(totalCost)})
          </button>
        </div>
      </div>
    </div>
  );
};
