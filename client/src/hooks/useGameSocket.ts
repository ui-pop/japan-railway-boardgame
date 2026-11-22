import { useCallback, useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import type {
  CardDef,
  EventsData,
  GameEventSeqItem,
  PublicGameState,
  SaveFileInfo,
  StampBroadcast,
  StationDef,
} from '../types';

const TOKEN_KEY = 'jrb_player_token';
const ROOM_KEY = 'jrb_room_id';
const NAME_KEY = 'jrb_player_name';

export function useGameSocket(isAdmin: boolean) {
  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [gameState, setGameState] = useState<PublicGameState | null>(null);
  const [myPlayerId, setMyPlayerId] = useState<string | null>(null);
  const [myCards, setMyCards] = useState<string[]>([]);
  const [stations, setStations] = useState<StationDef[]>([]);
  const [cardsMaster, setCardsMaster] = useState<CardDef[]>([]);
  const [eventsData, setEventsData] = useState<EventsData | null>(null);
  const [eventQueue, setEventQueue] = useState<GameEventSeqItem[]>([]);
  const [stamps, setStamps] = useState<StampBroadcast[]>([]);
  const [savesList, setSavesList] = useState<SaveFileInfo[]>([]);
  const [adminPlayersCards, setAdminPlayersCards] = useState<Record<string, string[]>>({});
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // マスターデータ取得（キャッシュ無効化）
  useEffect(() => {
    fetch(`/api/master?t=${Date.now()}`, { cache: 'no-store' })
      .then((res) => res.json())
      .then((data) => {
        setStations(data.stations ?? []);
        setCardsMaster(data.cards ?? []);
        setEventsData(data.eventsData ?? null);
      })
      .catch((err) => console.error('Failed to load master data', err));
  }, []);

  useEffect(() => {
    const socket = io({
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      if (isAdmin) {
        socket.emit('admin:subscribe');
      } else {
        const savedToken = localStorage.getItem(TOKEN_KEY);
        const savedName = localStorage.getItem(NAME_KEY) || '社長';
        if (savedToken) {
          socket.emit('player:join', {
            name: savedName,
            token: savedToken,
            roomId: localStorage.getItem(ROOM_KEY) ?? undefined,
          });
        }
      }
    });

    socket.on('disconnect', () => {
      setConnected(false);
    });

    socket.on('game:state_sync', (state: PublicGameState) => {
      setGameState(state);
    });

    socket.on('player:private_sync', (data: { playerId: string; cards: string[] }) => {
      setMyPlayerId(data.playerId);
      setMyCards(data.cards);
    });

    socket.on(
      'player:joined',
      (data: { playerId: string; token: string; roomId: string; isReconnect: boolean }) => {
        setMyPlayerId(data.playerId);
        localStorage.setItem(TOKEN_KEY, data.token);
        localStorage.setItem(ROOM_KEY, data.roomId);
        setErrorMsg(null);
      }
    );

    socket.on('player:join_error', (data: { message: string }) => {
      // 古いトークンで失敗した場合はトークンを消してロビー入力に戻す
      localStorage.removeItem(TOKEN_KEY);
      setMyPlayerId(null);
      setErrorMsg(data.message);
    });

    socket.on('player:left', () => {
      localStorage.removeItem(TOKEN_KEY);
      setMyPlayerId(null);
      setMyCards([]);
      setErrorMsg(null);
    });

    socket.on('game:reset_session', () => {
      if (!isAdmin) {
        localStorage.removeItem(TOKEN_KEY);
        setMyPlayerId(null);
        setMyCards([]);
      }
    });

    socket.on('game:error', (data: { message: string }) => {
      setErrorMsg(data.message);
      setTimeout(() => setErrorMsg(null), 3500);
    });

    socket.on('game:event_seq', (events: GameEventSeqItem[]) => {
      setEventQueue((prev) => [...prev, ...events]);
    });

    socket.on('game:stamp', (stamp: StampBroadcast) => {
      setStamps((prev) => [...prev.slice(-4), stamp]);
      setTimeout(() => {
        setStamps((prev) => prev.filter((s) => s.id !== stamp.id));
      }, 3000);
    });

    socket.on('admin:saves_list', (list: SaveFileInfo[]) => {
      setSavesList(list);
    });

    socket.on('admin:players_cards', (cardsMap: Record<string, string[]>) => {
      setAdminPlayersCards(cardsMap);
    });

    return () => {
      socket.disconnect();
    };
  }, [isAdmin]);

  const joinGame = useCallback((name: string) => {
    const trimmed = name.trim() || '社長';
    localStorage.setItem(NAME_KEY, trimmed);
    socketRef.current?.emit('player:join', {
      name: trimmed,
      token: localStorage.getItem(TOKEN_KEY) ?? undefined,
    });
  }, []);

  const renamePlayer = useCallback((name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    localStorage.setItem(NAME_KEY, trimmed);
    socketRef.current?.emit('player:rename', {
      name: trimmed,
      token: localStorage.getItem(TOKEN_KEY) ?? undefined,
    });
  }, []);

  const leaveLobby = useCallback(() => {
    socketRef.current?.emit('player:leave', {
      token: localStorage.getItem(TOKEN_KEY) ?? undefined,
    });
  }, []);

  const reclaimPlayer = useCallback((playerId: string) => {
    socketRef.current?.emit('player:reclaim', { playerId });
  }, []);

  const rollDice = useCallback(() => {
    socketRef.current?.emit('player:roll_dice', {
      token: localStorage.getItem(TOKEN_KEY) ?? undefined,
    });
  }, []);

  const useCard = useCallback((cardIndex: number, targetPlayerId?: string) => {
    socketRef.current?.emit('player:use_card', {
      cardIndex,
      targetPlayerId,
      token: localStorage.getItem(TOKEN_KEY) ?? undefined,
    });
  }, []);

  const moveStep = useCallback((nextStationId: string) => {
    socketRef.current?.emit('player:move_step', {
      nextStationId,
      token: localStorage.getItem(TOKEN_KEY) ?? undefined,
    });
  }, []);

  const buyProperties = useCallback((propertyIds: string[], upgradeIds: string[]) => {
    socketRef.current?.emit('player:buy_properties', {
      propertyIds,
      upgradeIds,
      token: localStorage.getItem(TOKEN_KEY) ?? undefined,
    });
  }, []);

  const skipBuy = useCallback(() => {
    socketRef.current?.emit('player:skip_buy', {
      token: localStorage.getItem(TOKEN_KEY) ?? undefined,
    });
  }, []);

  const buyCardShop = useCallback((cardId: string) => {
    socketRef.current?.emit('player:buy_card_shop', {
      cardId,
      token: localStorage.getItem(TOKEN_KEY) ?? undefined,
    });
  }, []);

  const skipCardShop = useCallback(() => {
    socketRef.current?.emit('player:skip_card_shop', {
      token: localStorage.getItem(TOKEN_KEY) ?? undefined,
    });
  }, []);

  const sellDebtProperties = useCallback((propertyIds: string[]) => {
    socketRef.current?.emit('player:sell_debt_properties', {
      propertyIds,
      token: localStorage.getItem(TOKEN_KEY) ?? undefined,
    });
  }, []);

  const sendStamp = useCallback((stampId: string) => {
    socketRef.current?.emit('player:send_stamp', {
      stampId,
      token: localStorage.getItem(TOKEN_KEY) ?? undefined,
    });
  }, []);

  const consumeFirstEvent = useCallback(() => {
    setEventQueue((prev) => prev.slice(1));
  }, []);

  // Admin actions
  const adminCreateGame = useCallback(
    (totalYears: number, initialMoney: number, cpuCount: number) => {
      socketRef.current?.emit('admin:create_game', {
        totalYears,
        initialMoney,
        cpuCount,
      });
    },
    []
  );

  const adminStartGame = useCallback(() => {
    socketRef.current?.emit('admin:start_game');
  }, []);

  const adminAddCpu = useCallback(() => {
    socketRef.current?.emit('admin:add_cpu');
  }, []);

  const adminRemovePlayer = useCallback((playerId: string) => {
    socketRef.current?.emit('admin:remove_player', { playerId });
  }, []);

  const adminTogglePause = useCallback(() => {
    socketRef.current?.emit('admin:toggle_pause');
  }, []);

  const adminToggleCpu = useCallback((playerId: string) => {
    socketRef.current?.emit('admin:toggle_cpu', { playerId });
  }, []);

  const adminForceSkip = useCallback(() => {
    socketRef.current?.emit('admin:force_skip');
  }, []);

  const adminRollback = useCallback(() => {
    socketRef.current?.emit('admin:rollback');
  }, []);

  const adminAdjustMoney = useCallback((playerId: string, delta: number) => {
    socketRef.current?.emit('admin:adjust_money', { playerId, delta });
  }, []);

  const adminGiveCard = useCallback((playerId: string, cardId: string) => {
    socketRef.current?.emit('admin:give_card', { playerId, cardId });
  }, []);

  const adminGiveCardAll = useCallback((cardId: string) => {
    socketRef.current?.emit('admin:give_card_all', { cardId });
  }, []);

  const adminRemoveCard = useCallback((playerId: string, cardIndex: number) => {
    socketRef.current?.emit('admin:remove_card', { playerId, cardIndex });
  }, []);

  const adminWarpPlayer = useCallback((playerId: string, stationId: string) => {
    socketRef.current?.emit('admin:warp_player', { playerId, stationId });
  }, []);

  const adminChangeDest = useCallback((stationId?: string) => {
    socketRef.current?.emit('admin:change_dest', { stationId });
  }, []);

  const adminBroadcastMessage = useCallback(
    (title: string, message: string, targetPlayerId?: string) => {
      socketRef.current?.emit('admin:broadcast_message', {
        title,
        message,
        targetPlayerId,
      });
    },
    []
  );

  const adminSetNuisance = useCallback((playerId: string | null) => {
    socketRef.current?.emit('admin:set_nuisance', { playerId });
  }, []);

  const adminAddLocalRule = useCallback((rule: Record<string, unknown>) => {
    socketRef.current?.emit('admin:add_local_rule', rule);
  }, []);

  const adminToggleLocalRule = useCallback((ruleId: string) => {
    socketRef.current?.emit('admin:toggle_local_rule', { ruleId });
  }, []);

  const adminDeleteLocalRule = useCallback((ruleId: string) => {
    socketRef.current?.emit('admin:delete_local_rule', { ruleId });
  }, []);

  const adminSaveNamed = useCallback((label: string) => {
    socketRef.current?.emit('admin:save_named', { label });
  }, []);

  const adminLoadSave = useCallback((fileName: string) => {
    socketRef.current?.emit('admin:load_save', { fileName });
  }, []);

  return {
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
    adminPlayersCards,
    errorMsg,
    clearError: () => setErrorMsg(null),
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
    sellDebtProperties,
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
    adminGiveCardAll,
    adminRemoveCard,
    adminWarpPlayer,
    adminChangeDest,
    adminBroadcastMessage,
    adminSetNuisance,
    adminAddLocalRule,
    adminToggleLocalRule,
    adminDeleteLocalRule,
    adminSaveNamed,
    adminLoadSave,
  };
}
