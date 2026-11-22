import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Compass, Crosshair, Maximize2 } from 'lucide-react';
import { GRID_SIZE, JAPAN_LAND_CELLS } from '../data/japanPolygons';
import type { PublicGameState, StationDef } from '../types';

interface MapCanvasProps {
  stations: StationDef[];
  gameState: PublicGameState | null;
  myPlayerId: string | null;
  lowDataMode: boolean;
  isPlayingPreTurnEffect?: boolean;
  warpFocusStationId?: string | null;
  onSelectNextStation: (stationId: string) => void;
  focusTargetTrigger?: { type: 'me' | 'dest' | 'all'; seq: number } | null;
}

export const MapCanvas: React.FC<MapCanvasProps> = ({
  stations,
  gameState,
  myPlayerId,
  lowDataMode,
  isPlayingPreTurnEffect = false,
  warpFocusStationId = null,
  onSelectNextStation,
  focusTargetTrigger,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight });
  const [isFollowing, setIsFollowing] = useState(true);
  const [inspectedStation, setInspectedStation] = useState<StationDef | null>(null);

  const stationMap = useMemo(() => new Map(stations.map((s) => [s.id, s])), [stations]);

  // 最新propsをrenderループから参照するためのRef（renderループを再生成しない）
  const latestRef = useRef({
    stations,
    stationMap,
    gameState,
    myPlayerId,
    lowDataMode,
    size,
  });
  latestRef.current = { stations, stationMap, gameState, myPlayerId, lowDataMode, size };

  // シンプルな一元管理カメラ状態
  // animate=true の間だけ targetX/targetY/targetZoom へ滑らかに移動し、到着またはユーザー操作で即停止
  const cameraRef = useRef({
    x: 5850,
    y: 6240,
    zoom: 0.55,
    targetX: 5850,
    targetY: 6240,
    targetZoom: 0.55,
    animating: false,
    following: true,
    initialized: false,
  });

  // 各プレイヤーコマの滑らか補間座標
  const visualPlayerPosRef = useRef<Map<string, { x: number; y: number }>>(new Map());

  // ポインター操作用Ref
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pointerDownPosRef = useRef<{ x: number; y: number } | null>(null);
  const movedDuringPointerRef = useRef(false);
  const lastPinchDistRef = useRef<number | null>(null);
  const lastPanRef = useRef<{ x: number; y: number } | null>(null);

  // カメラ移動ヘルパー（ワンショット移動 or 追従）
  const panTo = useCallback((wx: number, wy: number, nextZoom?: number, follow = false) => {
    const cam = cameraRef.current;
    cam.targetX = wx;
    cam.targetY = wy;
    cam.targetZoom =
      nextZoom !== undefined ? Math.max(0.06, Math.min(2.2, nextZoom)) : cam.zoom;
    cam.animating = true;
    cam.following = follow;
    setIsFollowing(follow);
  }, []);

  const panToWholeJapan = useCallback(() => {
    const { width, height } = latestRef.current.size;
    const zoomX = width / 9600;
    const zoomY = height / 10600;
    const fitZoom = Math.max(0.06, Math.min(zoomX, zoomY) * 0.92);
    panTo(4600, 5200, fitZoom, false);
  }, [panTo]);

  // 画面リサイズ監視
  useEffect(() => {
    const handleResize = () => {
      if (containerRef.current) {
        setSize({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
      } else {
        setSize({ width: window.innerWidth, height: window.innerHeight });
      }
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // 初回のみ東京駅（または自機位置）へ瞬時フォーカス
  useEffect(() => {
    if (cameraRef.current.initialized || stations.length === 0) return;
    const me = gameState?.players.find((p) => p.id === myPlayerId);
    const startSt = (me ? stationMap.get(me.stationId) : null) ?? stationMap.get('tokyo');
    if (startSt) {
      cameraRef.current.x = startSt.x;
      cameraRef.current.y = startSt.y;
      cameraRef.current.targetX = startSt.x;
      cameraRef.current.targetY = startSt.y;
      cameraRef.current.initialized = true;
    }
  }, [stations, gameState, myPlayerId, stationMap]);

  // 下部ドック「マップ」ボタン等の外部トリガー（seqが変わったときだけ1回実行）
  const lastFocusSeqRef = useRef<number>(-1);
  useEffect(() => {
    if (!focusTargetTrigger || focusTargetTrigger.seq === lastFocusSeqRef.current) return;
    lastFocusSeqRef.current = focusTargetTrigger.seq;

    if (focusTargetTrigger.type === 'all') {
      panToWholeJapan();
    } else if (focusTargetTrigger.type === 'dest') {
      const destId = latestRef.current.gameState?.destinationStationId;
      const dest = destId ? latestRef.current.stationMap.get(destId) : null;
      if (dest) panTo(dest.x, dest.y, Math.max(cameraRef.current.zoom, 0.55), false);
    } else if (focusTargetTrigger.type === 'me') {
      const gs = latestRef.current.gameState;
      const me = gs?.players.find((p) => p.id === latestRef.current.myPlayerId);
      const st = me ? latestRef.current.stationMap.get(me.stationId) : null;
      if (st) panTo(st.x, st.y, Math.max(cameraRef.current.zoom, 0.6), true);
    }
  }, [focusTargetTrigger, panTo, panToWholeJapan]);

  // ターンが別のプレイヤーへ切り替わったときだけ、前のマス演出が終わってから手番プレイヤーへ追従ONにする
  const lastTurnPlayerRef = useRef<string>('');
  useEffect(() => {
    if (isPlayingPreTurnEffect) return;
    const turnPid = gameState?.currentTurnPlayerId;
    if (!turnPid) return;
    if (turnPid !== lastTurnPlayerRef.current) {
      lastTurnPlayerRef.current = turnPid;
      const active = gameState.players.find((p) => p.id === turnPid);
      const st = active ? stationMap.get(active.stationId) : null;
      if (st) {
        const nextZoom = cameraRef.current.zoom < 0.25 ? 0.52 : cameraRef.current.zoom;
        panTo(st.x, st.y, nextZoom, true);
      }
    }
  }, [gameState?.currentTurnPlayerId, gameState?.players, stationMap, panTo, isPlayingPreTurnEffect]);

  // ワープ系カード・ワープ駅発動時、移動先の駅へカメラを移動して見せる
  useEffect(() => {
    if (!warpFocusStationId) return;
    const st = stationMap.get(warpFocusStationId);
    if (st) {
      panTo(st.x, st.y, Math.max(cameraRef.current.zoom, 0.56), false);
    }
  }, [warpFocusStationId, stationMap, panTo]);

  // 追従モードONのとき、手番プレイヤーが1マス進んだらターゲット座標だけ更新（ズームは変えない！）
  // ターン終了演出中（次プレイヤーへ切り替わる前）は次の社長へカメラを飛ばさない
  useEffect(() => {
    if (!cameraRef.current.following || !gameState) return;
    if (lastTurnPlayerRef.current && gameState.currentTurnPlayerId !== lastTurnPlayerRef.current) {
      return;
    }
    const active = gameState.players.find((p) => p.id === gameState.currentTurnPlayerId);
    const st = active ? stationMap.get(active.stationId) : null;
    if (st) {
      cameraRef.current.targetX = st.x;
      cameraRef.current.targetY = st.y;
      cameraRef.current.animating = true;
    }
  }, [gameState?.players, gameState?.currentTurnPlayerId, stationMap]);

  // 常時1本だけ走る安定した描画ループ（ドラッグやズームで再生成されない）
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId = 0;

    const render = (time: number) => {
      const { stations: sts, stationMap: sMap, gameState: gs, myPlayerId: myPid, lowDataMode: lowData, size: sz } =
        latestRef.current;

      const dpr = window.devicePixelRatio || 1;
      const targetW = Math.floor(sz.width * dpr);
      const targetH = Math.floor(sz.height * dpr);
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }

      // カメラの滑らかな補間移動（animating が true のときだけ）
      const cam = cameraRef.current;
      if (cam.animating) {
        if (lowData) {
          cam.x = cam.targetX;
          cam.y = cam.targetY;
          cam.zoom = cam.targetZoom;
          cam.animating = false;
        } else {
          const dx = cam.targetX - cam.x;
          const dy = cam.targetY - cam.y;
          const dz = cam.targetZoom - cam.zoom;
          if (Math.hypot(dx, dy) < 1 && Math.abs(dz) < 0.002) {
            cam.x = cam.targetX;
            cam.y = cam.targetY;
            cam.zoom = cam.targetZoom;
            cam.animating = false;
          } else {
            cam.x += dx * 0.16;
            cam.y += dy * 0.16;
            cam.zoom += dz * 0.16;
          }
        }
      }

      ctx.save();
      ctx.scale(dpr, dpr);

      // 背景（桃鉄風の明るいコバルトブルー〜マリンブルーの海）
      const bgGrad = ctx.createLinearGradient(0, 0, 0, sz.height);
      bgGrad.addColorStop(0, '#38bdf8');
      bgGrad.addColorStop(1, '#0284c7');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, sz.width, sz.height);

      // カメラ変換
      ctx.translate(sz.width / 2, sz.height / 2);
      ctx.scale(cam.zoom, cam.zoom);
      ctx.translate(-cam.x, -cam.y);

      // 海の経緯線グリッド
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
      ctx.lineWidth = 2;
      for (let gx = 0; gx <= 9600; gx += 650) {
        ctx.beginPath();
        ctx.moveTo(gx, 0);
        ctx.lineTo(gx, 10800);
        ctx.stroke();
      }
      for (let gy = 0; gy <= 10800; gy += 650) {
        ctx.beginPath();
        ctx.moveTo(0, gy);
        ctx.lineTo(9600, gy);
        ctx.stroke();
      }

      // 緯度・経度グリッドに沿った桃鉄風カクカク日本列島
      const pad = 16;
      const half = GRID_SIZE / 2;
      ctx.fillStyle = '#fef3c7';
      for (const [gx, gy] of JAPAN_LAND_CELLS) {
        ctx.fillRect(
          gx * GRID_SIZE - half - pad,
          gy * GRID_SIZE - half - pad,
          GRID_SIZE + pad * 2,
          GRID_SIZE + pad * 2
        );
      }
      ctx.fillStyle = '#4ade80';
      for (const [gx, gy] of JAPAN_LAND_CELLS) {
        ctx.fillRect(
          gx * GRID_SIZE - half - 2,
          gy * GRID_SIZE - half - 2,
          GRID_SIZE + 4,
          GRID_SIZE + 4
        );
      }

      // 路線（鉄道レール：こげ茶枕木＋白レール）
      const drawnEdges = new Set<string>();
      for (const st of sts) {
        for (const nbId of st.neighbors) {
          const edgeKey = st.id < nbId ? `${st.id}-${nbId}` : `${nbId}-${st.id}`;
          if (drawnEdges.has(edgeKey)) continue;
          drawnEdges.add(edgeKey);
          const nb = sMap.get(nbId);
          if (!nb) continue;

          ctx.strokeStyle = '#78350f';
          ctx.lineWidth = 11;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(st.x, st.y);
          ctx.lineTo(nb.x, nb.y);
          ctx.stroke();

          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 6;
          ctx.setLineDash([10, 10]);
          ctx.beginPath();
          ctx.moveTo(st.x, st.y);
          ctx.lineTo(nb.x, nb.y);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }

      const pulse = lowData ? 0.5 : (Math.sin(time / 260) + 1) / 2;

      // マス描画
      for (const st of sts) {
        const isDest = gs?.destinationStationId === st.id;
        const isMyMoving =
          gs?.status === 'playing' &&
          gs?.phase === 'moving' &&
          gs.currentTurnPlayerId === myPid;
        const isNextAvail = isMyMoving && gs.availableNextStations.includes(st.id);
        const isUndoTarget = isMyMoving && gs.undoStationId === st.id;

        if (isDest) {
          ctx.beginPath();
          ctx.arc(st.x, st.y, 40 + pulse * 12, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(250, 204, 21, ${0.25 + pulse * 0.25})`;
          ctx.fill();
          ctx.strokeStyle = '#facc15';
          ctx.lineWidth = 5;
          ctx.stroke();
        }

        if (isNextAvail) {
          ctx.beginPath();
          ctx.arc(st.x, st.y, 28 + pulse * 10, 0, Math.PI * 2);
          ctx.fillStyle = isUndoTarget
            ? `rgba(251, 146, 60, ${0.32 + pulse * 0.22})`
            : `rgba(56, 189, 248, ${0.35 + pulse * 0.25})`;
          ctx.fill();
          ctx.strokeStyle = isUndoTarget ? '#fb923c' : '#38bdf8';
          ctx.lineWidth = 5;
          ctx.stroke();
        }

        if (st.type === 'property') {
          let monopolyColor: string | null = null;
          if (gs && st.properties && st.properties.length > 0) {
            const firstOwned = gs.ownedProperties[st.properties[0].id];
            if (
              firstOwned &&
              st.properties.every((p) => gs.ownedProperties[p.id]?.ownerId === firstOwned.ownerId)
            ) {
              const owner = gs.players.find((pl) => pl.id === firstOwned.ownerId);
              monopolyColor = owner?.color ?? null;
            }
          }

          ctx.beginPath();
          ctx.fillStyle = isDest ? '#eab308' : monopolyColor ?? '#dc2626';
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 4;
          ctx.roundRect(st.x - 19, st.y - 19, 38, 38, 9);
          ctx.fill();
          ctx.stroke();

          ctx.fillStyle = '#ffffff';
          ctx.font = 'bold 17px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(monopolyColor ? '👑' : '駅', st.x, st.y + 1);

          ctx.font = 'bold 16px sans-serif';
          const heroIcon = st.hero ? st.hero.icon : '';
          const labelText = isDest ? `🚩${st.name}` : `${heroIcon}${st.name}`;
          const textWidth = ctx.measureText(labelText).width;
          ctx.fillStyle = isDest ? '#facc15' : monopolyColor ? monopolyColor : '#ffffff';
          ctx.strokeStyle = isDest ? '#b91c1c' : '#1e293b';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.roundRect(st.x - textWidth / 2 - 8, st.y + 23, textWidth + 16, 25, 7);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = monopolyColor ? '#ffffff' : '#0f172a';
          ctx.fillText(labelText, st.x, st.y + 36);
        } else {
          ctx.beginPath();
          if (st.type === 'shop') {
            ctx.fillStyle = '#ea580c';
            ctx.strokeStyle = '#fef08a';
            ctx.lineWidth = isNextAvail ? 4 : 3;
            ctx.roundRect(st.x - 15, st.y - 15, 30, 30, 7);
            ctx.fill();
            ctx.stroke();
          } else {
            ctx.arc(st.x, st.y, isNextAvail ? 17 : st.type === 'nice_card' ? 15 : 13, 0, Math.PI * 2);
            if (st.type === 'plus') ctx.fillStyle = '#2563eb';
            else if (st.type === 'minus') ctx.fillStyle = '#dc2626';
            else if (st.type === 'warp') ctx.fillStyle = '#9333ea';
            else if (st.type === 'nice_card') ctx.fillStyle = '#10b981';
            else ctx.fillStyle = '#eab308';
            ctx.fill();
            ctx.strokeStyle = isUndoTarget ? '#fdba74' : '#ffffff';
            ctx.lineWidth = isNextAvail ? 4 : 3;
            ctx.stroke();
          }

          ctx.fillStyle = st.type === 'card' ? '#0f172a' : '#ffffff';
          ctx.font = 'bold 14px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          const symbol =
            st.type === 'plus'
              ? '＋'
              : st.type === 'minus'
                ? '－'
                : st.type === 'warp'
                  ? '🌀'
                  : st.type === 'shop'
                    ? '🛒'
                    : st.type === 'nice_card'
                      ? '✨'
                      : '★';
          ctx.fillText(symbol, st.x, st.y + 1);
        }

        if (isUndoTarget) {
          ctx.font = 'bold 13px sans-serif';
          const backLabel = '↩戻る';
          const bw = ctx.measureText(backLabel).width;
          ctx.fillStyle = '#ea580c';
          ctx.beginPath();
          ctx.roundRect(st.x - bw / 2 - 6, st.y - 42, bw + 12, 20, 6);
          ctx.fill();
          ctx.fillStyle = '#ffffff';
          ctx.fillText(backLabel, st.x, st.y - 32);
        }
      }

      // 最短経路ゴールド誘導矢印
      if (
        gs &&
        gs.status === 'playing' &&
        gs.phase === 'moving' &&
        gs.currentTurnPlayerId === myPid &&
        gs.recommendedNextStations?.length > 0
      ) {
        const me = gs.players.find((p) => p.id === myPid);
        const curSt = me ? sMap.get(me.stationId) : null;
        if (curSt) {
          for (const recId of gs.recommendedNextStations) {
            const nextSt = sMap.get(recId);
            if (!nextSt) continue;
            const dx = nextSt.x - curSt.x;
            const dy = nextSt.y - curSt.y;
            const angle = Math.atan2(dy, dx);
            const t = 0.52 + pulse * 0.12;
            const ax = curSt.x + dx * t;
            const ay = curSt.y + dy * t;

            ctx.save();
            ctx.translate(ax, ay);
            ctx.rotate(angle);
            ctx.beginPath();
            ctx.moveTo(20, 0);
            ctx.lineTo(-10, -14);
            ctx.lineTo(-4, 0);
            ctx.lineTo(-10, 14);
            ctx.closePath();
            ctx.fillStyle = '#facc15';
            ctx.shadowColor = 'rgba(250, 204, 21, 0.9)';
            ctx.shadowBlur = 12;
            ctx.fill();
            ctx.lineWidth = 3;
            ctx.strokeStyle = '#ffffff';
            ctx.stroke();
            ctx.restore();
          }
        }
      }

      // プレイヤーコマ描画
      if (gs) {
        const byStation = new Map<string, typeof gs.players>();
        for (const p of gs.players) {
          const list = byStation.get(p.stationId) ?? [];
          list.push(p);
          byStation.set(p.stationId, list);
        }

        for (const [stId, group] of byStation.entries()) {
          const st = sMap.get(stId);
          if (!st) continue;
          group.forEach((p, idx) => {
            const angle = (idx / Math.max(1, group.length)) * Math.PI * 2 - Math.PI / 2;
            const radius = group.length > 1 ? 28 : 0;
            const targetPx = st.x + Math.cos(angle) * radius;
            const targetPy = st.y - 26 + Math.sin(angle) * (radius * 0.6);

            let vPos = visualPlayerPosRef.current.get(p.id);
            if (!vPos || lowData) {
              vPos = { x: targetPx, y: targetPy };
              visualPlayerPosRef.current.set(p.id, vPos);
            } else {
              const dist = Math.hypot(targetPx - vPos.x, targetPy - vPos.y);
              if (dist > 700) {
                vPos.x = targetPx;
                vPos.y = targetPy;
              } else {
                vPos.x += (targetPx - vPos.x) * 0.18;
                vPos.y += (targetPy - vPos.y) * 0.18;
              }
            }

            const px = vPos.x;
            const py = vPos.y;
            const isTurn = p.id === gs.currentTurnPlayerId;
            if (isTurn) {
              ctx.beginPath();
              ctx.arc(px, py, 25 + pulse * 6, 0, Math.PI * 2);
              ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
              ctx.fill();
              ctx.strokeStyle = '#facc15';
              ctx.lineWidth = 4;
              ctx.stroke();
            }

            ctx.beginPath();
            ctx.arc(px, py, 20, 0, Math.PI * 2);
            ctx.fillStyle = p.color;
            ctx.fill();
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 3.5;
            ctx.stroke();

            ctx.font = '20px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(p.avatar, px, py + 1);

            if (isTurn || p.id === myPid) {
              ctx.font = 'bold 12px sans-serif';
              const nw = ctx.measureText(p.name).width;
              ctx.fillStyle = p.color;
              ctx.beginPath();
              ctx.roundRect(px - nw / 2 - 5, py - 38, nw + 10, 16, 5);
              ctx.fill();
              ctx.fillStyle = '#ffffff';
              ctx.fillText(p.name, px, py - 30);
            }

            if (p.hasNuisance) {
              ctx.font = '22px sans-serif';
              ctx.fillText('👹', px + 18, py - 18);
            }
          });
        }
      }

      ctx.restore();
      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animId);
  }, []);

  // ユーザー操作で追従・自動アニメーションを即解除するヘルパー
  const stopAutoCamera = () => {
    const cam = cameraRef.current;
    cam.animating = false;
    if (cam.following) {
      cam.following = false;
      setIsFollowing(false);
    }
  };

  // ポインター操作（1本指ドラッグ & 2本指ピンチ & マス直接タップ）
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointersRef.current.size === 1) {
      lastPanRef.current = { x: e.clientX, y: e.clientY };
      pointerDownPosRef.current = { x: e.clientX, y: e.clientY };
      movedDuringPointerRef.current = false;
    } else if (pointersRef.current.size === 2) {
      movedDuringPointerRef.current = true;
      stopAutoCamera();
      const pts = Array.from(pointersRef.current.values());
      lastPinchDistRef.current = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!pointersRef.current.has(e.pointerId)) return;
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointersRef.current.size === 1 && lastPanRef.current) {
      if (pointerDownPosRef.current) {
        const totalMove = Math.hypot(
          e.clientX - pointerDownPosRef.current.x,
          e.clientY - pointerDownPosRef.current.y
        );
        if (totalMove > 10) {
          movedDuringPointerRef.current = true;
        }
      }

      const dx = e.clientX - lastPanRef.current.x;
      const dy = e.clientY - lastPanRef.current.y;
      if (movedDuringPointerRef.current) {
        stopAutoCamera();
        cameraRef.current.x -= dx / cameraRef.current.zoom;
        cameraRef.current.y -= dy / cameraRef.current.zoom;
        cameraRef.current.targetX = cameraRef.current.x;
        cameraRef.current.targetY = cameraRef.current.y;
      }
      lastPanRef.current = { x: e.clientX, y: e.clientY };
    } else if (pointersRef.current.size === 2) {
      movedDuringPointerRef.current = true;
      stopAutoCamera();
      const pts = Array.from(pointersRef.current.values());
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      if (lastPinchDistRef.current) {
        const scale = dist / lastPinchDistRef.current;
        cameraRef.current.zoom = Math.max(0.06, Math.min(2.2, cameraRef.current.zoom * scale));
        cameraRef.current.targetZoom = cameraRef.current.zoom;
      }
      lastPinchDistRef.current = dist;
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const wasTap = !movedDuringPointerRef.current && pointersRef.current.size === 1;
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size < 2) lastPinchDistRef.current = null;
    if (pointersRef.current.size === 1) {
      const remaining = Array.from(pointersRef.current.values())[0];
      lastPanRef.current = { x: remaining.x, y: remaining.y };
    } else {
      lastPanRef.current = null;
    }

    if (!wasTap || !canvasRef.current) return;

    const rect = canvasRef.current.getBoundingClientRect();
    const tapX = e.clientX - rect.left;
    const tapY = e.clientY - rect.top;
    const cam = cameraRef.current;

    // 1. 自分の移動中なら、光っている隣接マスのタップ判定を最優先
    if (
      gameState &&
      gameState.status === 'playing' &&
      gameState.phase === 'moving' &&
      gameState.currentTurnPlayerId === myPlayerId
    ) {
      let bestStationId: string | null = null;
      let bestDist = 56;
      for (const stId of gameState.availableNextStations) {
        const st = stationMap.get(stId);
        if (!st) continue;
        const sx = (st.x - cam.x) * cam.zoom + size.width / 2;
        const sy = (st.y - cam.y) * cam.zoom + size.height / 2;
        const d = Math.hypot(sx - tapX, sy - tapY);
        if (d < bestDist) {
          bestDist = d;
          bestStationId = stId;
        }
      }
      if (bestStationId) {
        setInspectedStation(null);
        onSelectNextStation(bestStationId);
        return;
      }
    }

    // 2. それ以外は都市駅の物件プレビュー判定
    let found: StationDef | null = null;
    let minD = 44;
    for (const st of stations) {
      if (st.type !== 'property') continue;
      const sx = (st.x - cam.x) * cam.zoom + size.width / 2;
      const sy = (st.y - cam.y) * cam.zoom + size.height / 2;
      const d = Math.hypot(sx - tapX, sy - tapY);
      if (d < minD) {
        minD = d;
        found = st;
      }
    }
    setInspectedStation(found);
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    stopAutoCamera();
    const factor = e.deltaY < 0 ? 1.12 : 0.89;
    cameraRef.current.zoom = Math.max(0.06, Math.min(2.2, cameraRef.current.zoom * factor));
    cameraRef.current.targetZoom = cameraRef.current.zoom;
  };

  return (
    <div ref={containerRef} className="relative w-full h-full overflow-hidden select-none">
      <canvas
        ref={canvasRef}
        className="block w-full h-full touch-none cursor-grab active:cursor-grabbing"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onWheel={handleWheel}
      />

      {/* 都市駅タップ時の物件・歴史ヒーロープレビューカード */}
      {inspectedStation && (
        <div className="absolute left-3 right-16 bottom-28 z-20 max-w-sm bg-slate-900/95 backdrop-blur-md border border-sky-500/60 rounded-2xl p-3.5 shadow-2xl text-xs">
          <div className="flex items-center justify-between mb-2">
            <div>
              <span className="text-[10px] text-sky-400 font-bold">{inspectedStation.region}</span>
              <h3 className="text-sm font-black text-white">
                🏢 {inspectedStation.name}駅
                {inspectedStation.hero && (
                  <span className="ml-1.5 text-xs text-amber-300">
                    {inspectedStation.hero.icon} {inspectedStation.hero.name}
                  </span>
                )}
              </h3>
            </div>
            <button
              onClick={() => setInspectedStation(null)}
              className="px-2 py-0.5 rounded-lg bg-slate-800 text-slate-300 font-bold"
            >
              ✕
            </button>
          </div>
          {inspectedStation.hero && (
            <div className="mb-2 p-1.5 rounded-lg bg-amber-950/60 border border-amber-500/40 text-[11px] text-amber-200">
              {inspectedStation.hero.icon} {inspectedStation.hero.description}
            </div>
          )}
          <div className="space-y-1 max-h-36 overflow-y-auto">
            {inspectedStation.properties?.map((prop) => {
              const owned = gameState?.ownedProperties[prop.id];
              const owner = owned
                ? gameState?.players.find((p) => p.id === owned.ownerId)
                : null;
              return (
                <div
                  key={prop.id}
                  className="flex items-center justify-between py-1 px-2 rounded-lg bg-slate-950/70 border border-slate-800"
                >
                  <div>
                    <span className="text-slate-200 font-bold">{prop.name}</span>
                    <span className="text-slate-400 ml-1">({Math.round(prop.rate * 100)}%)</span>
                  </div>
                  <div className="text-right font-bold">
                    {owner ? (
                      <span style={{ color: owner.color }}>
                        {owner.name} Lv.{owned?.level}
                      </span>
                    ) : (
                      <span className="text-emerald-400">{prop.price.toLocaleString()}万</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 右下カメラ操作ボタン（ポインターイベントをCanvasへ伝播させない） */}
      <div
        onPointerDown={(e) => e.stopPropagation()}
        onPointerUp={(e) => e.stopPropagation()}
        className="absolute right-3 bottom-32 z-10 flex flex-col gap-2"
      >
        <button
          onClick={() => {
            const me = gameState?.players.find((p) => p.id === myPlayerId);
            const st = me ? stationMap.get(me.stationId) : null;
            if (st) panTo(st.x, st.y, Math.max(cameraRef.current.zoom, 0.55), true);
          }}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-bold shadow-lg border backdrop-blur-md active:scale-95 transition ${
            isFollowing
              ? 'bg-sky-600 border-sky-200 text-white'
              : 'bg-slate-900/85 border-slate-600 text-slate-200'
          }`}
        >
          <Crosshair className="w-4 h-4" />
          自機
        </button>
        <button
          onClick={() => {
            if (!gameState) return;
            const dest = stationMap.get(gameState.destinationStationId);
            if (dest) panTo(dest.x, dest.y, Math.max(cameraRef.current.zoom, 0.55), false);
          }}
          className="flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-bold shadow-lg border bg-slate-900/85 border-slate-600 text-slate-100 active:scale-95 backdrop-blur-md transition"
        >
          <Compass className="w-4 h-4 text-amber-400" />
          目的地
        </button>
        <button
          onClick={panToWholeJapan}
          className="flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-bold shadow-lg border bg-slate-900/85 border-slate-600 text-slate-100 active:scale-95 backdrop-blur-md transition"
        >
          <Maximize2 className="w-4 h-4" />
          全体
        </button>
        <div className="text-[10px] text-center font-mono text-white/80 bg-black/40 rounded-full px-2 py-0.5">
          v3.0
        </div>
      </div>
    </div>
  );
};
