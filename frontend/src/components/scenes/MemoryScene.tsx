import { useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Line, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { Glow, Stars } from './fx';
import { Label3D } from './OfficeScene';
import { supportsWebGL, usePrefersReducedMotion } from './webgl';

export interface MemoryStar {
  id: string;
  type: string;
  importance: number;
  color: string;
}

export interface MemoryAgent {
  id: string;
  name: string;
  color: string;
}

export interface MemorySceneProps {
  stars: MemoryStar[];
  /** Cluster centres by type, so each kind of memory forms its own region of the network. */
  types: string[];
  selected: string | null;
  onSelect: (id: string) => void;
  agents: MemoryAgent[];
  activeAgent: string | null;
  onPickAgent: (id: string | null) => void;
  /** Memory ids the active agent reads when it works. */
  readIds: Set<string>;
  labels: { noWebgl: string };
}

/** Stable pseudo-random in [0,1) from a string. */
function hash(s: string, salt: number): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10000) / 10000;
}

function Neuron({ star, pos, selected, dim, lit, motion, onSelect }: { star: MemoryStar; pos: THREE.Vector3; selected: boolean; dim: boolean; lit: boolean; motion: number; onSelect: (id: string) => void }) {
  const ref = useRef<THREE.Mesh>(null);
  const size = 0.07 + star.importance * 0.16;
  useFrame((s) => {
    const m = ref.current;
    if (!m) return;
    const pulse = 1 + Math.sin(s.clock.elapsedTime * 2 * motion + hash(star.id, 7) * 6) * 0.12 + (selected ? 0.5 : 0) + (lit ? 0.45 + Math.sin(s.clock.elapsedTime * 6) * 0.15 : 0);
    m.scale.setScalar(pulse);
  });
  return (
    <mesh ref={ref} position={pos} onClick={(e) => (e.stopPropagation(), onSelect(star.id))} onPointerOver={() => (document.body.style.cursor = 'pointer')} onPointerOut={() => (document.body.style.cursor = '')}>
      <icosahedronGeometry args={[size, 1]} />
      <meshBasicMaterial color={selected || lit ? '#ffffff' : star.color} transparent opacity={dim ? 0.18 : 0.95} toneMapped={false} />
    </mesh>
  );
}

/** A small light that travels along a synapse. */
function Pulse({ a, b, offset, speed, color, motion }: { a: THREE.Vector3; b: THREE.Vector3; offset: number; speed: number; color: string; motion: number }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((s) => {
    if (!ref.current) return;
    const t = (s.clock.elapsedTime * speed * motion + offset) % 1;
    ref.current.position.lerpVectors(a, b, t);
  });
  return (
    <mesh ref={ref}>
      <sphereGeometry args={[0.028, 8, 8]} />
      <meshBasicMaterial color={color} toneMapped={false} />
    </mesh>
  );
}

function Network({ stars, types, selected, onSelect, agents, activeAgent, onPickAgent, readIds, motion }: Omit<MemorySceneProps, 'labels'> & { motion: number }) {
  const group = useRef<THREE.Group>(null);
  const centers = useMemo(() => {
    const map = new Map<string, THREE.Vector3>();
    types.forEach((t, i) => {
      const a = (i / Math.max(1, types.length)) * Math.PI * 2;
      map.set(t, new THREE.Vector3(Math.cos(a) * 2.3, Math.sin(a * 2) * 0.7, Math.sin(a) * 2.3));
    });
    return map;
  }, [types]);
  const placed = useMemo(
    () =>
      stars.map((s) => {
        const c = centers.get(s.type) ?? new THREE.Vector3();
        const r = 0.35 + (1 - s.importance) * 1.0;
        const th = hash(s.id, 1) * Math.PI * 2;
        const ph = Math.acos(2 * hash(s.id, 2) - 1);
        return { star: s, pos: new THREE.Vector3(c.x + r * Math.sin(ph) * Math.cos(th), c.y + r * Math.cos(ph), c.z + r * Math.sin(ph) * Math.sin(th)) };
      }),
    [stars, centers],
  );
  const posById = useMemo(() => new Map(placed.map((p) => [p.star.id, p.pos])), [placed]);
  /** Synapses: every memory links to its two nearest neighbours of the same kind, and to its hub. */
  const edges = useMemo(() => {
    const out: { a: THREE.Vector3; b: THREE.Vector3; color: string; key: string }[] = [];
    const seen = new Set<string>();
    for (const p of placed) {
      const same = placed.filter((q) => q !== p && q.star.type === p.star.type).sort((x, y) => x.pos.distanceTo(p.pos) - y.pos.distanceTo(p.pos)).slice(0, 2);
      for (const q of same) {
        const key = [p.star.id, q.star.id].sort().join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ a: p.pos, b: q.pos, color: p.star.color, key });
      }
      const c = centers.get(p.star.type);
      if (c) out.push({ a: c, b: p.pos, color: p.star.color, key: `h-${p.star.id}` });
    }
    return out;
  }, [placed, centers]);
  const linePts = useMemo(() => {
    const pts: number[] = [];
    for (const e of edges) pts.push(e.a.x, e.a.y, e.a.z, e.b.x, e.b.y, e.b.z);
    return new Float32Array(pts);
  }, [edges]);
  const pulses = useMemo(() => edges.filter((_, i) => i % Math.max(1, Math.floor(edges.length / 40)) === 0).slice(0, 40), [edges]);

  useFrame((s) => {
    if (group.current) group.current.rotation.y = s.clock.elapsedTime * 0.06 * motion;
  });

  const ringR = 4.6;
  return (
    <group ref={group}>
      <lineSegments>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[linePts, 3]} />
        </bufferGeometry>
        <lineBasicMaterial color="#00d4ff" transparent opacity={activeAgent ? 0.07 : 0.2} />
      </lineSegments>
      {pulses.map((e, i) => (
        <Pulse key={e.key} a={e.a} b={e.b} offset={hash(e.key, 3)} speed={0.25 + hash(e.key, 4) * 0.4} color={e.color} motion={motion || 0} />
      ))}
      {types.map((t) => (
        <mesh key={t} position={centers.get(t)!}>
          <sphereGeometry args={[0.07, 12, 12]} />
          <meshBasicMaterial color="#e6f1ff" transparent opacity={0.6} toneMapped={false} />
        </mesh>
      ))}
      {placed.map(({ star, pos }) => (
        <Neuron key={star.id} star={star} pos={pos} selected={star.id === selected} dim={!!activeAgent && !readIds.has(star.id)} lit={!!activeAgent && readIds.has(star.id)} motion={motion} onSelect={onSelect} />
      ))}
      {/* the AI employees, around the network */}
      {agents.map((a, i) => {
        const ang = (i / Math.max(1, agents.length)) * Math.PI * 2;
        const p: [number, number, number] = [Math.cos(ang) * ringR, Math.sin(i * 1.3) * 0.6, Math.sin(ang) * ringR];
        const active = a.id === activeAgent;
        return (
          <group key={a.id}>
            <mesh position={p} onClick={(e) => (e.stopPropagation(), onPickAgent(active ? null : a.id))} onPointerOver={() => (document.body.style.cursor = 'pointer')} onPointerOut={() => (document.body.style.cursor = '')}>
              <octahedronGeometry args={[active ? 0.26 : 0.18, 0]} />
              <meshBasicMaterial color={a.color} transparent opacity={active || !activeAgent ? 1 : 0.35} toneMapped={false} />
            </mesh>
            <Label3D text={a.name} dot={a.color} border={active ? a.color : 'rgba(255,255,255,0.2)'} glow={active} position={[p[0], p[1] + 0.55, p[2]]} height={0.3} />
            {active &&
              [...readIds].map((id) => {
                const to = posById.get(id);
                return to ? <Line key={id} points={[p, [to.x, to.y, to.z]]} color={a.color} transparent opacity={0.55} lineWidth={1.2} /> : null;
              })}
          </group>
        );
      })}
    </group>
  );
}

export function MemoryScene(props: MemorySceneProps) {
  const reduced = usePrefersReducedMotion();
  if (!supportsWebGL()) return <div className="fb-muted grid h-full place-items-center text-sm">{props.labels.noWebgl}</div>;
  return (
    <Canvas camera={{ position: [0, 2.2, 9.5], fov: 48 }} dpr={[1, 2]} gl={{ alpha: true, antialias: true }} onPointerMissed={() => props.onPickAgent(null)}>
      <Stars count={700} radius={18} spread={20} speed={reduced ? 0 : 0.01} size={0.08} />
      <Network {...props} motion={reduced ? 0 : 1} />
      <Glow />
      <OrbitControls enablePan={false} minDistance={4} maxDistance={16} enableDamping autoRotate={false} />
    </Canvas>
  );
}

export default MemoryScene;
