import React, { useState } from 'react';
import { CreditCard, X } from 'lucide-react';
import type { CardDef, PublicGameState } from '../types';

interface CardModalProps {
  myCards: string[];
  cardsMaster: CardDef[];
  gameState: PublicGameState;
  myPlayerId: string;
  canUseNow: boolean;
  onUseCard: (cardIndex: number, targetPlayerId?: string) => void;
  onClose: () => void;
}

export const CardModal: React.FC<CardModalProps> = ({
  myCards,
  cardsMaster,
  gameState,
  myPlayerId,
  canUseNow,
  onUseCard,
  onClose,
}) => {
  const [targetSelectIdx, setTargetSelectIdx] = useState<number | null>(null);
  const cardMap = new Map(cardsMaster.map((c) => [c.id, c]));

  const rivals = gameState.players.filter((p) => p.id !== myPlayerId);

  if (targetSelectIdx !== null) {
    const chosenCard = cardMap.get(myCards[targetSelectIdx]);
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
        <div className="w-full max-w-md bg-slate-900 border border-amber-500/50 rounded-3xl shadow-2xl overflow-hidden">
          <div className="px-5 py-4 bg-slate-800 border-b border-slate-700 flex items-center justify-between">
            <div>
              <div className="text-xs text-amber-400 font-bold">対象を選択</div>
              <h3 className="text-base font-extrabold text-white">
                {chosenCard?.icon} {chosenCard?.name}
              </h3>
            </div>
            <button
              onClick={() => setTargetSelectIdx(null)}
              className="p-1.5 rounded-full bg-slate-700 text-slate-300"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="p-4 space-y-2 max-h-[60vh] overflow-y-auto">
            {rivals.map((r) => (
              <button
                key={r.id}
                onClick={() => {
                  onUseCard(targetSelectIdx, r.id);
                  setTargetSelectIdx(null);
                  onClose();
                }}
                className="w-full flex items-center justify-between p-3 rounded-2xl bg-slate-800 hover:bg-slate-700 border border-slate-600 text-left"
              >
                <div className="flex items-center gap-2.5">
                  <span
                    className="w-8 h-8 rounded-full flex items-center justify-center border border-white"
                    style={{ backgroundColor: r.color }}
                  >
                    {r.avatar}
                  </span>
                  <div>
                    <div className="text-sm font-bold text-white">{r.name}</div>
                    <div className="text-xs text-slate-400">
                      {r.rank}位 ・ 目的地まで {r.distanceToDest}マス
                    </div>
                  </div>
                </div>
                <span className="px-3 py-1 rounded-xl bg-rose-600 text-white text-xs font-bold">
                  選択
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
      <div className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[82vh]">
        <div className="px-5 py-4 bg-slate-800/90 border-b border-slate-700 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CreditCard className="w-5 h-5 text-amber-400" />
            <h2 className="text-base font-extrabold text-white">
              手持ちカード ({myCards.length}/8)
            </h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-full bg-slate-700 text-slate-300">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 overflow-y-auto space-y-2.5 flex-1">
          {myCards.length === 0 ? (
            <div className="text-center text-slate-400 py-10 text-sm">
              カードを1枚も持っていません。
            </div>
          ) : (
            myCards.map((cid, idx) => {
              const card = cardMap.get(cid);
              if (!card) return null;
              const usable = canUseNow && !card.passive;
              return (
                <div
                  key={`${cid}_${idx}`}
                  className="p-3 rounded-2xl bg-slate-800/90 border border-slate-700 flex items-center justify-between gap-3"
                >
                  <div className="flex items-start gap-2.5">
                    <span className="text-2xl mt-0.5">{card.icon}</span>
                    <div>
                      <div className="text-sm font-extrabold text-white">{card.name}</div>
                      <div className="text-xs text-slate-400 leading-snug mt-0.5">
                        {card.description}
                      </div>
                    </div>
                  </div>
                  {card.passive ? (
                    <span className="shrink-0 px-2.5 py-1 rounded-xl bg-slate-700 text-[11px] text-sky-300 font-bold">
                      自動発動
                    </span>
                  ) : (
                    <button
                      disabled={!usable}
                      onClick={() => {
                        if (card.requiresTarget) {
                          setTargetSelectIdx(idx);
                        } else {
                          onUseCard(idx);
                          onClose();
                        }
                      }}
                      className={`shrink-0 px-3.5 py-2 rounded-xl text-xs font-extrabold transition ${
                        usable
                          ? 'bg-amber-500 hover:bg-amber-400 active:scale-95 text-slate-950'
                          : 'bg-slate-700 text-slate-500 cursor-not-allowed'
                      }`}
                    >
                      使う
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
