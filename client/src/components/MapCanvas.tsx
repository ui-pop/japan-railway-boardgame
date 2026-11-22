import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Compass, Crosshair, Maximize2 } from 'lucide-react';
import { JAPAN_POLYGONS } from '../data/japanPolygons';
import type { PublicGameState, StationDef } from '../types';

interface MapCanvasProps {
  stations: StationDef[];
  gameState: PublicGameState | null;
  myPlayerId: string | null;
  lowDataMode: boolean;
  onSelectNextStation: (stationId: string) => void;
  focusTargetTrigger?: { type: 'me' | 'dest' | 'all'; seq: number } | null;
}

export const MapCanvas: React.FC<MapCanvasProps> = ({
  stations,
  gameState,
  myPlayerId,
  lowDataMode,
  onSelectNextStation,
  focusTargetTrigger,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight });
  // カメラの現在位置と目標位置（初期フォーカス：東京付近）
  const cameraRef = useRef({
    x: 6220,
    y: 6520,
    targetX: 6220,
    targetY: 6520,
    zoom: 0.55,
  });
  const [cameraTick, setCameraTick] = useState(0);
  const [cameraMode, setCameraMode] = useState<'auto' | 'free'>('auto');
  const [inspectedStation, setInspectedStation] = useState<StationDef | null>(null);

  // 各プレイヤーコマの描画用補間座標
  const visualPlayerPosRef = useRef<Map<string, { x: number; y: number }>>(new Map());

  const stationMap = useMemo(() => new Map(stations.map((s) => [s.id, s])), [stations]);

  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pointerDownPosRef = useRef<{ x: number; y: number } | null>(null);
  const movedDuringPointerRef = useRef(false);
  const lastPinchDistRef = useRef<number | null>(null);
  const lastPanRef = useRef<{ x: number; y: number } | null>(null);

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

  const focusOnPoint = useCallback((wx: number, wy: number, zoom?: number, instant = false) => {
    cameraRef.current.targetX = wx;
    cameraRef.current.targetY = wy;
    if (instant) {
      cameraRef.current.x = wx;
      cameraRef.current.y = wy;
    }
    if (zoom !== undefined) {
      cameraRef.current.zoom = Math.max(0.08, Math.min(2.2, zoom));
    }
    setCameraTick((t) => t + 1);
  }, []);

  const focusWholeJapan = useCallback(() => {
    const zoomX = size.width / 9600;
    const zoomY = size.height / 10800;
    const fitZoom = Math.max(0.06, Math.min(zoomX, zoomY) * 0.92);
    focusOnPoint(4800, 5600, fitZoom, true);
  }, [focusOnPoint, size.height, size.width]);

  // 外部トリガーからのフォーカス
  useEffect(() => {
    if (!focusTargetTrigger || !gameState) return;
    if (focusTargetTrigger.type === 'all') {
      setCameraMode('free');
      focusWholeJapan();
    } else if (focusTargetTrigger.type === 'dest') {
      const dest = stationMap.get(gameState.destinationStationId);
      if (dest) {
        setCameraMode('free');
        focusOnPoint(dest.x, dest.y, Math.max(cameraRef.current.zoom, 0.65), true);
      }
    } else if (focusTargetTrigger.type === 'me') {
      const me = gameState.players.find((p) => p.id === myPlayerId);
      const st = me ? stationMap.get(me.stationId) : null;
      if (st) {
        setCameraMode('auto');
        focusOnPoint(st.x, st.y, Math.max(cameraRef.current.zoom, 0.72), true);
      }
    }
  }, [focusTargetTrigger, focusOnPoint, focusWholeJapan, gameState, myPlayerId, stationMap]);

  // 自動追従モード：手番プレイヤーが動いたら目標カメラ座標を更新
  useEffect(() => {
    if (cameraMode !== 'auto' || !gameState) return;
    const active = gameState.players.find((p) => p.id === gameState.currentTurnPlayerId);
    const st = active ? stationMap.get(active.stationId) : null;
    if (st) {
      focusOnPoint(st.x, st.y, Math.max(cameraRef.current.zoom, 0.68), false);
    }
  }, [
    cameraMode,
    focusOnPoint,
    gameState?.currentTurnPlayerId,
    gameState?.players,
    gameState?.turnCount,
    gameState?.remainingSteps,
    stationMap,
  ]);

  // 描画ループ
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId = 0;

    const render = (time: number) => {
      const dpr = window.devicePixelRatio || 1;
      if (
        canvas.width !== Math.floor(size.width * dpr) ||
        canvas.height !== Math.floor(size.height * dpr)
      ) {
        canvas.width = Math.floor(size.width * dpr);
        canvas.height = Math.floor(size.height * dpr);
      }

      // カメラの滑らかな補間移動
      const cam = cameraRef.current;
      if (cameraMode === 'auto' && !lowDataMode) {
        const dx = cam.targetX - cam.x;
        const dy = cam.targetY - cam.y;
        if (Math.hypot(dx, dy) > 0.5) {
          cam.x += dx * 0.14;
          cam.y += dy * 0.14;
        } else {
          cam.x = cam.targetX;
          cam.y = cam.targetY;
        }
      }

      ctx.save();
      ctx.scale(dpr, dpr);

      // 背景（桃鉄風の明るいコバルトブルー〜マリンブルーの海）
      const bgGrad = ctx.createLinearGradient(0, 0, 0, size.height);
      bgGrad.addColorStop(0, '#38bdf8');
      bgGrad.addColorStop(1, '#0284c7');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, size.width, size.height);

      // カメラ変換
      ctx.translate(size.width / 2, size.height / 2);
      ctx.scale(cam.zoom, cam.zoom);
      ctx.translate(-cam.x, -cam.y);

      // 海の経緯線グリッド
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
      ctx.lineWidth = 2;
      for (let gx = 0; gx <= 9600; gx += 600) {
        ctx.beginPath();
        ctx.moveTo(gx, 0);
        ctx.lineTo(gx, 10600);
        ctx.stroke();
      }
      for (let gy = 0; gy <= 10600; gy += 600) {
        ctx.beginPath();
        ctx.moveTo(0, gy);
        ctx.lineTo(9600, gy);
        ctx.stroke();
      }

      // 日本列島ポリゴン（実地理ベース・桃鉄風の明るい草原グリーン＋砂浜クリーム縁取り）
      for (const poly of JAPAN_POLYGONS) {
        ctx.beginPath();
        poly.forEach(([px, py], idx) => {
          if (idx === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        });
        ctx.closePath();
        ctx.fillStyle = '#4ade80';
        ctx.fill();
        ctx.strokeStyle = '#fef3c7';
        ctx.lineWidth = 18;
        ctx.stroke();
        ctx.strokeStyle = '#16a34a';
        ctx.lineWidth = 6;
        ctx.stroke();
      }

      // 路線（鉄道レール：茶色の枕木＋白レール）
      const drawnEdges = new Set<string>();
      for (const st of stations) {
        for (const nbId of st.neighbors) {
          const edgeKey = st.id < nbId ? `${st.id}-${nbId}` : `${nbId}-${st.id}`;
          if (drawnEdges.has(edgeKey)) continue;
          drawnEdges.add(edgeKey);
          const nb = stationMap.get(nbId);
          if (!nb) continue;

          // 外枠レール（こげ茶）
          ctx.strokeStyle = '#78350f';
          ctx.lineWidth = 11;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(st.x, st.y);
          ctx.lineTo(nb.x, nb.y);
          ctx.stroke();

          // 内側白線
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

      const pulse = lowDataMode ? 0.5 : (Math.sin(time / 260) + 1) / 2;

      // マス（都市駅＆道中マス）描画
      for (const st of stations) {
        const isDest = gameState?.destinationStationId === st.id;
        const isMyMoving =
          gameState?.status === 'playing' &&
          gameState?.phase === 'moving' &&
          gameState.currentTurnPlayerId === myPlayerId;
        const isNextAvail = isMyMoving && gameState.availableNextStations.includes(st.id);
        const isUndoTarget = isMyMoving && gameState.undoStationId === st.id;

        // 目的地ハイライトリング
        if (isDest) {
          ctx.beginPath();
          ctx.arc(st.x, st.y, 40 + pulse * 12, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(250, 204, 21, ${0.25 + pulse * 0.25})`;
          ctx.fill();
          ctx.strokeStyle = '#facc15';
          ctx.lineWidth = 5;
          ctx.stroke();
        }

        // タップ可能な移動先マス・戻りマスのハイライトリング
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
          // 誰かが独占しているかチェック
          let monopolyColor: string | null = null;
          if (gameState && st.properties && st.properties.length > 0) {
            const firstOwned = gameState.ownedProperties[st.properties[0].id];
            if (
              firstOwned &&
              st.properties.every(
                (p) => gameState.ownedProperties[p.id]?.ownerId === firstOwned.ownerId
              )
            ) {
              const owner = gameState.players.find((pl) => pl.id === firstOwned.ownerId);
              monopolyColor = owner?.color ?? null;
            }
          }

          // 都市駅（桃鉄風の赤屋根駅舎プレート）
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

          // 都市駅名看板（白地に黒太字の桃鉄駅看板スタイル！）
          ctx.font = 'bold 16px sans-serif';
          const heroIcon = st.hero ? st.hero.icon : '';
          const labelText = isDest ? `🚩${st.name}` : `${heroIcon}${st.name}`;
          const textWidth = ctx.measureText(labelText).width;
          ctx.fillStyle = isDest
            ? '#facc15'
            : monopolyColor
              ? monopolyColor
              : '#ffffff';
          ctx.strokeStyle = isDest ? '#b91c1c' : '#1e293b';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.roundRect(st.x - textWidth / 2 - 8, st.y + 23, textWidth + 16, 25, 7);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = monopolyColor ? '#ffffff' : '#0f172a';
          ctx.fillText(labelText, st.x, st.y + 36);
        } else {
          // 道中の青マス・赤マス・カードマス・ナイスカードマス・カード売り場・ワープマス
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

        // 戻るマスには「↩戻る」の小さなタグを上に表示
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

      // 目的地への最短経路となる次マスへのゴールド誘導矢印を描画
      if (
        gameState &&
        gameState.status === 'playing' &&
        gameState.phase === 'moving' &&
        gameState.currentTurnPlayerId === myPlayerId &&
        gameState.recommendedNextStations?.length > 0
      ) {
        const me = gameState.players.find((p) => p.id === myPlayerId);
        const curSt = me ? stationMap.get(me.stationId) : null;
        if (curSt) {
          for (const recId of gameState.recommendedNextStations) {
            const nextSt = stationMap.get(recId);
            if (!nextSt) continue;
            const dx = nextSt.x - curSt.x;
            const dy = nextSt.y - curSt.y;
            const angle = Math.atan2(dy, dx);
            // 現在駅と次マスの中間あたりに脈動する矢印を配置
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

      // プレイヤーコマ描画（滑らかな補間移動つき）
      if (gameState) {
        const byStation = new Map<string, typeof gameState.players>();
        for (const p of gameState.players) {
          const list = byStation.get(p.stationId) ?? [];
          list.push(p);
          byStation.set(p.stationId, list);
        }

        for (const [stId, group] of byStation.entries()) {
          const st = stationMap.get(stId);
          if (!st) continue;
          group.forEach((p, idx) => {
            const angle = (idx / Math.max(1, group.length)) * Math.PI * 2 - Math.PI / 2;
            const radius = group.length > 1 ? 28 : 0;
            const targetPx = st.x + Math.cos(angle) * radius;
            const targetPy = st.y - 26 + Math.sin(angle) * (radius * 0.6);

            let vPos = visualPlayerPosRef.current.get(p.id);
            if (!vPos || lowDataMode) {
              vPos = { x: targetPx, y: targetPy };
              visualPlayerPosRef.current.set(p.id, vPos);
            } else {
              // 距離が遠すぎる場合（ワープ等）は瞬時移動、1マス移動は滑らかに補間
              const dist = Math.hypot(targetPx - vPos.x, targetPy - vPos.y);
              if (dist > 600) {
                vPos.x = targetPx;
                vPos.y = targetPy;
              } else {
                vPos.x += (targetPx - vPos.x) * 0.18;
                vPos.y += (targetPy - vPos.y) * 0.18;
              }
            }

            const px = vPos.x;
            const py = vPos.y;

            const isTurn = p.id === gameState.currentTurnPlayerId;
            if (isTurn) {
              ctx.beginPath();
              ctx.arc(px, py, 25 + pulse * 6, 0, Math.PI * 2);
              ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
              ctx.fill();
              ctx.strokeStyle = '#facc15';
              ctx.lineWidth = 4;
              ctx.stroke();
            }

            // コマ本体
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

            // プレイヤー名ミニバッジ（手番または自分のコマ）
            if (isTurn || p.id === myPlayerId) {
              ctx.font = 'bold 12px sans-serif';
              const nw = ctx.measureText(p.name).width;
              ctx.fillStyle = p.color;
              ctx.beginPath();
              ctx.roundRect(px - nw / 2 - 5, py - 38, nw + 10, 16, 5);
              ctx.fill();
              ctx.fillStyle = '#ffffff';
              ctx.fillText(p.name, px, py - 30);
            }

            // お邪魔キャラ憑依アイコン
            if (p.hasNuisance) {
              ctx.font = '22px sans-serif';
              ctx.fillText('👹', px + 18, py - 18);
            }
          });
        }
      }

      ctx.restore();

      if (!lowDataMode) {
        animId = requestAnimationFrame(render);
      }
    };

    if (lowDataMode) {
      render(0);
    } else {
      animId = requestAnimationFrame(render);
    }

    return () => {
      if (animId) cancelAnimationFrame(animId);
    };
  }, [gameState, lowDataMode, myPlayerId, size, stationMap, stations, cameraTick, cameraMode]);

  // ポインター操作（1本指ドラッグ & 2本指ピンチ & マス直接タップ移動）
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointersRef.current.size === 1) {
      lastPanRef.current = { x: e.clientX, y: e.clientY };
      pointerDownPosRef.current = { x: e.clientX, y: e.clientY };
      movedDuringPointerRef.current = false;
    } else if (pointersRef.current.size === 2) {
      movedDuringPointerRef.current = true;
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
        if (totalMove > 12) {
          movedDuringPointerRef.current = true;
        }
      }

      const dx = e.clientX - lastPanRef.current.x;
      const dy = e.clientY - lastPanRef.current.y;
      if (movedDuringPointerRef.current) {
        setCameraMode('free');
        cameraRef.current.x -= dx / cameraRef.current.zoom;
        cameraRef.current.y -= dy / cameraRef.current.zoom;
        cameraRef.current.targetX = cameraRef.current.x;
        cameraRef.current.targetY = cameraRef.current.y;
        setCameraTick((t) => t + 1);
      }
      lastPanRef.current = { x: e.clientX, y: e.clientY };
    } else if (pointersRef.current.size === 2) {
      movedDuringPointerRef.current = true;
      const pts = Array.from(pointersRef.current.values());
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      if (lastPinchDistRef.current) {
        setCameraMode('free');
        const scale = dist / lastPinchDistRef.current;
        cameraRef.current.zoom = Math.max(0.08, Math.min(2.2, cameraRef.current.zoom * scale));
        setCameraTick((t) => t + 1);
      }
      lastPinchDistRef.current = dist;
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const wasTap = !movedDuringPointerRef.current && pointersRef.current.size === 1;
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size < 2) {
      lastPinchDistRef.current = null;
    }
    if (pointersRef.current.size === 1) {
      const remaining = Array.from(pointersRef.current.values())[0];
      lastPanRef.current = { x: remaining.x, y: remaining.y };
    } else {
      lastPanRef.current = null;
    }

    // マス直接タップによる移動判定
    if (
      wasTap &&
      canvasRef.current &&
      gameState &&
      gameState.status === 'playing' &&
      gameState.phase === 'moving' &&
      gameState.currentTurnPlayerId === myPlayerId
    ) {
      const rect = canvasRef.current.getBoundingClientRect();
      const tapX = e.clientX - rect.left;
      const tapY = e.clientY - rect.top;
      const cam = cameraRef.current;

      let bestStationId: string | null = null;
      let bestDist = 54; // 指で押しやすい54px以内の判定

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
        setCameraMode('auto');
        onSelectNextStation(bestStationId);
        return;
      }
    }

    // 移動先以外で都市駅をタップした場合は、駅物件・ヒーロー情報をプレビュー表示
    if (wasTap && canvasRef.current) {
      const rect = canvasRef.current.getBoundingClientRect();
      const tapX = e.clientX - rect.left;
      const tapY = e.clientY - rect.top;
      const cam = cameraRef.current;

      let found: StationDef | null = null;
      let minD = 42;
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
    }
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    setCameraMode('free');
    const factor = e.deltaY < 0 ? 1.12 : 0.89;
    cameraRef.current.zoom = Math.max(0.08, Math.min(2.2, cameraRef.current.zoom * factor));
    setCameraTick((t) => t + 1);
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

      {/* 右下カメラ切替ボタン */}
      <div className="absolute right-3 bottom-32 z-10 flex flex-col gap-2">
        <button
          onClick={() => {
            const me = gameState?.players.find((p) => p.id === myPlayerId);
            const st = me ? stationMap.get(me.stationId) : null;
            if (st) {
              setCameraMode('auto');
              focusOnPoint(st.x, st.y, 0.72, true);
            }
          }}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-bold shadow-lg border backdrop-blur-md transition ${
            cameraMode === 'auto'
              ? 'bg-sky-600/90 border-sky-300 text-white'
              : 'bg-slate-900/80 border-slate-600 text-slate-200'
          }`}
        >
          <Crosshair className="w-4 h-4" />
          自機
        </button>
        <button
          onClick={() => {
            if (!gameState) return;
            const dest = stationMap.get(gameState.destinationStationId);
            if (dest) {
              setCameraMode('free');
              focusOnPoint(dest.x, dest.y, 0.65, true);
            }
          }}
          className="flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-bold shadow-lg border bg-amber-600/85 border-amber-300 text-white backdrop-blur-md"
        >
          <Compass className="w-4 h-4" />
          目的地
        </button>
        <button
          onClick={() => {
            setCameraMode('free');
            focusWholeJapan();
          }}
          className="flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-bold shadow-lg border bg-slate-900/80 border-slate-600 text-slate-200 backdrop-blur-md"
        >
          <Maximize2 className="w-4 h-4" />
          全体
        </button>
      </div>
    </div>
  );
};
