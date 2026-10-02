import { Glow } from './fx';
import { useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { supportsWebGL, usePrefersReducedMotion } from './webgl';

export interface MemoryStar {
  id: string;
  type: string;
  importance: number;
  color: string;
}

export interface MemorySceneProps {
  stars: MemoryStar[];
  /** Cluster centres by type, so each kind of memory forms its own constellation. */
  types: string[];
  selected: string | null;
  onSelect: (id: string) => void;
  labels: { noWebgl: string };
}

/** Stable pseudo-random in [0,1) from a string. */
function hash(s: string, salt: number): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10000) / 10000;
}

function Star({ star, pos, selected, motion, onSelect }: { star: MemoryStar; pos: THREE.Vector3; selected: boolean; motion: number; onSelect: (id: string) => void }) {
  const ref = useRef<THREE.Mesh>(null);
  const size = 0.07 + star.importance * 0.16;
  useFrame((s) => {
    const m = ref.current;
    if (!m) return;
    const pulse = 1 + Math.sin(s.clock.elapsedTime * 2 * motion + hash(star.id, 7) * 6) * 0.12 + (selected ? 0.5 : 0);
    m.scale.setScalar(pulse);
  });
  return (
    <mesh
      ref={ref}
      position={pos}
      onClick={(e) => (e.stopPropagation(), onSelect(star.id))}
      onPointerOver={() => (document.body.style.cursor = 'pointer')}
      onPointerOut={() => (document.body.style.cursor = '')}
    >
      <icosahedronGeometry args={[size, 1]} />
      <meshBasicMaterial color={selected ? '#ffffff' : star.color} transparent opacity={0.95} />
    </mesh>
  );
}

function Galaxy({ stars, types, selected, motion, onSelect }: Omit<MemorySceneProps, 'labels'> & { motion: number }) {
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
  const lines = useMemo(() => {
    const pts: number[] = [];
    for (const p of placed) {
      const c = centers.get(p.star.type) ?? new THREE.Vector3();
      pts.push(c.x, c.y, c.z, p.pos.x, p.pos.y, p.pos.z);
    }
    return new Float32Array(pts);
  }, [placed, centers]);
  useFrame((s) => {
    if (group.current) group.current.rotation.y = s.clock.elapsedTime * 0.08 * motion;
  });
  return (
    <group ref={group}>
      <lineSegments>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[lines, 3]} />
        </bufferGeometry>
        <lineBasicMaterial color="#00f58a" transparent opacity={0.16} />
      </lineSegments>
      {types.map((t) => {
        const c = centers.get(t)!;
        return (
          <mesh key={t} position={c}>
            <sphereGeometry args={[0.06, 12, 12]} />
            <meshBasicMaterial color="#ecfdf3" transparent opacity={0.5} />
          </mesh>
        );
      })}
      {placed.map(({ star, pos }) => (
        <Star key={star.id} star={star} pos={pos} selected={star.id === selected} motion={motion} onSelect={onSelect} />
      ))}
    </group>
  );
}

export function MemoryScene(props: MemorySceneProps) {
  const reduced = usePrefersReducedMotion();
  if (!supportsWebGL()) return <div className="fb-muted grid h-full place-items-center text-sm">{props.labels.noWebgl}</div>;
  return (
    <Canvas camera={{ position: [0, 1.2, 7], fov: 50 }} dpr={[1, 2]} gl={{ alpha: true, antialias: true }}>
      <Galaxy stars={props.stars} types={props.types} selected={props.selected} onSelect={props.onSelect} motion={reduced ? 0 : 1} />
      <Glow />
    </Canvas>
  );
}
