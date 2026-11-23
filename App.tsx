import { useCallback, useEffect, useRef, useState } from 'react';
import { HandHeart, Heart, RotateCcw } from 'lucide-react';
import { CarryStatus, MoveVector, SculptureViewport } from './components/SculptureViewport';
import { getReactionLabel, getZoneHoverLabel } from './three/sculptureReactions';
import { TouchZone } from './types/sculpture';

export default function App() {
  const moveInputRef = useRef<MoveVector>({ x: 0, y: 0 });
  const keysPressedRef = useRef<Set<string>>(new Set());
  const joyVecRef = useRef<MoveVector>({ x: 0, y: 0 });

  const [carryStatus, setCarryStatus] = useState<CarryStatus>({
    canPickUp: false,
    isCarrying: false,
    canKiss: false,
    isKissing: false,
    womanHappy: false,
  });
  const [carryToggleSeq, setCarryToggleSeq] = useState(0);
  const [kissSeq, setKissSeq] = useState(0);
  const [resetCameraSeq, setResetCameraSeq] = useState(0);

  const [activeReactionZone, setActiveReactionZone] = useState<TouchZone>('none');
  const [hoverZone, setHoverZone] = useState<TouchZone>('none');
  const [webglError, setWebglError] = useState(false);

  // Virtual joystick visual knob state (normalized -1..1)
  const joyBaseRef = useRef<HTMLDivElement | null>(null);
  const joyPointerIdRef = useRef<number | null>(null);
  const [joyKnob, setJoyKnob] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  const syncMoveVector = useCallback(() => {
    const keys = keysPressedRef.current;
    let kx = 0;
    let ky = 0;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) kx -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) kx += 1;
    if (keys.has('KeyW') || keys.has('ArrowUp')) ky += 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) ky -= 1;

    const kLen = Math.hypot(kx, ky);
    if (kLen > 1) {
      kx /= kLen;
      ky /= kLen;
    }

    const jx = joyVecRef.current.x;
    const jy = joyVecRef.current.y;
    const tx = Math.max(-1, Math.min(1, kx + jx));
    const ty = Math.max(-1, Math.min(1, ky + jy));
    moveInputRef.current.x = tx;
    moveInputRef.current.y = ty;
  }, []);

  const handleToggleCarry = useCallback(() => {
    setCarryToggleSeq((c) => c + 1);
  }, []);

  const handleKiss = useCallback(() => {
    setKissSeq((c) => c + 1);
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }
      if (
        e.code === 'KeyW' ||
        e.code === 'KeyA' ||
        e.code === 'KeyS' ||
        e.code === 'KeyD' ||
        e.code === 'ArrowUp' ||
        e.code === 'ArrowDown' ||
        e.code === 'ArrowLeft' ||
        e.code === 'ArrowRight'
      ) {
        keysPressedRef.current.add(e.code);
        syncMoveVector();
      } else if (e.code === 'Space' || e.code === 'KeyE') {
        e.preventDefault();
        setCarryToggleSeq((c) => c + 1);
      } else if (e.code === 'KeyF') {
        e.preventDefault();
        setKissSeq((c) => c + 1);
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (keysPressedRef.current.delete(e.code)) {
        syncMoveVector();
      }
    };

    const onBlur = () => {
      keysPressedRef.current.clear();
      joyVecRef.current = { x: 0, y: 0 };
      setJoyKnob({ x: 0, y: 0 });
      syncMoveVector();
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [syncMoveVector]);

  const updateJoystickFromClient = useCallback(
    (clientX: number, clientY: number) => {
      const el = joyBaseRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const maxR = rect.width * 0.38;
      let dx = clientX - cx;
      let dy = clientY - cy;
      const dist = Math.hypot(dx, dy);
      if (dist > maxR && dist > 1e-4) {
        dx = (dx / dist) * maxR;
        dy = (dy / dist) * maxR;
      }
      const nx = dx / maxR;
      const ny = -dy / maxR;
      joyVecRef.current = { x: nx, y: ny };
      setJoyKnob({ x: dx, y: dy });
      syncMoveVector();
    },
    [syncMoveVector],
  );

  const handleJoyPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    joyPointerIdRef.current = e.pointerId;
    updateJoystickFromClient(e.clientX, e.clientY);
  };

  const handleJoyPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (joyPointerIdRef.current !== e.pointerId) return;
    e.stopPropagation();
    updateJoystickFromClient(e.clientX, e.clientY);
  };

  const handleJoyPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (joyPointerIdRef.current !== e.pointerId) return;
    e.stopPropagation();
    joyPointerIdRef.current = null;
    joyVecRef.current = { x: 0, y: 0 };
    setJoyKnob({ x: 0, y: 0 });
    syncMoveVector();
  };

  const handleWebglError = useCallback(() => {
    setWebglError(true);
  }, []);

  if (webglError) {
    return (
      <main className="w-screen h-screen bg-[#131115] text-[#f3efe9] flex items-center justify-center p-6">
        <div className="max-w-md text-center space-y-3">
          <h1 className="font-display text-3xl tracking-tight">Atelier Form</h1>
          <p className="text-sm text-[#a69e96] leading-relaxed">
            Bu tarayıcıda 3D WebGL hızlandırması başlatılamadı. Lütfen donanım hızlandırmanın
            açık olduğundan emin olun veya güncel bir tarayıcı ile tekrar deneyin.
          </p>
        </div>
      </main>
    );
  }

  const reactionLabel = getReactionLabel(activeReactionZone);
  const hoverLabel = getZoneHoverLabel(hoverZone);

  const statusText = carryStatus.isCarrying
    ? 'Kadın kucakta taşınıyor · Yere bırakmak için dokunun veya Boşluk tuşuna basın'
    : carryStatus.isKissing
      ? 'Erkek karakter poposundan öperek sevgisini gösteriyor'
      : carryStatus.womanHappy
        ? 'Kadın çok mutlu oldu ve sevgiyle gülümsedi'
        : carryStatus.canKiss || carryStatus.canPickUp
          ? 'Kadına yaklaşıldı · Öpebilir veya kucağına alabilirsiniz'
          : 'Erkek karakteri kadına doğru yürütün';

  return (
    <main className="relative w-screen h-screen overflow-hidden bg-[#131115] select-none">
      {/* Full-screen 3D Viewport */}
      <SculptureViewport
        moveInputRef={moveInputRef}
        carryToggleSeq={carryToggleSeq}
        kissSeq={kissSeq}
        resetCameraSeq={resetCameraSeq}
        onCarryStatusChange={setCarryStatus}
        onTouchReaction={setActiveReactionZone}
        onHoverZone={setHoverZone}
        onWebglError={handleWebglError}
      />

      {/* Minimal Top-Left Editorial Title (Zero Menu, Zero Pills) */}
      <header className="pointer-events-none fixed top-4 left-5 right-5 sm:top-5 sm:left-6 sm:right-auto z-10">
        <h1 className="font-display text-xl sm:text-[28px] font-medium tracking-tight text-[#f4ede4] leading-none">
          Atelier Form
        </h1>
        <p className="mt-1 sm:mt-1.5 text-[11px] sm:text-xs text-[#a9a097] flex flex-wrap items-center gap-x-2 gap-y-0.5 leading-snug">
          <span>WASD / Joystick ile yürü</span>
          <span aria-hidden="true">·</span>
          <span>Boşluk / E: Kucağa al</span>
          <span aria-hidden="true">·</span>
          <span>F: Öp</span>
          <span aria-hidden="true" className="hidden sm:inline">·</span>
          <span className="hidden sm:inline">Sürükleyerek kamerayı döndür</span>
        </p>
        <p className="mt-1 text-[11px] sm:text-xs font-medium text-[#e5b88b]">{statusText}</p>
        {hoverLabel && (
          <p className="mt-0.5 text-[11px] sm:text-xs text-[#cfc6bc]">
            Bölge: {hoverLabel} · Dokun
          </p>
        )}
        {reactionLabel && (
          <p className="mt-0.5 text-[11px] sm:text-xs text-[#f2cfb0]">
            {reactionLabel}
          </p>
        )}
      </header>

      {/* Bottom-Left Analog Joystick for Mobile & Touch/Mouse Walking */}
      <div className="fixed bottom-5 left-5 sm:bottom-6 sm:left-6 z-20 flex flex-col items-center gap-1.5">
        <div
          ref={joyBaseRef}
          onPointerDown={handleJoyPointerDown}
          onPointerMove={handleJoyPointerMove}
          onPointerUp={handleJoyPointerUp}
          onPointerCancel={handleJoyPointerUp}
          aria-label="Karakter yönlendirme joystick"
          className="relative w-24 h-24 sm:w-28 sm:h-28 rounded-full bg-[#18161a]/90 border border-white/15 shadow-xl touch-none cursor-grab active:cursor-grabbing flex items-center justify-center"
        >
          <div className="w-10 h-10 rounded-full border border-white/10 pointer-events-none" />
          <div
            className="absolute w-10 h-10 sm:w-11 sm:h-11 rounded-full bg-[#e5b88b] border-2 border-[#161418] shadow-lg pointer-events-none transition-transform duration-75"
            style={{
              transform: `translate(${joyKnob.x}px, ${joyKnob.y}px)`,
            }}
          />
        </div>
        <span className="text-[10px] tracking-wide uppercase text-[#9d958d] pointer-events-none">
          Yürü
        </span>
      </div>

      {/* Bottom-Right Direct Actions: Camera Reset, Kiss & Carry */}
      <div className="fixed bottom-5 right-5 sm:bottom-6 sm:right-6 z-20 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setResetCameraSeq((c) => c + 1)}
          aria-label="Kamerayı sıfırla"
          title="Kamerayı Sıfırla"
          className="w-11 h-11 rounded-full bg-[#18161a]/92 border border-white/15 text-[#d6cec4] hover:text-[#f5efe8] hover:border-white/30 shadow-xl flex items-center justify-center transition-colors cursor-pointer"
        >
          <RotateCcw className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={handleKiss}
          disabled={!carryStatus.canKiss}
          title="Yaklaşınca sevgiyle öp (F)"
          className={`inline-flex items-center gap-1.5 px-4 py-3 rounded-full text-xs sm:text-sm font-medium border shadow-xl transition-all whitespace-nowrap shrink-0 ${
            carryStatus.isKissing
              ? 'bg-[#e89aa8] border-[#e89aa8] text-[#171416] cursor-default'
              : carryStatus.canKiss
                ? 'bg-[#e89aa8] border-[#e89aa8] text-[#171416] hover:bg-[#f2adb9] cursor-pointer'
                : 'bg-[#18161a]/90 border-white/10 text-[#7d7670] cursor-not-allowed'
          }`}
        >
          <Heart className="w-4 h-4" />
          <span>{carryStatus.isKissing ? 'Öpüyor...' : 'Öp'}</span>
        </button>

        <button
          type="button"
          onClick={handleToggleCarry}
          disabled={!carryStatus.canPickUp && !carryStatus.isCarrying}
          className={`inline-flex items-center gap-2 px-4 py-3 rounded-full text-xs sm:text-sm font-medium border shadow-xl transition-all whitespace-nowrap shrink-0 ${
            carryStatus.isCarrying
              ? 'bg-[#e5b88b] border-[#e5b88b] text-[#171416] hover:bg-[#f0c79e] cursor-pointer'
              : carryStatus.canPickUp
                ? 'bg-[#e5b88b] border-[#e5b88b] text-[#171416] hover:bg-[#f0c79e] cursor-pointer'
                : 'bg-[#18161a]/90 border-white/10 text-[#7d7670] cursor-not-allowed'
          }`}
        >
          <HandHeart className="w-4 h-4" />
          <span>
            {carryStatus.isCarrying
              ? 'Yere Bırak'
              : carryStatus.canPickUp
                ? 'Kucağına Al'
                : 'Kadına Yaklaş'}
          </span>
        </button>
      </div>
    </main>
  );
}
