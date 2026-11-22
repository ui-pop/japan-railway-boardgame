import React, { useState } from 'react';
import {
  Building2,
  CreditCard,
  Dices,
  Map as MapIcon,
  MessageCircle,
  Send,
} from 'lucide-react';
import type { PublicGameState } from '../types';

interface ActionDockProps {
  gameState: PublicGameState;
  myPlayerId: string | null;
  onRollDice: () => void;
  onOpenCards: () => void;
  onFocusWholeMap: () => void;
  onOpenPropertiesInfo: () => void;
  onSendComment: (text: string) => void;
}

export const ActionDock: React.FC<ActionDockProps> = ({
  gameState,
  myPlayerId,
  onRollDice,
  onOpenCards,
  onFocusWholeMap,
  onOpenPropertiesInfo,
  onSendComment,
}) => {
  const [commentOpen, setCommentOpen] = useState(false);
  const [commentText, setCommentText] = useState('');

  const isMyTurn =
    gameState.status === 'playing' && gameState.currentTurnPlayerId === myPlayerId;

  const submitComment = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = commentText.trim();
    if (!trimmed) return;
    onSendComment(trimmed);
    setCommentText('');
    setCommentOpen(false);
  };

  return (
    <div className="fixed bottom-0 left-0 right-0 z-30 pointer-events-none">
      {/* 短いコメント入力バー */}
      {commentOpen && (
        <form
          onSubmit={submitComment}
          className="pointer-events-auto mx-3 mb-2 p-2 rounded-2xl bg-slate-900/95 border border-sky-500/60 shadow-2xl flex items-center gap-2"
        >
          <input
            type="text"
            maxLength={30}
            autoFocus
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            placeholder="ひとことコメント（30文字まで）"
            className="flex-1 px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-sm text-white font-bold focus:outline-none focus:border-sky-400"
          />
          <button
            type="submit"
            disabled={!commentText.trim()}
            className="shrink-0 px-3.5 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 disabled:bg-slate-700 disabled:text-slate-500 text-white text-xs font-extrabold flex items-center gap-1 active:scale-95"
          >
            <Send className="w-3.5 h-3.5" />
            送信
          </button>
        </form>
      )}

      <div className="pointer-events-auto bg-gradient-to-t from-amber-100/95 to-yellow-50/95 backdrop-blur-md border-t-4 border-red-600 px-3 pt-2.5 pb-4 shadow-[0_-8px_30px_rgba(0,0,0,0.35)]">
        {/* 自分のターン：移動中 */}
        {isMyTurn && gameState.phase === 'moving' ? (
          <div className="flex items-center justify-between gap-2">
            <div className="flex-1 bg-white border-3 border-sky-500 rounded-2xl px-4 py-2.5 flex items-center justify-between shadow">
              <div className="text-base font-black text-slate-900">
                あと <span className="text-red-600 text-2xl">{gameState.remainingSteps}</span> マス
              </div>
              <div className="text-xs text-sky-700 font-bold text-right">
                マスをタップ
                <br />
                <span className="text-orange-600">オレンジで戻る</span>
              </div>
            </div>
            <button
              onClick={() => setCommentOpen((v) => !v)}
              title="コメントを送る"
              className="p-3.5 rounded-2xl bg-sky-500 border-b-4 border-sky-700 text-white active:scale-95 shadow"
            >
              <MessageCircle className="w-6 h-6" />
            </button>
          </div>
        ) : isMyTurn && gameState.phase === 'action_select' ? (
          /* 自分のターン：桃鉄風立体コマンド4ボタン */
          <div className="space-y-2">
            <div className="grid grid-cols-4 gap-2">
              <button
                onClick={onRollDice}
                className="flex flex-col items-center justify-center py-3 px-1 rounded-2xl bg-gradient-to-b from-red-500 to-red-600 hover:from-red-400 hover:to-red-500 active:translate-y-0.5 text-white font-black shadow-lg border-b-4 border-red-800"
              >
                <Dices className="w-6 h-6 mb-1" />
                <span className="text-xs">サイコロ</span>
              </button>

              <button
                onClick={onOpenCards}
                className="flex flex-col items-center justify-center py-3 px-1 rounded-2xl bg-gradient-to-b from-amber-400 to-amber-500 hover:from-amber-300 hover:to-amber-400 active:translate-y-0.5 text-slate-950 font-black shadow-lg border-b-4 border-amber-700"
              >
                <CreditCard className="w-6 h-6 mb-1" />
                <span className="text-xs">カード</span>
              </button>

              <button
                onClick={onFocusWholeMap}
                className="flex flex-col items-center justify-center py-3 px-1 rounded-2xl bg-gradient-to-b from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500 active:translate-y-0.5 text-white font-black shadow-lg border-b-4 border-blue-800"
              >
                <MapIcon className="w-6 h-6 mb-1" />
                <span className="text-xs">マップ</span>
              </button>

              <button
                onClick={onOpenPropertiesInfo}
                className="flex flex-col items-center justify-center py-3 px-1 rounded-2xl bg-gradient-to-b from-emerald-500 to-green-600 hover:from-emerald-400 hover:to-green-500 active:translate-y-0.5 text-white font-black shadow-lg border-b-4 border-green-800"
              >
                <Building2 className="w-6 h-6 mb-1" />
                <span className="text-xs">物件</span>
              </button>
            </div>
            {gameState.cardUsedThisTurn && (
              <div className="text-center text-[11px] font-bold text-amber-800">
                このターンはカードを使用済み。サイコロを振ってください
              </div>
            )}
          </div>
        ) : (
          /* 他人のターン（待機中） */
          <div className="flex items-center gap-2">
            <button
              onClick={onOpenCards}
              className="flex-1 flex items-center justify-center gap-1.5 py-3 rounded-xl bg-amber-400 hover:bg-amber-300 active:scale-95 border-b-4 border-amber-600 text-xs font-black text-slate-950 shadow"
            >
              <CreditCard className="w-4 h-4" />
              手持ちカード
            </button>
            <button
              onClick={onOpenPropertiesInfo}
              className="flex-1 flex items-center justify-center gap-1.5 py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 active:scale-95 border-b-4 border-emerald-700 text-xs font-black text-white shadow"
            >
              <Building2 className="w-4 h-4" />
              所持物件
            </button>
            <button
              onClick={() => setCommentOpen((v) => !v)}
              className="px-4 py-3 rounded-xl bg-sky-600 hover:bg-sky-500 active:scale-95 border-b-4 border-sky-800 text-xs font-black text-white flex items-center gap-1 shadow"
            >
              <MessageCircle className="w-4 h-4" />
              コメント
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
