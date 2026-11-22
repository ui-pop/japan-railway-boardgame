import { useState } from 'react';
import { Train, Users } from 'lucide-react';
import { ActionDock } from './components/ActionDock';
import { AdminPanel } from './components/AdminPanel';
import { CardModal } from './components/CardModal';
import { CardShopModal } from './components/CardShopModal';
import { EventOverlay } from './components/EventOverlay';
import { MapCanvas } from './components/MapCanvas';
import { PropertyModal } from './components/PropertyModal';
import { StatusBar } from './components/StatusBar';
import { useGameSocket } from './hooks/useGameSocket';
import { soundManager } from './utils/sound';

export function App() {
  const isAdmin = window.location.pathname.startsWith('/admin');

  const {
    connected,
    gameState,
    myPlayerId,
    myCards,
    stations,
    cardsMaster,
    eventsData,
    eventQueue,
    stamps,
    savesList,
    errorMsg,
    joinGame,
    renamePlayer,
    leaveLobby,
    reclaimPlayer,
    rollDice,
    useCard,
    moveStep,
    buyProperties,
    skipBuy,
    buyCardShop,
    skipCardShop,
    sendStamp,
    consumeFirstEvent,
    adminCreateGame,
    adminStartGame,
    adminAddCpu,
    adminRemovePlayer,
    adminTogglePause,
    adminToggleCpu,
    adminForceSkip,
    adminRollback,
    adminAdjustMoney,
    adminGiveCard,
    adminChangeDest,
    adminSetNuisance,
    adminAddLocalRule,
    adminToggleLocalRule,
    adminDeleteLocalRule,
    adminSaveNamed,
    adminLoadSave,
  } = useGameSocket(isAdmin);

  const [playerName, setPlayerName] = useState(
    () => localStorage.getItem('jrb_player_name') || ''
  );
  const [cardModalOpen, setCardModalOpen] = useState(false);
  const [portfolioModalOpen, setPortfolioModalOpen] = useState(false);
  const [bgmOn, setBgmOn] = useState(soundManager.bgmEnabled);
  const [seOn, setSeOn] = useState(soundManager.seEnabled);
  const [lowDataMode, setLowDataMode] = useState(false);
  const [focusTrigger, setFocusTrigger] = useState<{
    type: 'me' | 'dest' | 'all';
    seq: number;
  } | null>(null);

  if (isAdmin) {
    return (
      <AdminPanel
        connected={connected}
        gameState={gameState}
        stations={stations}
        cardsMaster={cardsMaster}
        eventsData={eventsData}
        savesList={savesList}
        onCreateGame={adminCreateGame}
        onStartGame={adminStartGame}
        onAddCpu={adminAddCpu}
        onRemovePlayer={adminRemovePlayer}
        onTogglePause={adminTogglePause}
        onToggleCpu={adminToggleCpu}
        onForceSkip={adminForceSkip}
        onRollback={adminRollback}
        onAdjustMoney={adminAdjustMoney}
        onGiveCard={adminGiveCard}
        onChangeDest={adminChangeDest}
        onSetNuisance={adminSetNuisance}
        onAddLocalRule={adminAddLocalRule}
        onToggleLocalRule={adminToggleLocalRule}
        onDeleteLocalRule={adminDeleteLocalRule}
        onSaveNamed={adminSaveNamed}
        onLoadSave={adminLoadSave}
      />
    );
  }

  // 未参加ロビー画面
  if (!myPlayerId || !gameState || gameState.status === 'waiting') {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-950 via-indigo-950 to-slate-950 text-white flex flex-col items-center justify-center p-5">
        <div className="w-full max-w-sm bg-slate-900/90 border border-slate-700 rounded-3xl p-6 shadow-2xl space-y-5">
          <div className="text-center">
            <div className="w-16 h-16 mx-auto rounded-2xl bg-sky-600/20 border border-sky-400/50 flex items-center justify-center mb-3">
              <Train className="w-9 h-9 text-sky-400" />
            </div>
            <h1 className="text-xl font-black tracking-tight">
              日本縦断鉄道ボードゲーム
            </h1>
            <p className="text-xs text-slate-400 mt-1">
              {connected ? '🟢 サーバー接続済み' : '🟡 サーバーへ接続中...'}
            </p>
          </div>

          {errorMsg && (
            <div className="p-3 rounded-xl bg-rose-950/80 border border-rose-500/60 text-xs text-rose-200 font-bold text-center">
              {errorMsg}
            </div>
          )}

          {!myPlayerId ? (
            gameState && gameState.status !== 'waiting' ? (
              /* ゲーム進行中に画面を閉じて開き直した場合のワンタップ途中復帰 */
              <div className="space-y-3">
                <div className="p-3 rounded-2xl bg-amber-950/60 border border-amber-500/50 text-xs text-amber-200 font-bold text-center">
                  ゲームは進行中です。離脱中の自分の席を選んで復帰できます！
                </div>
                {gameState.players.filter((p) => !p.isCpu && !p.isConnected).length === 0 ? (
                  <div className="text-center text-xs text-slate-400 py-4">
                    現在復帰できる離脱中の席がありません。
                  </div>
                ) : (
                  <div className="space-y-2">
                    {gameState.players
                      .filter((p) => !p.isCpu && !p.isConnected)
                      .map((p) => (
                        <button
                          key={p.id}
                          onClick={() => reclaimPlayer(p.id)}
                          className="w-full flex items-center justify-between p-3 rounded-2xl bg-slate-800 hover:bg-slate-700 active:scale-95 border border-sky-500/60 text-left"
                        >
                          <div className="flex items-center gap-2.5">
                            <span
                              className="w-9 h-9 rounded-full flex items-center justify-center text-lg border-2 border-white"
                              style={{ backgroundColor: p.color }}
                            >
                              {p.avatar}
                            </span>
                            <div>
                              <div className="text-sm font-black text-white">{p.name}</div>
                              <div className="text-[11px] text-slate-400">
                                目的地まで あと{p.distanceToDest}マス
                              </div>
                            </div>
                          </div>
                          <span className="px-3 py-1.5 rounded-xl bg-sky-600 text-white text-xs font-extrabold">
                            復帰する
                          </span>
                        </button>
                      ))}
                  </div>
                )}
              </div>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  joinGame(playerName || '社長');
                }}
                className="space-y-3"
              >
                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1.5">
                    社長名（末尾に自動で「社長」が付きます）
                  </label>
                  <input
                    type="text"
                    maxLength={10}
                    value={playerName}
                    onChange={(e) => setPlayerName(e.target.value)}
                    placeholder="例: たなか"
                    className="w-full px-4 py-3 rounded-2xl bg-slate-950 border border-slate-700 text-white text-base font-bold focus:outline-none focus:border-sky-500"
                  />
                </div>
                <button
                  type="submit"
                  disabled={!connected}
                  className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 disabled:opacity-50 font-extrabold text-base shadow-lg active:scale-95 transition"
                >
                  ゲームに参加する！
                </button>
              </form>
            )
          ) : (
            /* 待機画面：名前変更・退出が可能 */
            <div className="space-y-3">
              <div className="p-3 rounded-2xl bg-emerald-950/60 border border-emerald-500/40 text-sm font-bold text-emerald-300 text-center">
                参加完了！ホストの開始を待っています…
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  renamePlayer(playerName);
                }}
                className="flex gap-2"
              >
                <input
                  type="text"
                  maxLength={10}
                  value={playerName}
                  onChange={(e) => setPlayerName(e.target.value)}
                  placeholder="新しい名前"
                  className="flex-1 px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-sm text-white font-bold focus:outline-none focus:border-sky-500"
                />
                <button
                  type="submit"
                  className="px-3.5 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-xs font-extrabold text-white"
                >
                  名前変更
                </button>
              </form>
              <button
                onClick={leaveLobby}
                className="w-full py-2.5 rounded-xl bg-rose-950/80 hover:bg-rose-800 border border-rose-600/50 text-xs font-bold text-rose-200"
              >
                ロビーから退出する
              </button>
            </div>
          )}

          {gameState && (
            <div className="pt-3 border-t border-slate-800">
              <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
                <span className="flex items-center gap-1 font-bold">
                  <Users className="w-3.5 h-3.5" /> 待機中の社長
                </span>
                <span>
                  {gameState.players.length} / {gameState.config.maxPlayers}
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {gameState.players.map((p) => (
                  <span
                    key={p.id}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-slate-800 border border-slate-700"
                  >
                    <span>{p.avatar}</span>
                    <span style={{ color: p.color }}>{p.name}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  const isMyTurn =
    gameState.status === 'playing' && gameState.currentTurnPlayerId === myPlayerId;
  const showBuyModal = isMyTurn && gameState.phase === 'property_buy' && eventQueue.length === 0;
  const showCardShopModal = isMyTurn && gameState.phase === 'card_shop' && eventQueue.length === 0;

  return (
    <div className="fixed inset-0 overflow-hidden touch-none bg-slate-950">
      {/* ベースレイヤー: 全画面インタラクティブマップ */}
      <MapCanvas
        stations={stations}
        gameState={gameState}
        myPlayerId={myPlayerId}
        lowDataMode={lowDataMode}
        isPlayingPreTurnEffect={
          eventQueue.length > 0 && eventQueue[0].type !== 'turn_start'
        }
        warpFocusStationId={
          eventQueue[0]?.type === 'warp_move'
            ? String(eventQueue[0].payload.stationId ?? '')
            : null
        }
        onSelectNextStation={moveStep}
        focusTargetTrigger={focusTrigger}
      />

      {/* 上部ステータスバー */}
      <StatusBar
        gameState={gameState}
        myPlayerId={myPlayerId}
        stations={stations}
        bgmOn={bgmOn}
        seOn={seOn}
        lowDataMode={lowDataMode}
        onToggleBgm={() => {
          const next = !bgmOn;
          setBgmOn(next);
          soundManager.toggleBgm(next);
        }}
        onToggleSe={() => {
          const next = !seOn;
          setSeOn(next);
          soundManager.seEnabled = next;
        }}
        onToggleLowData={() => setLowDataMode((v) => !v)}
      />

      {/* 下部アクションドック */}
      <ActionDock
        gameState={gameState}
        myPlayerId={myPlayerId}
        stamps={eventsData?.stamps ?? []}
        onRollDice={rollDice}
        onOpenCards={() => setCardModalOpen(true)}
        onFocusWholeMap={() =>
          setFocusTrigger((prev) => ({ type: 'all', seq: (prev?.seq ?? 0) + 1 }))
        }
        onOpenPropertiesInfo={() => setPortfolioModalOpen(true)}
        onSendStamp={sendStamp}
      />

      {/* 物件購入モーダル（駅到着時） */}
      {showBuyModal && (
        <PropertyModal
          mode="buy"
          gameState={gameState}
          myPlayerId={myPlayerId}
          stations={stations}
          onBuy={buyProperties}
          onSkip={skipBuy}
          onClose={() => {}}
        />
      )}

      {/* カード売り場モーダル（ショップ駅到着時） */}
      {showCardShopModal && (
        <CardShopModal
          gameState={gameState}
          myPlayerId={myPlayerId}
          myCardCount={myCards.length}
          cardsMaster={cardsMaster}
          onBuyCard={buyCardShop}
          onSkip={skipCardShop}
        />
      )}

      {/* 所持物件一覧モーダル */}
      {portfolioModalOpen && !showBuyModal && (
        <PropertyModal
          mode="portfolio"
          gameState={gameState}
          myPlayerId={myPlayerId}
          stations={stations}
          onBuy={buyProperties}
          onSkip={skipBuy}
          onClose={() => setPortfolioModalOpen(false)}
        />
      )}

      {/* カードモーダル */}
      {cardModalOpen && (
        <CardModal
          myCards={myCards}
          cardsMaster={cardsMaster}
          gameState={gameState}
          myPlayerId={myPlayerId}
          canUseNow={isMyTurn && gameState.phase === 'action_select' && !gameState.cardUsedThisTurn}
          onUseCard={useCard}
          onClose={() => setCardModalOpen(false)}
        />
      )}

      {/* イベント演出・スタンプオーバーレイ */}
      <EventOverlay
        eventQueue={eventQueue}
        players={gameState.players}
        stamps={stamps}
        lowDataMode={lowDataMode}
        currentTurnPlayerId={gameState.currentTurnPlayerId}
        turnCount={gameState.turnCount}
        currentYear={gameState.currentYear}
        currentMonth={gameState.currentMonth}
        onConsumeEvent={consumeFirstEvent}
      />

      {/* エラー通知 */}
      {errorMsg && (
        <div className="fixed top-24 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full bg-rose-600 text-white text-xs font-bold shadow-xl">
          {errorMsg}
        </div>
      )}
    </div>
  );
}

export default App;
