import React from 'react';
import { ShoppingBag } from 'lucide-react';
import type { CardDef, PublicGameState } from '../types';
import { formatMoney } from './StatusBar';

interface CardShopModalProps {
  gameState: PublicGameState;
  myPlayerId: string;
  myCardCount: number;
  cardsMaster: CardDef[];
  onBuyCard: (cardId: string) => void;
  onSkip: () => void;
}

const SHOP_STOCK_IDS = [
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

export const CardShopModal: React.FC<CardShopModalProps> = ({
  gameState,
  myPlayerId,
  myCardCount,
  cardsMaster,
  onBuyCard,
  onSkip,
}) => {
  const me = gameState.players.find((p) => p.id === myPlayerId);
  const myMoney = me?.money ?? 0;
  const shopCards = SHOP_STOCK_IDS.map((id) => cardsMaster.find((c) => c.id === id)).filter(
    (c): c is CardDef => Boolean(c)
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
      <div className="w-full max-w-md bg-slate-900 border-2 border-amber-500/70 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        <div className="px-5 py-4 bg-gradient-to-r from-amber-700 to-orange-800 border-b border-amber-500/50">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-black text-white flex items-center gap-2">
              <ShoppingBag className="w-5 h-5" />
              🛒 カード売り場
            </h2>
            <span className="text-xs font-bold text-amber-100">
              手札 {myCardCount}/8
            </span>
          </div>
          <div className="text-xs text-amber-100 mt-1 font-bold">
            所持金: {formatMoney(myMoney)}
          </div>
        </div>

        <div className="p-4 overflow-y-auto space-y-2 flex-1">
          {shopCards.map((card) => {
            const price = card.price ?? 1500;
            const canAfford = myMoney >= price && myCardCount < 8;
            return (
              <div
                key={card.id}
                className="p-3 rounded-2xl bg-slate-800/90 border border-slate-700 flex items-center justify-between gap-2.5"
              >
                <div className="flex items-start gap-2.5">
                  <span className="text-2xl mt-0.5">{card.icon}</span>
                  <div>
                    <div className="text-sm font-extrabold text-white">{card.name}</div>
                    <div className="text-[11px] text-slate-400 leading-snug">
                      {card.description}
                    </div>
                  </div>
                </div>
                <button
                  disabled={!canAfford}
                  onClick={() => onBuyCard(card.id)}
                  className={`shrink-0 px-3 py-2 rounded-xl text-xs font-extrabold transition ${
                    canAfford
                      ? 'bg-amber-500 hover:bg-amber-400 active:scale-95 text-slate-950'
                      : 'bg-slate-700 text-slate-500 cursor-not-allowed'
                  }`}
                >
                  {formatMoney(price)}
                </button>
              </div>
            );
          })}
        </div>

        <div className="p-4 bg-slate-950/90 border-t border-slate-800">
          <div className="text-[11px] text-slate-400 text-center mb-2">
            お金と手札の空きがある限り、続けて何枚でも買えます
          </div>
          <button
            onClick={onSkip}
            className="w-full py-3 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-sm"
          >
            買い物を終える
          </button>
        </div>
      </div>
    </div>
  );
};
