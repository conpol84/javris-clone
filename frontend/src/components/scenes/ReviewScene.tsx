import { useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { Persona } from '../../lib/company/persona';
import type { AgentState } from '../../lib/company/status';
import { Glow, Stars } from './fx';
import { Label3D } from './OfficeScene';
import { Person } from './Person';
import { supportsWebGL, usePrefersReducedMotion } from './webgl';

export interface ReviewTower {
  id: string;
  name: string;
  /** 0..100, or null while there is nothing to judge. */
  score: number | null;
  color: string;
  persona: Persona;
  /** Winners celebrate. */
  state: AgentState;
}

export interface ReviewSceneProps {
  towers: ReviewTower[];
  selected: string | null;
  onSelect: (id: string) => void;
  /** Pre-translated: the WebGL canvas is a separate React root and cannot read i18n context. */
  labels: { noWebgl: string };
}

/** Falling light confetti around the winners. */
function Confetti({ motion }: { motion: number }) {
  const ref = useRef<THREE.Points>(null);
  const n = 160;
  const { pos, vel } = useMemo(() => {
    const p = new Float32Array(n * 3);
    const v = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      p[i * 3] = (Math.random() - 0.5) * 7;
      p[i * 3 + 1] = Math.random() * 6;
      p[i * 3 + 2] = (Math.random() - 0.5) * 3 - 0.5;
      v[i] = 0.25 + Math.random() * 0.5;
    }
    return { pos: p, vel: v };
  }, []);
  useFrame((_, dt) => {
    const g = ref.current?.geometry.attributes.position as THREE.BufferAttribute | undefined;
    if (!g || !motion) return;
    for (let i = 0; i < n; i++) {
      let y = g.getY(i) - vel[i] * dt;
      if (y < 0) y = 6;
      g.setY(i, y);
    }
    g.needsUpdate = true;
  });
  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[pos, 3]} />
      </bufferGeometry>
      <pointsMaterial size={0.07} color="#fbbf24" transparent opacity={0.9} sizeAttenuation depthWrite={false} blending={THREE.AdditiveBlending} />
    </points>
  );
}

function Contestant({ tower, rank, position, height, scale, selected, onSelect }: { tower: ReviewTower; rank: number; position: [number, number]; height: number; scale: number; selected: boolean; onSelect: (id: string) => void }) {
  const g = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (g.current) g.current.scale.setScalar(THREE.MathUtils.lerp(g.current.scale.x, selected ? scale * 1.15 : scale, Math.min(1, dt * 6)));
  });
  const medal = rank === 1 ? '#fbbf24' : rank === 2 ? '#cbd5e1' : rank === 3 ? '#d6894a' : null;
  return (
    <group position={[position[0], 0, position[1]]}>
      {height > 0 && (
        <mesh position={[0, height / 2, 0]}>
          <boxGeometry args={[1.3, height, 1.1]} />
          <meshStandardMaterial color="#0a1424" metalness={0.7} roughness={0.35} emissive={medal ?? '#22d3ee'} emissiveIntensity={0.18} />
        </mesh>
      )}
      <group ref={g} position={[0, height, 0]} scale={scale}>
        <mesh
          position={[0, 1, 0]}
          visible={false}
          onClick={(e) => (e.stopPropagation(), onSelect(tower.id))}
          onPointerOver={() => (document.body.style.cursor = 'pointer')}
          onPointerOut={() => (document.body.style.cursor = '')}
        >
          <boxGeometry args={[0.9, 2.2, 0.9]} />
        </mesh>
        <Person persona={tower.persona} color={tower.color} state={tower.state} />
        <Label3D text={tower.name} sub={tower.score === null ? '–' : String(tower.score)} dot={medal ?? tower.color} border={selected ? '#ffffff' : medal ?? tower.color} glow={selected || rank <= 3} position={[0, 2.35, 0]} height={rank <= 3 ? 0.36 : 0.28} />
      </group>
      {medal && (
        <mesh position={[0, height + 0.01, 0.62]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.2, 0.28, 24]} />
          <meshBasicMaterial color={medal} toneMapped={false} />
        </mesh>
      )}
    </group>
  );
}

function Scene({ towers, selected, onSelect, motion }: Omit<ReviewSceneProps, 'labels'> & { motion: number }) {
  const winners = towers.slice(0, 3);
  const rest = towers.slice(3);
  const podium: [number, number, number][] = [
    [0, 0, 0.9],
    [-1.7, 0, 0.55],
    [1.7, 0, 0.3],
  ];
  const per = Math.max(1, Math.ceil(rest.length / 2));
  return (
    <>
      <color attach="background" args={['#02070f']} />
      <fog attach="fog" args={['#02070f', 14, 34]} />
      <ambientLight intensity={0.5} />
      <spotLight position={[0, 8, 5]} angle={0.5} penumbra={0.8} intensity={160} color="#fff4d6" />
      <pointLight position={[-6, 3, 3]} intensity={12} color="#60a5fa" distance={14} />
      <pointLight position={[6, 3, 3]} intensity={12} color="#22d3ee" distance={14} />
      <Stars count={700} radius={22} spread={16} speed={0.008 * motion} size={0.09} />
      <mesh position={[0, -0.02, -1]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[9, 80]} />
        <meshStandardMaterial color="#050a14" metalness={0.85} roughness={0.3} />
      </mesh>
      <mesh position={[0, 0, -1]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[8.9, 9, 120]} />
        <meshBasicMaterial color="#fbbf24" toneMapped={false} />
      </mesh>
      {winners.map((tw, i) => (
        <Contestant key={tw.id} tower={tw} rank={i + 1} position={[podium[i][0], 0]} height={podium[i][2]} scale={1} selected={tw.id === selected} onSelect={onSelect} />
      ))}
      {rest.map((tw, i) => {
        const row = i < per ? 0 : 1;
        const idx = row === 0 ? i : i - per;
        const inRow = row === 0 ? Math.min(per, rest.length) : rest.length - per;
        const x = (idx - (inRow - 1) / 2) * 1.5;
        return <Contestant key={tw.id} tower={tw} rank={i + 4} position={[x, -2.2 - row * 1.8]} height={0} scale={0.82} selected={tw.id === selected} onSelect={onSelect} />;
      })}
      {winners.length > 0 && <Confetti motion={motion} />}
      <Glow strength={0.7} threshold={0.4} vignette />
      <OrbitControls enablePan={false} target={[0, 1.2, -0.5]} minDistance={5} maxDistance={16} minPolarAngle={0.9} maxPolarAngle={1.55} minAzimuthAngle={-0.8} maxAzimuthAngle={0.8} enableDamping />
    </>
  );
}

/** An awards ceremony: the best performers stand on the podium, everyone else behind, scores above their heads. */
export function ReviewScene({ towers, selected, onSelect, labels }: ReviewSceneProps) {
  const reduced = usePrefersReducedMotion();
  if (!supportsWebGL()) return <div className="fb-muted grid h-full place-items-center text-sm">{labels.noWebgl}</div>;
  return (
    <Canvas dpr={[1, 1.6]} camera={{ position: [0, 3.2, 9.5], fov: 42 }} gl={{ antialias: true }}>
      <Scene towers={towers} selected={selected} onSelect={onSelect} motion={reduced ? 0 : 1} />
    </Canvas>
  );
}

export default ReviewScene;
