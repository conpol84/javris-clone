import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Focus, Minus, Plus } from 'lucide-react';
import { Line, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { Glow, Stars } from './fx';
import { SceneFallbackBoundary } from './SceneFallbackBoundary';
import { HoloHead } from './HoloHead';
import { Label3D } from './OfficeScene';
import type { HoloState, Satellite } from './HologramScene';
import { supportsWebGL, usePrefersReducedMotion, useScenePerformance } from './webgl';

const COLORS: Record<HoloState, string> = { idle: '#22d3ee', listening: '#34d399', thinking: '#a78bfa', speaking: '#67e8f9' };

/** The AI at the end of the room: a real head scan rendered as a living hologram on a floating screen. */
function AiHead({ state, motion, pointCount }: { state: HoloState; motion: number; pointCount:number }) {
  return (
    <group position={[0, 0.55, -4.1]} scale={2.25}>
      <HoloHead state={state} motion={motion} pointCount={pointCount} />
    </group>
  );
}

/** The big floating screen the AI lives on: a glowing frame with corner brackets and a faint grid. */
function Screen({ motion }: { motion:number }) {
  const W = 9.4;
  const H = 6.2;
  const corner = (sx: number, sy: number): [number, number, number][] => [
    [sx * (W / 2 - 0.7), sy * (H / 2), 0],
    [sx * (W / 2), sy * (H / 2), 0],
    [sx * (W / 2), sy * (H / 2 - 0.7), 0],
  ];
  const grid = useMemo(() => {
    const a: number[] = [];
    for (let x = -W / 2; x <= W / 2 + 0.01; x += 0.8) a.push(x, -H / 2, 0, x, H / 2, 0);
    for (let y = -H / 2; y <= H / 2 + 0.01; y += 0.8) a.push(-W / 2, y, 0, W / 2, y, 0);
    return new Float32Array(a);
  }, []);
  const ref = useRef<THREE.Group>(null);
  useFrame((s) => {
    if (ref.current) ref.current.position.y = 0.6 + Math.sin(s.clock.elapsedTime * 0.6 * motion) * 0.05;
  });
  return (
    <group ref={ref} position={[0, 0.6, -4.6]}>
      <mesh>
        <planeGeometry args={[W, H]} />
        <meshBasicMaterial color="#04142e" transparent opacity={0.62} />
      </mesh>
      <lineSegments>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[grid, 3]} />
        </bufferGeometry>
        <lineBasicMaterial color="#1d6fb8" transparent opacity={0.16} />
      </lineSegments>
      <Line points={[[-W / 2, -H / 2, 0], [W / 2, -H / 2, 0], [W / 2, H / 2, 0], [-W / 2, H / 2, 0], [-W / 2, -H / 2, 0]]} color="#22d3ee" transparent opacity={0.35} lineWidth={1} />
      {[[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => (
        <Line key={`${sx}${sy}`} points={corner(sx, sy)} color="#67e8f9" lineWidth={2.4} toneMapped={false} />
      ))}
    </group>
  );
}

/** You, seen from behind: a dark silhouette with a cyan rim, facing the screen. */
function Viewer({ state, motion }: { state:HoloState; motion:number }) {
  const g = useRef<THREE.Group>(null);
  const head = useRef<THREE.Mesh>(null);
  const edge = useMemo(() => new THREE.EdgesGeometry(new THREE.CapsuleGeometry(0.62, 0.9, 6, 20), 20), []);
  useFrame((s) => {
    const t = s.clock.elapsedTime * motion;
    if (g.current) g.current.position.y = -2.75 + Math.sin(t * 1.5) * 0.01;
    if (head.current) head.current.rotation.y = state === 'listening' ? Math.sin(t * 2) * 0.06 : Math.sin(t * 0.4) * 0.1;
  });
  return (
    <group ref={g} position={[0, -2.75, 2.2]} scale={0.8}>
      <mesh position={[0, 0.9, 0]} scale={[1.55, 1, 0.85]}>
        <capsuleGeometry args={[0.62, 0.9, 6, 20]} />
        <meshBasicMaterial color="#030b1a" />
      </mesh>
      <lineSegments geometry={edge} position={[0, 0.9, 0]} scale={[1.55, 1, 0.85]}>
        <lineBasicMaterial color="#22d3ee" transparent opacity={0.35} />
      </lineSegments>
      <mesh ref={head} position={[0, 2.12, 0]}>
        <sphereGeometry args={[0.42, 24, 20]} />
        <meshBasicMaterial color="#030b1a" />
      </mesh>
      <mesh position={[0, 2.12, 0]} scale={1.04}>
        <sphereGeometry args={[0.42, 24, 20]} />
        <meshBasicMaterial color="#22d3ee" transparent opacity={0.12} side={THREE.BackSide} blending={THREE.AdditiveBlending} />
      </mesh>
      <mesh position={[0, 1.55, 0]}>
        <cylinderGeometry args={[0.17, 0.2, 0.3, 14]} />
        <meshBasicMaterial color="#030b1a" />
      </mesh>
    </group>
  );
}

/** Agent cards floating around the screen, tied to the AI head with glowing lines and travelling pulses. */
function Cards({ items, state, motion, maxItems = 8 }: { items: Satellite[]; state: HoloState; motion: number; maxItems?:number }) {
  const shown = items.slice(0,maxItems);
  const slots: [number, number, number][] = [
    [-5.9, 1.9, -2.6], [5.9, 1.9, -2.6], [-6.4, 0.2, -3.1], [6.4, 0.2, -3.1],
    [-6.0, -1.5, -2.6], [6.0, -1.5, -2.6], [-3.9, 3.2, -3.6], [3.9, 3.2, -3.6],
  ];
  return (
    <group>
      {shown.map((it, i) => (
        <Card key={it.id} it={it} pos={slots[i]} state={state} motion={motion} seed={i} />
      ))}
    </group>
  );
}

function Card({ it, pos, state, motion, seed }: { it: Satellite; pos: [number, number, number]; state: HoloState; motion: number; seed: number }) {
  const pulse = useRef<THREE.Mesh>(null);
  const g = useRef<THREE.Group>(null);
  const hub = new THREE.Vector3(0, 0.3, -4);
  const from = new THREE.Vector3(...pos);
  useFrame((s) => {
    const t = s.clock.elapsedTime * motion;
    if (g.current) g.current.position.y = pos[1] + Math.sin(t * 0.8 + seed) * 0.06 * motion;
    if (pulse.current) pulse.current.position.lerpVectors(from, hub, (t * (it.active ? 0.5 : 0.15) * motion + seed * 0.21) % 1);
  });
  return (
    <group>
      <Line points={[pos, [hub.x, hub.y, hub.z]]} color={it.color} transparent opacity={it.active || state === 'thinking' ? 0.6 : 0.2} lineWidth={1} />
      <mesh ref={pulse}>
        <sphereGeometry args={[0.045, 8, 8]} />
        <meshBasicMaterial color={it.color} toneMapped={false} />
      </mesh>
      <group ref={g} position={pos}>
        <Label3D text={it.name ?? ''} dot={it.color} border={it.active ? it.color : 'rgba(103,232,249,0.35)'} glow={it.active} position={[0, 0, 0]} height={0.46} />
      </group>
    </group>
  );
}

/** Floor rings under the viewer, like a projector platform. */
function Floor() {
  return (
    <group position={[0, -2.55, -0.5]} rotation={[-Math.PI / 2, 0, 0]}>
      {[2.2, 3.4, 4.8, 6.4].map((r, i) => (
        <mesh key={r}>
          <ringGeometry args={[r - 0.015, r, 96]} />
          <meshBasicMaterial color="#22d3ee" transparent opacity={0.34 - i * 0.07} />
        </mesh>
      ))}
    </group>
  );
}

/** Moves the camera toward (or away from) the AI's face when the zoom buttons are used; the mouse wheel and pinch also work. */
function ZoomDriver({ level }: { level: number }) {
  const { camera } = useThree();
  const goal = useRef(0);
  useEffect(() => {
    goal.current = 11 - level * 5.6; // 11 = whole room, 5.4 = face close-up
  }, [level]);
  useFrame(() => {
    const target = new THREE.Vector3(0, level > 0.6 ? 0.9 : 0, level > 0.6 ? -3.6 : -2);
    const dir = camera.position.clone().sub(target);
    const d = dir.length();
    const next = d + (goal.current - d) * 0.08;
    if (Math.abs(next - d) > 0.002) camera.position.copy(target).add(dir.setLength(next));
  });
  return null;
}

export function CeoStage({ state, satellites, labels }: { state: HoloState; satellites: Satellite[]; labels: { noWebgl: string } }) {
  const reduced = usePrefersReducedMotion();
  const {compact,visible}=useScenePerformance();
  const [zoom, setZoom] = useState(0.35);
  const [failed, setFailed] = useState(false);
  // The CEO remains expressive without constant large head/camera movement.
  const motion = reduced ? 0 : compact ? 0.45 : 0.74;
  const fallback = <div className="fb-muted grid h-full place-items-center p-6 text-center text-sm" data-holo-state={state}>{labels.noWebgl}</div>;
  if (failed || !supportsWebGL()) return fallback;
  return (
    <div data-holo-state={state} data-jarvis-scene="ceo" data-scene-quality={compact ? "mobile" : "desktop"} className="relative h-full w-full" style={{ height: "100%", width: "100%" }}>
    <SceneFallbackBoundary fallback={fallback}>
    <Canvas key={compact ? "compact" : "full"} camera={{ position: [0, 0.4, 6.2], fov: 52 }} dpr={[1, compact ? 1 : 1.5]} frameloop={visible ? "always" : "never"} gl={{ alpha: true, antialias: !compact, powerPreference:compact ? "low-power" : "high-performance" }}>
      <Stars count={compact ? 140 : 650} radius={16} spread={24} speed={reduced ? 0 : 0.01} size={0.08} />
      <Screen motion={motion} />
      <SceneFallbackBoundary fallback={null} onFailure={() => setFailed(true)}>
      <Suspense fallback={null}>
        <AiHead state={state} motion={motion} pointCount={compact ? 3900 : 12500} />
      </Suspense>
      </SceneFallbackBoundary>
      <Cards items={satellites} state={state} motion={motion} maxItems={compact ? 4 : 8} />
      <Floor />
      <Viewer state={state} motion={motion} />
      {!compact && !reduced && <Glow strength={0.8} threshold={0.18} vignette />}
      <ZoomDriver level={zoom} />
      <OrbitControls target={zoom > 0.6 ? [0, 0.9, -3.6] : [0, 0, -2]} enablePan={false} enableRotate={!compact} enableZoom={!compact} minDistance={3.2} maxDistance={12} minPolarAngle={Math.PI / 2.6} maxPolarAngle={Math.PI / 1.85} minAzimuthAngle={-0.55} maxAzimuthAngle={0.55} enableDamping />
    </Canvas>
    </SceneFallbackBoundary>
    <div className="absolute end-2 bottom-3 flex gap-1.5 sm:end-3 sm:top-1/2 sm:bottom-auto sm:-translate-y-1/2 sm:flex-col" role="group">
      {[
        { icon: <Plus size={15} />, to: Math.min(1, zoom + 0.2), label: '+' },
        { icon: <Focus size={15} />, to: 0.95, label: 'face' },
        { icon: <Minus size={15} />, to: Math.max(0, zoom - 0.2), label: '–' },
      ].map((b) => (
        <button key={b.label} type="button" className="fb-iconbtn" style={{ width: 34, height: 34, background: 'rgba(5,11,26,.7)', border: '1px solid var(--fb-border)' }} aria-label={b.label} onClick={() => setZoom(b.to)}>
          {b.icon}
        </button>
      ))}
    </div>
    </div>
  );
}

export default CeoStage;
