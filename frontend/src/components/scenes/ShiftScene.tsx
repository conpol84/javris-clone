import { Glow } from './fx';
import { useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { supportsWebGL, usePrefersReducedMotion } from './webgl';

export interface ShiftDot {
  id: string;
  hour: number;
  cadence: 'hourly' | 'daily' | 'weekdays' | 'weekly';
  color: string;
  enabled: boolean;
}

export interface ShiftSceneProps {
  shifts: ShiftDot[];
  /** Pre-translated: the WebGL canvas is a separate React root and cannot read i18n context. */
  labels: { noWebgl: string };
}

const R = 3.1;
const angleOf = (hour: number) => -(hour / 24) * Math.PI * 2 + Math.PI / 2; // 00:00 at the top, clockwise

function numeral(text: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#7dd3fc';
  g.font = '600 40px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 64, 34);
  return new THREE.CanvasTexture(c);
}

function glow(color: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, `${color}ff`);
  grad.addColorStop(0.4, `${color}55`);
  grad.addColorStop(1, `${color}00`);
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

function Dot({ shift, motion }: { shift: ShiftDot; motion: number }) {
  const halo = useRef<THREE.Sprite>(null);
  const tex = useMemo(() => glow(shift.color), [shift.color]);
  const a = angleOf(shift.hour);
  const x = Math.cos(a) * R;
  const y = Math.sin(a) * R;
  const size = shift.cadence === 'weekly' ? 0.16 : shift.cadence === 'weekdays' ? 0.2 : 0.26;
  useFrame((s) => {
    if (!halo.current) return;
    const now = new Date();
    const live = shift.enabled && now.getHours() === shift.hour;
    halo.current.scale.setScalar((live ? 1.7 + Math.sin(s.clock.elapsedTime * 5 * motion) * 0.3 : 1.1) * 1.3);
  });
  return (
    <group position={[x, y, 0]}>
      <sprite ref={halo} scale={[1.4, 1.4, 1]}>
        <spriteMaterial map={tex} transparent opacity={shift.enabled ? 0.9 : 0.2} blending={THREE.AdditiveBlending} depthWrite={false} />
      </sprite>
      <mesh>
        <sphereGeometry args={[size, 20, 20]} />
        <meshStandardMaterial color={shift.color} emissive={shift.color} emissiveIntensity={shift.enabled ? 1 : 0.15} />
      </mesh>
    </group>
  );
}

function Dial({ shifts, motion }: { shifts: ShiftDot[]; motion: number }) {
  const group = useRef<THREE.Group>(null);
  const hand = useRef<THREE.Group>(null);
  const nums = useMemo(() => [0, 6, 12, 18].map((h) => ({ h, tex: numeral(String(h).padStart(2, '0')) })), []);
  const ticks = useMemo(() => Array.from({ length: 24 }, (_, h) => h), []);
  useFrame((s) => {
    const d = new Date();
    const hours = d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
    if (hand.current) hand.current.rotation.z = angleOf(hours) - Math.PI / 2;
    if (group.current) {
      group.current.rotation.x = -0.5 + s.pointer.y * 0.1 * motion;
      group.current.rotation.z = Math.sin(s.clock.elapsedTime * 0.2 * motion) * 0.08 + s.pointer.x * 0.15 * motion;
    }
  });
  return (
    <group ref={group} position={[0, 0.1, 0]}>
      <ambientLight intensity={0.7} />
      <pointLight position={[0, 0, 5]} intensity={30} color="#00d4ff" />
      <mesh>
        <circleGeometry args={[R + 0.7, 96]} />
        <meshBasicMaterial color="#06121f" transparent opacity={0.75} />
      </mesh>
      <mesh>
        <torusGeometry args={[R, 0.02, 8, 160]} />
        <meshBasicMaterial color="#00d4ff" transparent opacity={0.85} />
      </mesh>
      <mesh>
        <torusGeometry args={[R - 0.55, 0.008, 8, 160]} />
        <meshBasicMaterial color="#a78bfa" transparent opacity={0.45} />
      </mesh>
      {ticks.map((h) => {
        const a = angleOf(h);
        const big = h % 6 === 0;
        return (
          <mesh key={h} position={[Math.cos(a) * (R - 0.18), Math.sin(a) * (R - 0.18), 0]} rotation={[0, 0, a]}>
            <boxGeometry args={[big ? 0.3 : 0.14, 0.03, 0.03]} />
            <meshBasicMaterial color={big ? '#e0fbff' : '#38bdf8'} />
          </mesh>
        );
      })}
      {nums.map(({ h, tex }) => {
        const a = angleOf(h);
        return (
          <sprite key={h} position={[Math.cos(a) * (R + 0.55), Math.sin(a) * (R + 0.55), 0]} scale={[0.8, 0.4, 1]}>
            <spriteMaterial map={tex} transparent depthWrite={false} />
          </sprite>
        );
      })}
      {shifts.filter((s) => s.cadence === 'hourly' && s.enabled).map((s) => (
        <mesh key={`ring-${s.id}`}>
          <torusGeometry args={[R - 0.28, 0.012, 8, 160]} />
          <meshBasicMaterial color={s.color} transparent opacity={0.5} />
        </mesh>
      ))}
      {shifts.filter((s) => s.cadence !== 'hourly').map((s) => <Dot key={s.id} shift={s} motion={motion} />)}
      <group ref={hand}>
        <mesh position={[0, (R - 0.3) / 2, 0]}>
          <boxGeometry args={[0.04, R - 0.3, 0.04]} />
          <meshBasicMaterial color="#ffffff" toneMapped={false} />
        </mesh>
        <mesh>
          <sphereGeometry args={[0.14, 16, 16]} />
          <meshBasicMaterial color="#ffffff" toneMapped={false} />
        </mesh>
      </group>
    </group>
  );
}

export function ShiftScene(props: ShiftSceneProps) {
  const reduced = usePrefersReducedMotion();
  if (!supportsWebGL()) {
    return <div className="fb-muted grid h-full place-items-center p-6 text-center text-sm">{props.labels.noWebgl}</div>;
  }
  return (
    <Canvas camera={{ position: [0, 0.4, 9.6], fov: 44 }} dpr={[1, 1.75]} gl={{ antialias: true }} style={{ background: 'transparent' }}>
      <Dial shifts={props.shifts} motion={reduced ? 0 : 1} />
      <Glow />
    </Canvas>
  );
}

export default ShiftScene;
