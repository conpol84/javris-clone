import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Focus, Minus, Plus } from 'lucide-react';
import { Line, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { voiceLevel } from '../../lib/company/voice';
import { Glow, Stars } from './fx';
import { Label3D } from './OfficeScene';
import type { HoloState, Satellite } from './HologramScene';
import { supportsWebGL, usePrefersReducedMotion } from './webgl';

const COLORS: Record<HoloState, string> = { idle: '#22d3ee', listening: '#34d399', thinking: '#a78bfa', speaking: '#67e8f9' };

/** Deterministic pseudo-random in [0,1). */
function rnd(i: number): number {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

interface HeadData {
  points: Float32Array;
  lines: Float32Array;
  eyes: Float32Array;
}

/** A dot-matrix head, neck and shoulders built ring by ring, facing +z, like a holographic scan. */
function buildHead(): HeadData {
  const rings: THREE.Vector3[][] = [];
  const addRing = (y: number, rx: number, rz: number, bump?: (x: number, z: number, a: number) => number, flat = false) => {
    const n = Math.max(14, Math.round((rx + rz) * 40));
    const ring: THREE.Vector3[] = [];
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      let x = Math.sin(a) * rx;
      let z = Math.cos(a) * rz;
      if (flat) z *= 0.55;
      z += bump ? bump(x, z, a) : 0;
      ring.push(new THREE.Vector3(x, y, z));
    }
    rings.push(ring);
  };
  const H = 1.18;
  const face = (x: number, z: number) => {
    // nose, brow ridge and eye sockets only on the front half
    if (z < 0.1) return 0;
    return 0;
  };
  void face;
  for (let y = H; y >= -1.15; y -= 0.055) {
    const u = y / H;
    let w = Math.sqrt(Math.max(0, 1 - u * u)) ** 0.85;
    if (y < -0.2) w *= 1 - ((-0.2 - y) / 0.95) ** 1.6 * 0.42; // jaw taper
    const rx = 0.82 * w;
    const rz = 0.95 * w;
    addRing(y, Math.max(0.04, rx), Math.max(0.04, rz), (x, z) => {
      if (z <= 0.15) return 0;
      const nose = 0.22 * Math.exp(-((y + 0.12) ** 2) / 0.05) * Math.exp(-(x * x) / 0.012);
      const brow = 0.07 * Math.exp(-((y - 0.3) ** 2) / 0.006) * Math.exp(-(x * x) / 0.35);
      const eyes = -0.09 * Math.exp(-((y - 0.18) ** 2) / 0.01) * (Math.exp(-((x - 0.34) ** 2) / 0.02) + Math.exp(-((x + 0.34) ** 2) / 0.02));
      const lips = 0.05 * Math.exp(-((y + 0.62) ** 2) / 0.004) * Math.exp(-(x * x) / 0.05);
      return nose + brow + eyes + lips;
    });
  }
  for (let y = -1.2; y >= -1.95; y -= 0.1) addRing(y, 0.36, 0.38); // neck
  for (let y = -2.0; y >= -2.75; y -= 0.1) {
    const t = (-2.0 - y) / 0.75;
    addRing(y, 0.5 + t * 1.45, 0.7 + t * 0.2, undefined, true); // shoulders
  }
  const pts: number[] = [];
  const seg: number[] = [];
  rings.forEach((ring, ri) => {
    ring.forEach((p, k) => {
      const jx = (rnd(ri * 97 + k) - 0.5) * 0.012;
      pts.push(p.x + jx, p.y, p.z);
      const q = ring[(k + 1) % ring.length];
      if (rnd(ri * 31 + k * 7) > 0.35) seg.push(p.x, p.y, p.z, q.x, q.y, q.z);
      const next = rings[ri + 1];
      if (next && rnd(ri * 13 + k * 5) > 0.55) {
        const m = next[Math.round((k / ring.length) * next.length) % next.length];
        seg.push(p.x, p.y, p.z, m.x, m.y, m.z);
      }
    });
  });
  const eyes: number[] = [];
  for (const sx of [-1, 1]) for (let i = 0; i < 9; i++) eyes.push(sx * (0.34 + (rnd(i + 5) - 0.5) * 0.14), 0.2 + (rnd(i + 50) - 0.5) * 0.05, 0.78 + rnd(i) * 0.05);
  return { points: new Float32Array(pts), lines: new Float32Array(seg), eyes: new Float32Array(eyes) };
}

/** The AI at the end of the room: a huge dotted head on a floating screen that reacts to the voice. */
function AiHead({ state, motion }: { state: HoloState; motion: number }) {
  const data = useMemo(buildHead, []);
  const group = useRef<THREE.Group>(null);
  const pm = useRef<THREE.PointsMaterial>(null);
  const lm = useRef<THREE.LineBasicMaterial>(null);
  const em = useRef<THREE.PointsMaterial>(null);
  const sweep = useRef<THREE.Mesh>(null);
  const smooth = useRef(0);
  const col = useMemo(() => new THREE.Color(COLORS.idle), []);
  const target = useMemo(() => new THREE.Color(), []);
  useFrame((s, dt) => {
    const t = s.clock.elapsedTime * motion;
    const lvl = state === 'speaking' ? voiceLevel.value : state === 'listening' ? 0.25 + Math.sin(t * 6) * 0.1 : state === 'thinking' ? 0.3 + Math.sin(t * 9) * 0.15 : 0.08 + Math.sin(t * 1.4) * 0.04;
    smooth.current += (lvl - smooth.current) * Math.min(1, dt * 10);
    col.lerp(target.set(COLORS[state]), Math.min(1, dt * 4));
    if (pm.current) {
      pm.current.color.copy(col);
      pm.current.size = 0.034 + smooth.current * 0.03;
    }
    lm.current?.color.copy(col);
    em.current?.color.set('#ffffff');
    if (group.current) {
      group.current.rotation.y = Math.sin(t * 0.35) * (state === 'thinking' ? 0.45 : 0.18);
      group.current.rotation.x = Math.sin(t * 0.5) * 0.03;
      group.current.scale.setScalar(1 + smooth.current * 0.05);
    }
    if (sweep.current) sweep.current.position.y = -2.7 + ((s.clock.elapsedTime * 0.35 * Math.max(0.3, motion)) % 1) * 4.1;
  });
  return (
    <group position={[0, 0.9, -4.1]} scale={1.85}>
      <group ref={group}>
        <points>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[data.points, 3]} />
          </bufferGeometry>
          <pointsMaterial ref={pm} size={0.036} transparent opacity={0.95} sizeAttenuation depthWrite={false} blending={THREE.AdditiveBlending} />
        </points>
        <lineSegments>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[data.lines, 3]} />
          </bufferGeometry>
          <lineBasicMaterial ref={lm} transparent opacity={0.22} blending={THREE.AdditiveBlending} depthWrite={false} />
        </lineSegments>
        <points>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[data.eyes, 3]} />
          </bufferGeometry>
          <pointsMaterial ref={em} size={0.05} transparent opacity={1} sizeAttenuation depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
        </points>
        <mesh ref={sweep} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[1.5, 1.56, 64]} />
          <meshBasicMaterial color="#67e8f9" transparent opacity={0.5} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} depthWrite={false} />
        </mesh>
      </group>
    </group>
  );
}

/** The big floating screen the AI lives on: a glowing frame with corner brackets and a faint grid. */
function Screen() {
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
    if (ref.current) ref.current.position.y = 0.6 + Math.sin(s.clock.elapsedTime * 0.6) * 0.05;
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
function Viewer({ state }: { state: HoloState }) {
  const g = useRef<THREE.Group>(null);
  const head = useRef<THREE.Mesh>(null);
  const edge = useMemo(() => new THREE.EdgesGeometry(new THREE.CapsuleGeometry(0.62, 0.9, 6, 20), 20), []);
  useFrame((s) => {
    const t = s.clock.elapsedTime;
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
function Cards({ items, state, motion }: { items: Satellite[]; state: HoloState; motion: number }) {
  const shown = items.slice(0, 8);
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
    const t = s.clock.elapsedTime;
    if (g.current) g.current.position.y = pos[1] + Math.sin(t * 0.8 + seed) * 0.06 * motion;
    if (pulse.current) pulse.current.position.lerpVectors(from, hub, (t * (it.active ? 0.5 : 0.15) * Math.max(0.3, motion) + seed * 0.21) % 1);
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
  if (!supportsWebGL()) return <div className="fb-muted grid h-full place-items-center text-sm">{labels.noWebgl}</div>;
  const motion = reduced ? 0.3 : 1;
  const [zoom, setZoom] = useState(0.35);
  return (
    <div className="relative h-full w-full" style={{ height: "100%", width: "100%" }}>
    <Canvas camera={{ position: [0, 0.4, 6.2], fov: 52 }} dpr={[1, 2]} gl={{ alpha: true, antialias: true }}>
      <Stars count={800} radius={16} spread={24} speed={reduced ? 0 : 0.01} size={0.08} />
      <Screen />
      <AiHead state={state} motion={motion} />
      <Cards items={satellites} state={state} motion={motion} />
      <Floor />
      <Viewer state={state} />
      <Glow strength={1.15} threshold={0.18} vignette />
      <ZoomDriver level={zoom} />
      <OrbitControls target={zoom > 0.6 ? [0, 0.9, -3.6] : [0, 0, -2]} enablePan={false} enableZoom minDistance={3.2} maxDistance={12} minPolarAngle={Math.PI / 2.6} maxPolarAngle={Math.PI / 1.85} minAzimuthAngle={-0.55} maxAzimuthAngle={0.55} enableDamping />
    </Canvas>
    <div className="absolute end-3 top-1/2 flex -translate-y-1/2 flex-col gap-1.5" role="group">
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
