import { getVoiceSnapshot, getServerVoiceSnapshot, subscribeVoice, hologramState } from '../../lib/company/voiceActivity';
import type { HoloState } from './HologramScene';
import { Glow } from './fx';
import { SceneFallbackBoundary } from './SceneFallbackBoundary';
import { HoloHead } from './HoloHead';
import { Suspense, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { CoreControls } from './CoreControls';
import { corePresentation } from './corePresentation';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { supportsWebGL, usePrefersReducedMotion } from './webgl';

export interface OrbSatellite {
  id: string;
  color: string;
  active: boolean;
}

function glowTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(180, 245, 255,1)');
  grad.addColorStop(0.25, 'rgba(0, 212, 255,0.55)');
  grad.addColorStop(1, 'rgba(0, 212, 255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

function Satellite({ sat, index, total, motion, onSelect }: { sat: OrbSatellite; index: number; total: number; motion: number; onSelect?: (id: string) => void }) {
  const ref = useRef<THREE.Mesh>(null);
  const radius = 1.9 + (index % 3) * 0.28;
  const tilt = (index % 3) * 0.55 + 0.25;
  const phase = (index / total) * Math.PI * 2;
  const speed = 0.22 + (index % 4) * 0.05;
  useFrame((s) => {
    const m = ref.current;
    if (!m) return;
    const a = phase + s.clock.elapsedTime * speed * motion;
    m.position.set(Math.cos(a) * radius, Math.sin(a) * radius * Math.sin(tilt), Math.sin(a) * radius * Math.cos(tilt));
    const pulse = sat.active ? 1 + Math.sin(s.clock.elapsedTime * 5 + index) * 0.35 : 1;
    m.scale.setScalar(pulse);
  });
  return (
    <mesh
      ref={ref}
      onClick={onSelect ? (e) => (e.stopPropagation(), onSelect(sat.id)) : undefined}
      onPointerOver={onSelect ? () => (document.body.style.cursor = 'pointer') : undefined}
      onPointerOut={onSelect ? () => (document.body.style.cursor = '') : undefined}
    >
      <sphereGeometry args={[sat.active ? 0.075 : 0.05, 16, 16]} />
      <meshBasicMaterial color={sat.color} transparent opacity={sat.active ? 1 : 0.65} toneMapped={false} />
      {onSelect && (
        <mesh>
          <sphereGeometry args={[0.17, 8, 8]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      )}
    </mesh>
  );
}

function Scene({ satellites, motion, onSelect, onFailure, state, pointCount }: { satellites: OrbSatellite[]; motion: number; onSelect?: (id: string) => void; onFailure: () => void; state: HoloState; pointCount: number }) {
  const group = useRef<THREE.Group>(null);
  const rings = useRef<(THREE.Mesh | null)[]>([]);
  const glow = useMemo(() => glowTexture(), []);

  useFrame((s, dt) => {
    const t = s.clock.elapsedTime * motion;
    void t;
    rings.current.forEach((r, i) => {
      if (r) r.rotation.z += dt * motion * (0.08 + i * 0.05) * (i % 2 ? -1 : 1);
    });
    if (group.current) {
      group.current.rotation.y = THREE.MathUtils.lerp(group.current.rotation.y, s.pointer.x * 0.35 * motion, 0.04);
      group.current.rotation.x = THREE.MathUtils.lerp(group.current.rotation.x, -s.pointer.y * 0.2 * motion, 0.04);
    }
  });

  return (
    <group ref={group}>
      <sprite scale={[4.6, 4.6, 1]}>
        <spriteMaterial map={glow} transparent opacity={0.3} blending={THREE.AdditiveBlending} depthWrite={false} />
      </sprite>
      {/* Catch loader render failures within the Canvas renderer before they
          become uncaught renderer errors. No application actions are swallowed. */}
      <SceneFallbackBoundary fallback={null} onFailure={onFailure}>
        <Suspense fallback={null}>
          <group position={[0, -0.35, 0]} scale={1.15}>
            <HoloHead state={state} motion={motion} pointCount={pointCount} />
          </group>
        </Suspense>
      </SceneFallbackBoundary>
      {[1.9, 2.18, 2.46].map((r, i) => (
        <mesh
          key={r}
          ref={(el) => { rings.current[i] = el; }}
          rotation={[Math.PI / 2 - (i * 0.55 + 0.25), 0, 0]}
        >
          <torusGeometry args={[r, 0.0035, 8, 160]} />
          <meshBasicMaterial color={i === 1 ? '#a78bfa' : '#38bdf8'} transparent opacity={0.5} />
        </mesh>
      ))}
      <InstrumentRings motion={motion} />
      {satellites.map((s, i) => (
        <Satellite key={s.id} sat={s} index={i} total={satellites.length} motion={motion} onSelect={onSelect} />
      ))}
    </group>
  );
}

/** Decorative instrument geometry; never represents fabricated system metrics. */
function InstrumentRings({ motion }: { motion: number }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((_state, dt) => {
    if (ref.current) ref.current.rotation.z += dt * motion * 0.055;
  });
  return (
    <group ref={ref} rotation={[0.18, -0.12, 0]}>
      {[0, 1, 2, 3].map((index) => (
        <mesh key={index} rotation={[0, 0, index * Math.PI / 2]}>
          <torusGeometry args={[2.7, 0.012, 6, 48, Math.PI * 0.38]} />
          <meshBasicMaterial color="#22d3ee" transparent opacity={0.65} toneMapped={false} />
        </mesh>
      ))}
      {Array.from({ length: 48 }, (_, index) => {
        const angle = index * Math.PI / 24;
        const major = index % 4 === 0;
        return (
          <mesh key={index} position={[Math.cos(angle) * 2.9, Math.sin(angle) * 2.9, 0]} rotation={[0, 0, angle]}>
            <boxGeometry args={[major ? 0.15 : 0.06, 0.012, 0.015]} />
            <meshBasicMaterial color={major ? '#a5f3fc' : '#0891b2'} transparent opacity={major ? 0.8 : 0.45} />
          </mesh>
        );
      })}
    </group>
  );
}

function Fallback({ still = false }: { still?: boolean }) {
  return (
    <div className="fb-ring-fallback" aria-hidden="true">
      {[180, 250, 320].map((d, i) => (
        <span key={d} style={{ width: d, height: d, animationDuration: `${14 + i * 6}s`, animationDirection: i % 2 ? 'reverse' : 'normal', animationPlayState: still ? 'paused' : 'running' }} />
      ))}
    </div>
  );
}

/** Animated AI core. Asset/canvas errors fall back without blanking the workspace. */
export function CoreOrb({ satellites = [], className, onSelect }: { satellites?: OrbSatellite[]; className?: string; onSelect?: (id: string) => void }) {
  const reduced = usePrefersReducedMotion();
  const voice = useSyncExternalStore(subscribeVoice, getVoiceSnapshot, getServerVoiceSnapshot);
  const [failed, setFailed] = useState(false);
  const [paused, setPaused] = useState(false);
  const [lightweight, setLightweight] = useState(() => typeof navigator !== 'undefined' && (navigator.hardwareConcurrency ?? 4) < 4);
  useEffect(() => {
    // Set an initial mobile default, but leave later choices under user control.
    if (window.matchMedia?.('(max-width: 767px)').matches) setLightweight(true);
  }, []);
  const presentation = corePresentation(paused, reduced, lightweight);
  return (
    <div className={className} data-voice-phase={voice.phase} data-core-mode={presentation.static ? 'static' : lightweight ? 'lightweight' : 'full'}>
      <CoreControls paused={paused} reduced={reduced} lightweight={lightweight} phase={voice.phase} onPause={() => setPaused(v => !v)} onLightweight={() => setLightweight(v => !v)} />
      <div aria-hidden="true" className="absolute inset-0">
      {presentation.static || failed || !supportsWebGL() ? <Fallback still={presentation.static} /> : <SceneFallbackBoundary fallback={<Fallback />}>
        <Canvas
          key={lightweight ? 'lightweight' : 'full'}
          style={{ position: 'absolute', inset: 0 }}
          dpr={[1, presentation.dpr]}
          camera={{ position: [0, 0, 7.2], fov: 42 }}
          gl={{ antialias: !lightweight, alpha: true, powerPreference: lightweight ? 'low-power' : 'high-performance' }}
          frameloop="always"
        >
          <Scene state={hologramState(voice.phase)} satellites={satellites} motion={1} pointCount={presentation.pointCount} onSelect={onSelect} onFailure={() => setFailed(true)} />
          {presentation.bloom ? <Glow /> : null}
        </Canvas>
      </SceneFallbackBoundary>}
      </div>
    </div>
  );
}

export default CoreOrb;
