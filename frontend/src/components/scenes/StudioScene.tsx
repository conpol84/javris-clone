import { useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { AgentRow } from '../../lib/company/types';
import { agentColor, type AgentState } from '../../lib/company/status';
import { Glow, Stars } from './fx';
import { Label3D } from './OfficeScene';
import { Person } from './Person';
import { resolvePersona } from '../../lib/company/persona';
import { supportsWebGL, usePrefersReducedMotion } from './webgl';

export interface StudioPower {
  id: string;
  label: string;
  color: string;
  on: boolean;
  live: boolean;
}

export interface StudioProps {
  agents: AgentRow[];
  states: Record<string, AgentState>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  powers: StudioPower[];
  onTogglePower: (id: string) => void;
  agentName: (a: AgentRow) => string;
  canManage: boolean;
  noWebgl: string;
}

function Planet({ position, color, size }: { position: [number, number, number]; color: string; size: number }) {
  return (
    <mesh position={position}>
      <sphereGeometry args={[size, 32, 32]} />
      <meshStandardMaterial color={color} roughness={0.9} emissive={color} emissiveIntensity={0.08} />
    </mesh>
  );
}

function PowerOrb({ power, angle, radius, motion, onToggle, canManage }: { power: StudioPower; angle: number; radius: number; motion: number; onToggle: () => void; canManage: boolean }) {
  const g = useRef<THREE.Group>(null);
  const orb = useRef<THREE.Mesh>(null);
  const beam = useRef<THREE.Mesh>(null);
  const [hover, setHover] = useState(false);
  const x = Math.cos(angle) * radius;
  const z = Math.sin(angle) * radius;
  useFrame(({ clock }) => {
    const t = clock.elapsedTime * motion;
    if (g.current) g.current.position.y = 1.15 + Math.sin(t * 1.3 + angle * 3) * 0.12;
    if (orb.current) {
      const s = (power.on ? 1 : 0.72) * (hover ? 1.18 : 1);
      orb.current.scale.lerp(new THREE.Vector3(s, s, s), 0.15);
      orb.current.rotation.y = t * 0.8;
    }
    if (beam.current) (beam.current.material as THREE.MeshBasicMaterial).opacity = power.on ? 0.35 + Math.sin(t * 4 + angle) * 0.12 : 0;
  });
  const len = Math.hypot(x, z);
  return (
    <group position={[x, 0, z]}>
      {/* energy beam to the agent, only while equipped */}
      <mesh ref={beam} position={[-x / 2, 1.0, -z / 2]} rotation={[0, -Math.atan2(z, x) + Math.PI / 2, Math.PI / 2]}>
        <cylinderGeometry args={[0.012, 0.012, len, 6]} />
        <meshBasicMaterial color={power.color} transparent opacity={0} toneMapped={false} />
      </mesh>
      <group ref={g}>
        <mesh
          ref={orb}
          onClick={(e) => (e.stopPropagation(), canManage && onToggle())}
          onPointerOver={(e) => (e.stopPropagation(), setHover(true), (document.body.style.cursor = canManage ? 'pointer' : 'default'))}
          onPointerOut={() => (setHover(false), (document.body.style.cursor = ''))}
        >
          <icosahedronGeometry args={[0.3, 1]} />
          <meshStandardMaterial color={power.on ? power.color : '#1b2a24'} emissive={power.color} emissiveIntensity={power.on ? 0.9 : 0.05} roughness={0.25} metalness={0.5} wireframe={!power.on} />
        </mesh>
        <Label3D text={power.label} sub={power.live ? '●' : undefined} dot={power.on ? power.color : '#475569'} border={power.on ? power.color : 'rgba(255,255,255,0.18)'} glow={power.on} position={[0, 0.62, 0]} height={0.34} />
      </group>
    </group>
  );
}

function Hangar({ agents, states, selectedId, onSelect, agentName }: Pick<StudioProps, 'agents' | 'states' | 'selectedId' | 'onSelect' | 'agentName'>) {
  const others = agents.filter((a) => a.id !== selectedId);
  return (
    <>
      {others.map((a, i) => {
        const ang = (i / Math.max(1, others.length)) * Math.PI * 2 + 0.4;
        const r = 7.5;
        const color = agentColor(a.type, a.slug);
        return (
          <group key={a.id} position={[Math.cos(ang) * r, -0.2, Math.sin(ang) * r]} rotation={[0, -ang - Math.PI / 2, 0]} scale={0.8}>
            <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <ringGeometry args={[0.45, 0.55, 40]} />
              <meshBasicMaterial color={color} toneMapped={false} transparent opacity={0.8} />
            </mesh>
            <mesh
              position={[0, 0.8, 0]}
              visible={false}
              onClick={(e) => (e.stopPropagation(), onSelect(a.id))}
              onPointerOver={() => (document.body.style.cursor = 'pointer')}
              onPointerOut={() => (document.body.style.cursor = '')}
            >
              <boxGeometry args={[1, 1.9, 1]} />
            </mesh>
            <Person persona={resolvePersona(a)} color={color} state={states[a.id] ?? 'idle'} />
            <Label3D text={agentName(a)} dot={color} border={color} position={[0, 1.95, 0]} height={0.4} />
          </group>
        );
      })}
    </>
  );
}

function Scene(props: StudioProps) {
  const reduced = usePrefersReducedMotion();
  const motion = reduced ? 0 : 1;
  const selected = props.agents.find((a) => a.id === props.selectedId) ?? props.agents[0] ?? null;
  const spin = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (spin.current) spin.current.rotation.y += dt * 0.12 * motion;
  });
  const color = selected ? agentColor(selected.type, selected.slug) : '#22d3ee';
  return (
    <>
      <color attach="background" args={['#02060e']} />
      <fog attach="fog" args={['#02060e', 40, 95]} />
      <ambientLight intensity={0.55} />
      <directionalLight position={[6, 10, 8]} intensity={1.2} color="#d6f0ff" />
      <pointLight position={[0, 3, 0]} intensity={18} color={color} distance={14} />
      <Stars speed={0.01 * motion} count={1800} radius={30} spread={50} />
      <Planet position={[-26, 8, -34]} color="#0c2f4a" size={7} />
      <Planet position={[34, -6, -40]} color="#2a1b4d" size={5} />
      {/* docking platform */}
      <mesh position={[0, -0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[3.3, 64]} />
        <meshStandardMaterial color="#0a1424" metalness={0.8} roughness={0.35} />
      </mesh>
      <mesh position={[0, 0, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[3.2, 3.3, 96]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
      {selected && (
        <group scale={1.7} position={[0, 0, 0]}>
          <Person persona={resolvePersona(selected)} color={color} state={props.states[selected.id] ?? 'idle'} />
        </group>
      )}
      {selected && <Label3D text={props.agentName(selected)} dot={color} border={color} glow position={[0, 4.3, 0]} height={0.62} />}
      <group ref={spin}>
        {props.powers.map((p, i) => (
          <PowerOrb key={p.id} power={p} angle={(i / Math.max(1, props.powers.length)) * Math.PI * 2} radius={3.0} motion={motion} onToggle={() => props.onTogglePower(p.id)} canManage={props.canManage} />
        ))}
      </group>
      <Hangar {...props} />
      <Glow vignette />
      <OrbitControls makeDefault enablePan={false} target={[0, 2.2, 0]} minDistance={6} maxDistance={22} minPolarAngle={0.5} maxPolarAngle={1.55} enableDamping autoRotate={!reduced} autoRotateSpeed={0.4} />
    </>
  );
}

/** Space hangar: the chosen agent stands on a platform, its powers orbit it. Click an orb to equip or remove a power. */
export function StudioScene(props: StudioProps) {
  const reduced = usePrefersReducedMotion();
  if (!supportsWebGL()) {
    return <div className="fb-muted grid h-full w-full place-items-center p-6 text-center text-sm">{props.noWebgl}</div>;
  }
  return (
    <Canvas dpr={[1, 1.6]} camera={{ position: [8, 5, 10], fov: 40 }} gl={{ antialias: true, powerPreference: 'high-performance' }} frameloop={reduced ? 'demand' : 'always'}>
      <Scene {...props} />
    </Canvas>
  );
}

export default StudioScene;
