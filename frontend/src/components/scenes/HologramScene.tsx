import { useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { Line } from '@react-three/drei';
import { voiceLevel } from '../../lib/company/voice';
import { Glow, Stars } from './fx';
import { Person } from './Person';
import type { Persona } from '../../lib/company/persona';
import { supportsWebGL, usePrefersReducedMotion } from './webgl';

export type HoloState = 'idle' | 'listening' | 'thinking' | 'speaking';

/** One AI employee shown as a satellite of the CEO; it lights up while it works. */
export interface Satellite {
  id: string;
  color: string;
  active: boolean;
}

const COLORS: Record<HoloState, string> = { idle: '#00d4ff', listening: '#34d399', thinking: '#a78bfa', speaking: '#67e8f9' };

function Hologram({ state, motion }: { state: HoloState; motion: number }) {
  const core = useRef<THREE.Mesh>(null);
  const shell = useRef<THREE.Points>(null);
  const rings = useRef<THREE.Group>(null);
  const bars = useRef<THREE.Group>(null);
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  const pmat = useRef<THREE.PointsMaterial>(null);
  const smooth = useRef(0);
  const color = useMemo(() => new THREE.Color(COLORS.idle), []);

  const positions = useMemo(() => {
    const n = 1400;
    const a = new Float32Array(n * 3);
    const g = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < n; i++) {
      const y = 1 - (i / (n - 1)) * 2;
      const r = Math.sqrt(1 - y * y);
      a[i * 3] = Math.cos(g * i) * r * 1.5;
      a[i * 3 + 1] = y * 1.5;
      a[i * 3 + 2] = Math.sin(g * i) * r * 1.5;
    }
    return a;
  }, []);

  useFrame((s, dt) => {
    const t = s.clock.elapsedTime * motion;
    const target = state === 'speaking' ? voiceLevel.value : state === 'listening' ? 0.25 + Math.sin(t * 6) * 0.1 : state === 'thinking' ? 0.3 + Math.sin(t * 9) * 0.15 : 0.08 + Math.sin(t * 1.4) * 0.04;
    smooth.current += (target - smooth.current) * Math.min(1, dt * 10);
    const l = smooth.current;
    color.lerp(new THREE.Color(COLORS[state]), Math.min(1, dt * 4));
    if (mat.current) mat.current.color.copy(color);
    if (pmat.current) pmat.current.color.copy(color);
    if (core.current) core.current.scale.setScalar(0.62 + l * 0.55);
    if (shell.current) {
      shell.current.rotation.y = t * (state === 'thinking' ? 0.9 : 0.18);
      shell.current.scale.setScalar(1 + l * 0.22);
    }
    if (rings.current) {
      rings.current.rotation.z = t * 0.25;
      rings.current.rotation.x = Math.sin(t * 0.4) * 0.35 + 1.1;
    }
    if (bars.current) {
      bars.current.children.forEach((c, i) => {
        const wave = 0.15 + (Math.sin(t * 7 + i * 0.7) * 0.5 + 0.5) * l * 2.4;
        c.scale.y = Math.max(0.06, wave);
      });
    }
  });

  return (
    <group>
      <mesh ref={core}>
        <icosahedronGeometry args={[1, 3]} />
        <meshBasicMaterial ref={mat} wireframe transparent opacity={0.75} />
      </mesh>
      <points ref={shell}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        </bufferGeometry>
        <pointsMaterial ref={pmat} size={0.022} transparent opacity={0.8} sizeAttenuation depthWrite={false} blending={THREE.AdditiveBlending} />
      </points>
      <group ref={rings}>
        {[1.9, 2.25, 2.6].map((r, i) => (
          <mesh key={r} rotation={[0, 0, i]}>
            <torusGeometry args={[r, 0.006, 8, 160]} />
            <meshBasicMaterial color="#00d4ff" transparent opacity={0.35 - i * 0.07} />
          </mesh>
        ))}
      </group>
      {/* voice spectrum along the hologram's base */}
      <group ref={bars} position={[0, -2.35, 0]}>
        {Array.from({ length: 41 }, (_, i) => (
          <mesh key={i} position={[(i - 20) * 0.13, 0, 0]}>
            <boxGeometry args={[0.05, 0.5, 0.05]} />
            <meshBasicMaterial color="#67e8f9" transparent opacity={0.65} />
          </mesh>
        ))}
      </group>
      <mesh position={[0, -2.6, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1.2, 2.9, 64]} />
        <meshBasicMaterial color="#00d4ff" transparent opacity={0.08} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}


function Satellites({ items, state, motion }: { items: Satellite[]; state: HoloState; motion: number }) {
  const g = useRef<THREE.Group>(null);
  useFrame((s, dt) => {
    if (g.current) g.current.rotation.y += dt * (state === 'thinking' ? 0.5 : 0.12) * motion;
    void s;
  });
  return (
    <group ref={g}>
      {items.map((it, i) => {
        const a = (i / Math.max(1, items.length)) * Math.PI * 2;
        const r = 4.1 + (i % 3) * 0.4;
        const y = Math.sin(i * 1.7) * 0.9;
        const p: [number, number, number] = [Math.cos(a) * r, y, Math.sin(a) * r];
        return (
          <group key={it.id}>
            <mesh position={p}>
              <octahedronGeometry args={[it.active ? 0.11 : 0.07, 0]} />
              <meshBasicMaterial color={it.color} toneMapped={false} transparent opacity={it.active ? 1 : 0.45} />
            </mesh>
            <Line points={[[0, 0, 0], p]} color={it.color} transparent opacity={it.active || state === 'thinking' ? 0.55 : 0.1} lineWidth={1} />
          </group>
        );
      })}
    </group>
  );
}

/** The CEO as a full-body hologram: stands in front of the neural shell, gestures while speaking, and is scanned by a moving light. */
function CeoBody({ persona, state }: { persona: Persona; state: HoloState }) {
  const scan = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (scan.current) scan.current.position.y = -2.5 + ((clock.elapsedTime * 0.45) % 1) * 4.3;
  });
  return (
    <group position={[0, -2.5, 0.6]} scale={2.1}>
      <Person persona={persona} color="#f59e0b" state="idle" speaking={state === 'speaking'} />
      <mesh ref={scan} position={[0, 0, 0]} rotation={[-Math.PI / 2, 0, 0]} visible>
        <ringGeometry args={[0.35, 0.42, 48]} />
        <meshBasicMaterial color="#67e8f9" transparent opacity={0.55} toneMapped={false} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
    </group>
  );
}

export function HologramScene({ state, labels, satellites = [], persona }: { state: HoloState; labels: { noWebgl: string }; satellites?: Satellite[]; persona?: Persona }) {
  const reduced = usePrefersReducedMotion();
  if (!supportsWebGL()) {
    return <div className="fb-muted grid h-full place-items-center text-sm">{labels.noWebgl}</div>;
  }
  return (
    <Canvas camera={{ position: [0, 0.4, 7.4], fov: 45 }} dpr={[1, 2]} gl={{ alpha: true, antialias: true }}>
      <Stars count={900} radius={14} spread={22} speed={reduced ? 0 : 0.012} size={0.09} />
      <group position={[0, 0, -1.4]}>
        <Hologram state={state} motion={reduced ? 0.3 : 1} />
      </group>
      {persona && (
        <>
          <ambientLight intensity={0.8} />
          <pointLight position={[2, 3, 4]} intensity={30} color="#e8f4ff" />
          <CeoBody persona={persona} state={state} />
        </>
      )}
      <Satellites items={satellites} state={state} motion={reduced ? 0.3 : 1} />
      <Glow strength={1.1} threshold={0.2} />
    </Canvas>
  );
}
