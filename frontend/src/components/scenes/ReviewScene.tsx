import { Glow } from './fx';
import { useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { supportsWebGL, usePrefersReducedMotion } from './webgl';

export interface ReviewTower {
  id: string;
  name: string;
  /** 0..100, or null while there is nothing to judge. */
  score: number | null;
  color: string;
}

export interface ReviewSceneProps {
  towers: ReviewTower[];
  selected: string | null;
  onSelect: (id: string) => void;
  /** Pre-translated: the WebGL canvas is a separate React root and cannot read i18n context. */
  labels: { noWebgl: string };
}

function label(text: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 384;
  c.height = 72;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ecfdf3';
  g.font = '600 34px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  let t = text;
  while (g.measureText(t).width > 360 && t.length > 4) t = t.slice(0, -2);
  g.fillText(t === text ? t : `${t}…`, 192, 38);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function Tower({ tower, x, selected, motion, onSelect }: { tower: ReviewTower; x: number; selected: boolean; motion: number; onSelect: (id: string) => void }) {
  const bar = useRef<THREE.Mesh>(null);
  const target = tower.score === null ? 0.12 : Math.max(0.12, (tower.score / 100) * 3.4);
  const tex = useMemo(() => label(tower.name), [tower.name]);
  useFrame((s, dt) => {
    const m = bar.current;
    if (!m) return;
    const h = m.scale.y + (target - m.scale.y) * Math.min(1, dt * 4);
    m.scale.y = h;
    m.position.y = h / 2;
    m.rotation.y = s.clock.elapsedTime * 0.35 * motion;
  });
  return (
    <group position={[x, 0, 0]}>
      <mesh
        ref={bar}
        scale={[1, 0.12, 1]}
        onClick={(e) => (e.stopPropagation(), onSelect(tower.id))}
        onPointerOver={() => (document.body.style.cursor = 'pointer')}
        onPointerOut={() => (document.body.style.cursor = '')}
      >
        <cylinderGeometry args={[0.38, 0.38, 1, 6]} />
        <meshStandardMaterial color={tower.score === null ? '#475569' : tower.color} emissive={tower.color} emissiveIntensity={selected ? 0.9 : 0.35} transparent opacity={tower.score === null ? 0.5 : 0.92} />
      </mesh>
      <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.45, selected ? 0.62 : 0.52, 32]} />
        <meshBasicMaterial color={selected ? '#ffffff' : tower.color} transparent opacity={selected ? 0.9 : 0.45} />
      </mesh>
      <sprite position={[0, -0.35, 0.6]} scale={[1.6, 0.3, 1]}>
        <spriteMaterial map={tex} transparent depthWrite={false} />
      </sprite>
    </group>
  );
}

export function ReviewScene({ towers, selected, onSelect, labels }: ReviewSceneProps) {
  const reduced = usePrefersReducedMotion();
  if (!supportsWebGL()) return <div className="fb-muted grid h-full place-items-center text-sm">{labels.noWebgl}</div>;
  const gap = 1.15;
  const width = Math.max(1, towers.length - 1) * gap;
  return (
    <Canvas camera={{ position: [0, 2.6, Math.max(6.5, width * 0.85 + 4)], fov: 45 }} dpr={[1, 2]} gl={{ alpha: true, antialias: true }}>
      <ambientLight intensity={0.8} />
      <pointLight position={[0, 6, 6]} intensity={40} />
      <group position={[-width / 2, -1.4, 0]}>
        {towers.map((tw, i) => (
          <Tower key={tw.id} tower={tw} x={i * gap} selected={tw.id === selected} motion={reduced ? 0 : 1} onSelect={onSelect} />
        ))}
      </group>
      <gridHelper args={[Math.max(10, width + 4), 20, '#00f58a', '#1f4a35']} position={[0, -1.41, 0]} />
      <Glow />
    </Canvas>
  );
}
