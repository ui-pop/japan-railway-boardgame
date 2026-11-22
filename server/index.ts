import cors from 'cors';
import express from 'express';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { Server, Socket } from 'socket.io';
import { CpuAi } from './cpuAi';
import { GameEngine } from './gameEngine';
import { SaveManager } from './saveManager';
import { CardDef, EventsData, GameEventSeqItem, StationDef } from './types';

const PORT = Number(process.env.PORT) || 3000;
const ROOT_DIR = fs.existsSync(path.resolve(__dirname, '..', 'data'))
  ? path.resolve(__dirname, '..')
  : path.resolve(__dirname, '..', '..');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const SAVES_DIR = path.join(ROOT_DIR, 'saves');
const CLIENT_DIST_DIR = path.join(ROOT_DIR, 'client', 'dist');
const TUNNEL_URL_FILE = path.join(ROOT_DIR, 'tunnel_url.txt');
let activeTunnelUrl: string | null = null;

function getActiveTunnelUrl(): string | null {
  if (fs.existsSync(TUNNEL_URL_FILE)) {
    try {
      const url = fs.readFileSync(TUNNEL_URL_FILE, 'utf-8').trim();
      if (url.startsWith('http')) return url;
    } catch {
      // ignore
    }
  }
  return activeTunnelUrl;
}

const stations: StationDef[] = JSON.parse(
  fs.readFileSync(path.join(DATA_DIR, 'stations.json'), 'utf-8')
);
const cards: CardDef[] = JSON.parse(
  fs.readFileSync(path.join(DATA_DIR, 'cards.json'), 'utf-8')
);
const eventsData: EventsData = JSON.parse(
  fs.readFileSync(path.join(DATA_DIR, 'events.json'), 'utf-8')
);

const saveManager = new SaveManager(SAVES_DIR);
const engine = new GameEngine('ROOM-01', stations, cards, eventsData, saveManager, {
  totalYears: 3,
  initialMoney: 10000,
  cpuCount: 1,
  maxPlayers: 8,
});
engine.addCpuPlayer();
const cpuAi = new CpuAi(engine.pathfinder, cards, stations);

const app = express();
app.use(cors());
app.use(express.json());

function getLocalIpAddresses(): { ips: string[]; details: { name: string; ip: string }[] } {
  const interfaces = os.networkInterfaces();
  const candidates: { name: string; ip: string; score: number }[] = [];

  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] ?? []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        let score = 0;
        const lowerName = name.toLowerCase();
        // Wi-Fi や通常のLANを優先
        if (lowerName.includes('wi-fi') || lowerName.includes('wifi') || lowerName.includes('wlan')) {
          score += 100;
        }
        // 仮想アダプタ（VirtualBox, WSL, Hyper-V, VMware等）の優先度を下げる
        if (
          iface.mac?.startsWith('0a:00:27') ||
          iface.address.startsWith('192.168.56.') ||
          lowerName.includes('vethernet') ||
          lowerName.includes('virtual') ||
          lowerName.includes('wsl') ||
          lowerName.includes('docker') ||
          lowerName.includes('vmware')
        ) {
          score -= 100;
        }
        candidates.push({ name, ip: iface.address, score });
      }
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  return {
    ips: candidates.map((c) => c.ip),
    details: candidates.map(({ name, ip }) => ({ name, ip })),
  };
}

app.get('/api/master', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.json({ stations, cards, eventsData });
});

app.get('/api/network-info', (_req, res) => {
  const net = getLocalIpAddresses();
  const tunnelUrl = getActiveTunnelUrl();
  res.json({
    ips: net.ips,
    details: net.details,
    port: PORT,
    tunnelUrl,
  });
});

app.get('/api/saves', (_req, res) => {
  res.json({ saves: saveManager.listSaves() });
});

if (fs.existsSync(CLIENT_DIST_DIR)) {
  app.use(
    express.static(CLIENT_DIST_DIR, {
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('index.html')) {
          res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        }
      },
    })
  );
  app.get('*', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.sendFile(path.join(CLIENT_DIST_DIR, 'index.html'));
  });
}

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

let cpuTimer: NodeJS.Timeout | null = null;

function broadcastAll(lastEvents: GameEventSeqItem[] = []) {
  const publicState = engine.getPublicState();
  io.emit('game:state_sync', publicState);

  // 個別秘匿データ（手持ちカード）を各ソケット宛てのみ送信
  for (const p of engine.players) {
    if (p.socketId) {
      io.to(p.socketId).emit('player:private_sync', {
        playerId: p.id,
        cards: p.cards,
      });
    }
  }

  scheduleCpuIfNeeded(lastEvents);
}

function emitEventsAndSync(events: GameEventSeqItem[]) {
  if (events.length > 0) {
    io.emit('game:event_seq', events);
  }
  broadcastAll(events);
}

function scheduleCpuIfNeeded(lastEvents: GameEventSeqItem[] = []) {
  if (cpuTimer) {
    clearTimeout(cpuTimer);
    cpuTimer = null;
  }

  if (engine.status !== 'playing') return;
  const current = engine.getCurrentPlayer();
  if (!current) return;
  if (!current.isCpu && !current.isMasterOverrideCpu) return;

  // 桃鉄らしいゆったりした演出テンポの計算（ターン間アイキャッチ分も含めて余裕を持たせる）
  let delay = 2900; // デフォルト（ターン開始アイキャッチ後）
  const hasDiceRoll = lastEvents.some((e) => e.type === 'dice_roll');
  const hasBigEvent = lastEvents.some(
    (e) =>
      e.type === 'destination_reached' ||
      e.type === 'nuisance_action' ||
      e.type === 'nuisance_attach' ||
      e.type === 'random_event'
  );
  const hasStationEffect = lastEvents.some((e) => e.type === 'station_effect');
  const hasTurnStart = lastEvents.some((e) => e.type === 'turn_start');

  if (hasBigEvent && hasTurnStart) {
    delay = 5200; // 大イベント + 次ターンアイキャッチを両方見終わるまで待つ
  } else if (hasBigEvent) {
    delay = 3600;
  } else if (hasStationEffect && hasTurnStart) {
    delay = 4500; // マス演出 + 次ターンアイキャッチを両方見終わるまで待つ
  } else if (hasDiceRoll) {
    delay = 2700; // サイコロが回って確定するまで待つ
  } else if (hasTurnStart) {
    delay = 2600; // ターン開始アイキャッチが終わるまで待つ
  } else if (hasStationEffect) {
    delay = 2800;
  } else if (engine.phase === 'moving') {
    delay = 900; // 1マスずつ列車が走るテンポ
  } else if (engine.phase === 'property_buy' || engine.phase === 'card_shop') {
    delay = 1900;
  }

  cpuTimer = setTimeout(() => {
    if (engine.status !== 'playing') return;
    const active = engine.getCurrentPlayer();
    if (!active || (!active.isCpu && !active.isMasterOverrideCpu)) return;

    const decision = cpuAi.decideAction(active, engine.getPublicState());
    let events: GameEventSeqItem[] = [];

    if (decision.type === 'roll_dice') {
      events = engine.rollDice(active.id).events;
    } else if (decision.type === 'use_card') {
      events = engine.useCard(active.id, decision.cardIndex, decision.targetPlayerId).events;
    } else if (decision.type === 'move_step') {
      events = engine.moveStep(active.id, decision.nextStationId).events;
    } else if (decision.type === 'buy_properties') {
      events = engine.buyProperties(active.id, decision.propertyIds, decision.upgradeIds).events;
    } else if (decision.type === 'skip_buy') {
      events = engine.skipBuy(active.id).events;
    } else if (decision.type === 'buy_card_shop') {
      events = engine.buyCardFromShop(active.id, decision.cardId).events;
    } else if (decision.type === 'skip_card_shop') {
      events = engine.skipCardShop(active.id).events;
    }

    emitEventsAndSync(events);
  }, delay);
}

function getSocketPlayerId(socket: Socket, token?: string): string | null {
  const bySocket = engine.players.find((p) => p.socketId === socket.id);
  if (bySocket) return bySocket.id;
  if (token) {
    const byToken = engine.players.find((p) => p.token === token);
    if (byToken) {
      byToken.socketId = socket.id;
      byToken.isConnected = true;
      return byToken.id;
    }
  }
  return null;
}

io.on('connection', (socket) => {
  // 接続直後に現在状態を配信
  socket.emit('game:state_sync', engine.getPublicState());

  socket.on('player:join', (payload: { name?: string; token?: string; roomId?: string }) => {
    const result = engine.joinPlayer(payload?.name ?? '社長', socket.id, payload?.token);
    if ('error' in result) {
      socket.emit('player:join_error', { message: result.error });
      return;
    }

    socket.emit('player:joined', {
      playerId: result.player.id,
      token: result.player.token,
      roomId: engine.roomId,
      isReconnect: result.isReconnect,
    });
    broadcastAll();
  });

  socket.on('player:rename', (payload: { name: string; token?: string }) => {
    const pid = getSocketPlayerId(socket, payload?.token);
    if (!pid) return;
    const res = engine.renamePlayer(pid, payload.name ?? '');
    if (!res.ok) {
      socket.emit('game:error', { message: res.error });
      return;
    }
    broadcastAll();
  });

  socket.on('player:leave', (payload?: { token?: string }) => {
    const pid = getSocketPlayerId(socket, payload?.token);
    if (!pid) return;
    if (engine.leavePlayer(pid)) {
      socket.emit('player:left');
      broadcastAll();
    }
  });

  socket.on('player:reclaim', (payload: { playerId: string }) => {
    const res = engine.reclaimDisconnectedPlayer(payload.playerId, socket.id);
    if ('error' in res) {
      socket.emit('game:error', { message: res.error });
      return;
    }
    socket.emit('player:joined', {
      playerId: res.player.id,
      token: res.player.token,
      roomId: engine.roomId,
      isReconnect: true,
    });
    broadcastAll();
  });

  socket.on('player:roll_dice', (payload?: { token?: string }) => {
    const pid = getSocketPlayerId(socket, payload?.token);
    if (!pid) {
      socket.emit('game:error', { message: '接続が切れました。ページを再読み込みしてください。' });
      return;
    }
    const res = engine.rollDice(pid);
    if (!res.ok) {
      socket.emit('game:error', { message: res.error });
      return;
    }
    emitEventsAndSync(res.events);
  });

  socket.on('player:use_card', (payload: { cardIndex: number; targetPlayerId?: string; token?: string }) => {
    const pid = getSocketPlayerId(socket, payload?.token);
    if (!pid) {
      socket.emit('game:error', { message: '接続が切れました。ページを再読み込みしてください。' });
      return;
    }
    const res = engine.useCard(pid, payload.cardIndex, payload.targetPlayerId);
    if (!res.ok) {
      socket.emit('game:error', { message: res.error });
      return;
    }
    emitEventsAndSync(res.events);
  });

  socket.on('player:move_step', (payload: { nextStationId: string; token?: string }) => {
    const pid = getSocketPlayerId(socket, payload?.token);
    if (!pid) {
      socket.emit('game:error', { message: '接続が切れました。ページを再読み込みしてください。' });
      return;
    }
    const res = engine.moveStep(pid, payload.nextStationId);
    if (!res.ok) {
      socket.emit('game:error', { message: res.error });
      return;
    }
    emitEventsAndSync(res.events);
  });

  socket.on(
    'player:buy_properties',
    (payload: { propertyIds: string[]; upgradeIds: string[]; token?: string }) => {
      const pid = getSocketPlayerId(socket, payload?.token);
      if (!pid) return;
      const res = engine.buyProperties(pid, payload.propertyIds ?? [], payload.upgradeIds ?? []);
      if (!res.ok) {
        socket.emit('game:error', { message: res.error });
        return;
      }
      emitEventsAndSync(res.events);
    }
  );

  socket.on('player:skip_buy', (payload?: { token?: string }) => {
    const pid = getSocketPlayerId(socket, payload?.token);
    if (!pid) return;
    const res = engine.skipBuy(pid);
    if (!res.ok) {
      socket.emit('game:error', { message: res.error });
      return;
    }
    emitEventsAndSync(res.events);
  });

  socket.on('player:buy_card_shop', (payload: { cardId: string; token?: string }) => {
    const pid = getSocketPlayerId(socket, payload?.token);
    if (!pid) return;
    const res = engine.buyCardFromShop(pid, payload.cardId);
    if (!res.ok) {
      socket.emit('game:error', { message: res.error });
      return;
    }
    emitEventsAndSync(res.events);
  });

  socket.on('player:skip_card_shop', (payload?: { token?: string }) => {
    const pid = getSocketPlayerId(socket, payload?.token);
    if (!pid) return;
    const res = engine.skipCardShop(pid);
    if (!res.ok) {
      socket.emit('game:error', { message: res.error });
      return;
    }
    emitEventsAndSync(res.events);
  });

  socket.on('player:send_stamp', (payload: { stampId: string; token?: string }) => {
    const pid = getSocketPlayerId(socket, payload?.token);
    const player = engine.players.find((p) => p.id === pid);
    const stamp = eventsData.stamps.find((s) => s.id === payload.stampId);
    if (!player || !stamp) return;
    io.emit('game:stamp', {
      id: `${Date.now()}_${Math.random()}`,
      playerId: player.id,
      playerName: player.name,
      playerColor: player.color,
      stamp,
    });
  });

  // --- 管理者コンソール用イベント ---
  socket.on('admin:subscribe', () => {
    socket.emit('game:state_sync', engine.getPublicState());
    socket.emit('admin:saves_list', saveManager.listSaves());
  });

  socket.on(
    'admin:create_game',
    (payload: { totalYears: number; initialMoney: number; cpuCount: number }) => {
      if (cpuTimer) clearTimeout(cpuTimer);
      engine.resetGame({
        totalYears: Math.max(1, Math.min(99, Number(payload.totalYears) || 3)),
        initialMoney: Math.max(1000, Number(payload.initialMoney) || 10000),
        cpuCount: Math.max(0, Math.min(7, Number(payload.cpuCount) || 0)),
      });
      io.emit('game:reset_session');
      broadcastAll();
    }
  );

  socket.on('admin:add_cpu', () => {
    const res = engine.addCpuPlayer();
    if (!res.ok) {
      socket.emit('game:error', { message: res.error });
      return;
    }
    broadcastAll();
  });

  socket.on('admin:remove_player', (payload: { playerId: string }) => {
    if (engine.removePlayer(payload.playerId)) {
      broadcastAll();
    }
  });

  socket.on('admin:start_game', () => {
    const res = engine.startGame();
    if (!res.ok) {
      socket.emit('game:error', { message: res.error });
      return;
    }
    emitEventsAndSync(res.events);
    io.emit('admin:saves_list', saveManager.listSaves());
  });

  socket.on('admin:toggle_pause', () => {
    if (engine.status === 'playing') {
      engine.status = 'paused';
      if (cpuTimer) clearTimeout(cpuTimer);
    } else if (engine.status === 'paused') {
      engine.status = 'playing';
    }
    broadcastAll();
  });

  socket.on('admin:toggle_cpu', (payload: { playerId: string }) => {
    engine.toggleCpuOverride(payload.playerId);
    broadcastAll();
  });

  socket.on('admin:force_skip', () => {
    const res = engine.forceSkipTurn();
    if (res.ok) {
      emitEventsAndSync(res.events);
    }
  });

  socket.on('admin:rollback', () => {
    if (engine.rollbackTurn()) {
      broadcastAll();
    }
  });

  socket.on('admin:adjust_money', (payload: { playerId: string; delta: number }) => {
    if (engine.adminAdjustMoney(payload.playerId, Number(payload.delta) || 0)) {
      broadcastAll();
    }
  });

  socket.on('admin:give_card', (payload: { playerId: string; cardId: string }) => {
    if (engine.adminGiveCard(payload.playerId, payload.cardId)) {
      broadcastAll();
    }
  });

  socket.on('admin:change_dest', () => {
    engine.adminChangeDestination();
    broadcastAll();
  });

  socket.on('admin:set_nuisance', (payload: { playerId: string | null }) => {
    engine.adminSetNuisance(payload.playerId);
    broadcastAll();
  });

  socket.on('admin:add_local_rule', (payload) => {
    engine.addLocalRule(payload);
    broadcastAll();
  });

  socket.on('admin:toggle_local_rule', (payload: { ruleId: string }) => {
    engine.toggleLocalRule(payload.ruleId);
    broadcastAll();
  });

  socket.on('admin:delete_local_rule', (payload: { ruleId: string }) => {
    engine.deleteLocalRule(payload.ruleId);
    broadcastAll();
  });

  socket.on('admin:save_named', (payload: { label: string }) => {
    const snap = engine.createSnapshot();
    saveManager.saveNamed(snap, payload.label || `save_${Date.now()}`);
    io.emit('admin:saves_list', saveManager.listSaves());
  });

  socket.on('admin:load_save', (payload: { fileName: string }) => {
    const snap = saveManager.loadSave(payload.fileName);
    if (!snap) {
      socket.emit('game:error', { message: 'セーブデータの読み込みに失敗しました。' });
      return;
    }
    engine.loadFromSnapshot(snap);
    broadcastAll();
  });

  socket.on('disconnect', () => {
    const disconnected = engine.disconnectSocket(socket.id);
    if (disconnected) {
      broadcastAll();
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚄 Japan Railway Boardgame Server listening on http://localhost:${PORT}`);
});
