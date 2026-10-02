import { useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { voiceLevel } from '../../lib/company/voice';
import { supportsWebGL, usePrefersReducedMotion } from './webgl';

export type HoloState = 'idle' | 'listening' | 'thinking' | 'speaking';

const COLORS: Record<HoloState, string> = { idle: '#00f58a', listening: '#00d97a', thinking: '#a78bfa', speaking: '#5dffb0' };

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
            <meshBasicMaterial color="#00f58a" transparent opacity={0.35 - i * 0.07} />
          </mesh>
        ))}
      </group>
      {/* voice spectrum along the hologram's base */}
      <group ref={bars} position={[0, -2.35, 0]}>
        {Array.from({ length: 41 }, (_, i) => (
          <mesh key={i} position={[(i - 20) * 0.13, 0, 0]}>
            <boxGeometry args={[0.05, 0.5, 0.05]} />
            <meshBasicMaterial color="#5dffb0" transparent opacity={0.65} />
          </mesh>
        ))}
      </group>
      <mesh position={[0, -2.6, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1.2, 2.9, 64]} />
        <meshBasicMaterial color="#00f58a" transparent opacity={0.08} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

export function HologramScene({ state, labels }: { state: HoloState; labels: { noWebgl: string } }) {
  const reduced = usePrefersReducedMotion();
  if (!supportsWebGL()) {
    return <div className="fb-muted grid h-full place-items-center text-sm">{labels.noWebgl}</div>;
  }
  return (
    <Canvas camera={{ position: [0, 0.2, 6.2], fov: 45 }} dpr={[1, 2]} gl={{ alpha: true, antialias: true }}>
      <Hologram state={state} motion={reduced ? 0.3 : 1} />
    </Canvas>
  );
}
