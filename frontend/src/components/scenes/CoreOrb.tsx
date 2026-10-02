import { useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { supportsWebGL, usePrefersReducedMotion } from './webgl';

export interface OrbSatellite {
  id: string;
  color: string;
  active: boolean;
}

function fibonacciSphere(count: number, radius: number): Float32Array {
  const pts = new Float32Array(count * 3);
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const y = 1 - (i / (count - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const th = golden * i;
    pts[i * 3] = Math.cos(th) * r * radius;
    pts[i * 3 + 1] = y * radius;
    pts[i * 3 + 2] = Math.sin(th) * r * radius;
  }
  return pts;
}

function glowTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(200,255,220,1)');
  grad.addColorStop(0.25, 'rgba(0, 245, 138,0.55)');
  grad.addColorStop(1, 'rgba(0, 245, 138,0)');
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

function Scene({ satellites, motion, onSelect }: { satellites: OrbSatellite[]; motion: number; onSelect?: (id: string) => void }) {
  const group = useRef<THREE.Group>(null);
  const points = useRef<THREE.Points>(null);
  const rings = useRef<(THREE.Mesh | null)[]>([]);
  const positions = useMemo(() => fibonacciSphere(1500, 1.45), []);
  const glow = useMemo(() => glowTexture(), []);

  useFrame((s, dt) => {
    const t = s.clock.elapsedTime * motion;
    if (points.current) {
      points.current.rotation.y = t * 0.12;
      points.current.rotation.x = Math.sin(t * 0.15) * 0.12;
    }
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
        <spriteMaterial map={glow} transparent opacity={0.8} blending={THREE.AdditiveBlending} depthWrite={false} />
      </sprite>
      <points ref={points}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        </bufferGeometry>
        <pointsMaterial
          color="#5dffb0"
          size={0.026}
          sizeAttenuation
          transparent
          opacity={0.9}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </points>
      <mesh>
        <icosahedronGeometry args={[1.38, 2]} />
        <meshBasicMaterial color="#00f58a" wireframe transparent opacity={0.13} />
      </mesh>
      <mesh>
        <icosahedronGeometry args={[0.55, 1]} />
        <meshBasicMaterial color="#b9ffda" wireframe transparent opacity={0.55} toneMapped={false} />
      </mesh>
      {[1.9, 2.18, 2.46].map((r, i) => (
        <mesh
          key={r}
          ref={(el) => {
            rings.current[i] = el;
          }}
          rotation={[Math.PI / 2 - (i * 0.55 + 0.25), 0, 0]}
        >
          <torusGeometry args={[r, 0.0035, 8, 160]} />
          <meshBasicMaterial color={i === 1 ? '#d2ff6b' : '#00d97a'} transparent opacity={0.5} />
        </mesh>
      ))}
      {satellites.map((s, i) => (
        <Satellite key={s.id} sat={s} index={i} total={satellites.length} motion={motion} onSelect={onSelect} />
      ))}
    </group>
  );
}

function Fallback() {
  return (
    <div className="fb-ring-fallback" aria-hidden="true">
      {[180, 250, 320].map((d, i) => (
        <span key={d} style={{ width: d, height: d, animationDuration: `${14 + i * 6}s`, animationDirection: i % 2 ? 'reverse' : 'normal' }} />
      ))}
    </div>
  );
}

/** Animated AI core. Falls back to CSS rings without WebGL. */
export function CoreOrb({ satellites = [], className, onSelect }: { satellites?: OrbSatellite[]; className?: string; onSelect?: (id: string) => void }) {
  const reduced = usePrefersReducedMotion();
  if (!supportsWebGL()) {
    return (
      <div className={className} aria-hidden="true">
        <Fallback />
      </div>
    );
  }
  return (
    <div className={className} aria-hidden="true">
      <Canvas
        style={{ position: 'absolute', inset: 0 }}
        dpr={[1, 1.75]}
        camera={{ position: [0, 0, 7.2], fov: 42 }}
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
        frameloop={reduced ? 'demand' : 'always'}
      >
        <Scene satellites={satellites} motion={reduced ? 0 : 1} onSelect={onSelect} />
      </Canvas>
    </div>
  );
}

export default CoreOrb;
