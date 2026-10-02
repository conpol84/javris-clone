import { useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { AgentRow } from '../../lib/company/types';
import { resolvePersona, type Persona } from '../../lib/company/persona';
import { agentColor, type AgentState } from '../../lib/company/status';
import { Glow, Stars } from './fx';
import { Label3D } from './OfficeScene';
import { Person } from './Person';
import { supportsWebGL, usePrefersReducedMotion } from './webgl';

export interface TeamStageProps {
  agents: AgentRow[];
  states: Record<string, AgentState>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  agentName: (a: AgentRow) => string;
  /** Unsaved look of the selected agent, shown live while it is being edited. */
  draft?: Persona | null;
  speakingId?: string | null;
  noWebgl: string;
}

function Member({ agent, index, count, selected, state, persona, name, onSelect }: { agent: AgentRow; index: number; count: number; selected: boolean; state: AgentState; persona: Persona; name: string; onSelect: () => void }) {
  const g = useRef<THREE.Group>(null);
  const color = agentColor(agent.type, agent.slug);
  const spread = Math.min(Math.PI * 0.95, 0.5 + count * 0.26);
  const ang = count === 1 ? 0 : -spread / 2 + (index / (count - 1)) * spread;
  const R = 5.2 + Math.max(0, count - 6) * 0.25;
  const base = useMemo(() => new THREE.Vector3(Math.sin(ang) * R, 0, -Math.cos(ang) * R + R * 0.78), [ang, R]);
  useFrame((_, dt) => {
    if (!g.current) return;
    const target = selected ? new THREE.Vector3(base.x * 0.35, 0, base.z + 1.9) : base;
    g.current.position.lerp(target, Math.min(1, dt * 4));
    const s = THREE.MathUtils.lerp(g.current.scale.x, selected ? 1.22 : 1, Math.min(1, dt * 5));
    g.current.scale.setScalar(s);
    g.current.rotation.y = THREE.MathUtils.lerp(g.current.rotation.y, selected ? 0 : -ang * 0.55, Math.min(1, dt * 4));
  });
  return (
    <group ref={g} position={base.toArray()}>
      <mesh
        position={[0, 1, 0]}
        visible={false}
        onClick={(e) => (e.stopPropagation(), onSelect())}
        onPointerOver={() => (document.body.style.cursor = 'pointer')}
        onPointerOut={() => (document.body.style.cursor = '')}
      >
        <boxGeometry args={[0.9, 2.2, 0.9]} />
      </mesh>
      <Person persona={persona} color={color} state={state} />
      <Label3D text={name} dot={color} border={selected ? color : 'rgba(255,255,255,0.22)'} glow={selected} position={[0, 2.3, 0]} height={selected ? 0.34 : 0.26} />
    </group>
  );
}

function Scene(props: TeamStageProps) {
  const reduced = usePrefersReducedMotion();
  const sel = props.agents.find((a) => a.id === props.selectedId) ?? null;
  const col = sel ? agentColor(sel.type, sel.slug) : '#22d3ee';
  return (
    <>
      <color attach="background" args={['#02070f']} />
      <fog attach="fog" args={['#02070f', 16, 38]} />
      <ambientLight intensity={0.55} />
      <spotLight position={[0, 9, 4]} angle={0.7} penumbra={0.8} intensity={140} color="#e8f4ff" castShadow={false} />
      <pointLight position={[-6, 3, 2]} intensity={14} color="#60a5fa" distance={14} />
      <pointLight position={[6, 3, 2]} intensity={14} color={col} distance={14} />
      <Stars count={900} radius={26} spread={20} speed={reduced ? 0 : 0.008} size={0.1} />
      {/* stage */}
      <mesh position={[0, -0.02, 2]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[8.4, 80]} />
        <meshStandardMaterial color="#050a14" metalness={0.85} roughness={0.28} />
      </mesh>
      <mesh position={[0, 0, 2]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[8.3, 8.42, 120]} />
        <meshBasicMaterial color={col} toneMapped={false} />
      </mesh>
      {props.agents.map((a, i) => (
        <Member
          key={a.id}
          agent={a}
          index={i}
          count={props.agents.length}
          selected={a.id === props.selectedId}
          state={props.states[a.id] ?? 'idle'}
          persona={a.id === props.selectedId && props.draft ? props.draft : resolvePersona(a)}
          name={props.agentName(a)}
          onSelect={() => props.onSelect(a.id === props.selectedId ? null : a.id)}
        />
      ))}
      <Glow strength={0.7} threshold={0.35} vignette />
      <OrbitControls makeDefault enablePan={false} target={[0, 1.3, 2.4]} minDistance={5} maxDistance={15} minPolarAngle={0.9} maxPolarAngle={1.55} minAzimuthAngle={-0.9} maxAzimuthAngle={0.9} enableDamping autoRotate={!reduced && !props.selectedId} autoRotateSpeed={0.25} />
    </>
  );
}

/** A film-set stage: the whole AI team stands in an arc. Click a person to step forward and edit them. */
export function TeamStage(props: TeamStageProps) {
  const reduced = usePrefersReducedMotion();
  if (!supportsWebGL()) return <div className="fb-muted grid h-full w-full place-items-center p-6 text-center text-sm">{props.noWebgl}</div>;
  return (
    <Canvas dpr={[1, 1.6]} camera={{ position: [0, 2.6, 11], fov: 40 }} gl={{ antialias: true, powerPreference: 'high-performance' }} frameloop={reduced ? 'demand' : 'always'} onPointerMissed={() => props.onSelect(null)}>
      <Scene {...props} />
    </Canvas>
  );
}

export default TeamStage;
