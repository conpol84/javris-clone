import { Glow } from './fx';
import { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { Person } from './Person';
import { resolvePersona, type Persona } from '../../lib/company/persona';
import { supportsWebGL, usePrefersReducedMotion } from './webgl';

export interface MissionNode {
  id: string;
  name: string;
  color: string;
  persona?: Persona;
}

export interface MissionStep {
  id: string;
  agentId: string | null;
  status: 'pending' | 'running' | 'blocked' | 'awaiting_approval' | 'completed' | 'failed' | 'cancelled';
}

export interface MissionSceneProps {
  /** The CEO plus every employee that has a step, in ring order. */
  nodes: MissionNode[];
  steps: MissionStep[];
  missionStatus: string;
  /** Pre-translated: the WebGL canvas is a separate React root and cannot read i18n context. */
  labels: { core: string; noWebgl: string };
}

const TONE = { done: '#34d399', run: '#22d3ee', wait: '#fbbf24', fail: '#f87171', idle: '#475569' };

function labelTexture(text: string, color: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 96;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(8, 14, 28,0.82)';
  g.strokeStyle = color;
  g.lineWidth = 3;
  const r = 40;
  g.beginPath();
  g.roundRect(4, 8, 504, 80, r);
  g.fill();
  g.stroke();
  g.fillStyle = '#e6f1ff';
  g.font = '600 38px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  let t = text;
  while (g.measureText(t).width > 440 && t.length > 4) t = t.slice(0, -2);
  g.fillText(t === text ? t : `${t}…`, 256, 50);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function glow(color: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, `${color}ff`);
  grad.addColorStop(0.35, `${color}66`);
  grad.addColorStop(1, `${color}00`);
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

function stateOf(steps: MissionStep[], nodeId: string): keyof typeof TONE {
  const mine = steps.filter((s) => s.agentId === nodeId);
  if (mine.length === 0) return 'idle';
  if (mine.some((s) => s.status === 'running')) return 'run';
  if (mine.some((s) => s.status === 'awaiting_approval' || s.status === 'blocked')) return 'wait';
  if (mine.some((s) => s.status === 'failed')) return 'fail';
  if (mine.every((s) => s.status === 'completed')) return 'done';
  return 'idle';
}

function AgentNode({ node, pos, state, index }: { node: MissionNode; pos: THREE.Vector3; state: keyof typeof TONE; index: number }) {
  const body = useRef<THREE.Mesh>(null);
  const halo = useRef<THREE.Sprite>(null);
  const tone = TONE[state];
  const sprite = useMemo(() => glow(tone), [tone]);
  const label = useMemo(() => labelTexture(node.name, node.color), [node.name, node.color]);
  useFrame((s) => {
    const t = s.clock.elapsedTime;
    const active = state === 'run';
    if (body.current) {
      body.current.rotation.y = t * (active ? 1.6 : 0.4) + index;
      body.current.position.y = pos.y + Math.sin(t * 1.3 + index) * 0.07;
      body.current.scale.setScalar(active ? 1 + Math.sin(t * 6) * 0.12 : 1);
    }
    if (halo.current) halo.current.scale.setScalar((active ? 1.9 + Math.sin(t * 5) * 0.3 : 1.35) * 1.5);
  });
  return (
    <group position={[pos.x, 0, pos.z]}>
      <sprite ref={halo} position={[0, pos.y, 0]} scale={[2, 2, 1]}>
        <spriteMaterial map={sprite} transparent opacity={state === 'idle' ? 0.35 : 0.9} blending={THREE.AdditiveBlending} depthWrite={false} />
      </sprite>
      <group position={[0, -0.9, 0]} rotation={[0, Math.atan2(-pos.x, -pos.z), 0]} scale={0.9}>
        <Person persona={node.persona ?? resolvePersona({ slug: node.id, type: 'custom' })} color={node.color} state={state === 'run' ? 'active' : state === 'wait' ? 'waiting' : state === 'fail' ? 'disabled' : 'idle'} />
      </group>
      <mesh position={[0, -0.88, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.6, 0.66, 40]} />
        <meshBasicMaterial color={tone} transparent opacity={state === 'idle' ? 0.3 : 0.95} toneMapped={false} />
      </mesh>
      <sprite position={[0, pos.y + 0.95, 0]} scale={[3, 0.56, 1]}>
        <spriteMaterial map={label} transparent depthWrite={false} />
      </sprite>
    </group>
  );
}

/** A particle travelling along the beam between two nodes. */
function Beam({ from, to, active, color }: { from: THREE.Vector3; to: THREE.Vector3; active: boolean; color: string }) {
  const dot = useRef<THREE.Mesh>(null);
  const curve = useMemo(() => {
    const mid = from.clone().add(to).multiplyScalar(0.5);
    mid.y += 0.9;
    return new THREE.QuadraticBezierCurve3(from, mid, to);
  }, [from, to]);
  const geo = useMemo(() => new THREE.BufferGeometry().setFromPoints(curve.getPoints(40)), [curve]);
  useFrame((s) => {
    if (dot.current) {
      const u = (s.clock.elapsedTime * 0.55) % 1;
      dot.current.position.copy(curve.getPoint(u));
      dot.current.visible = active;
    }
  });
  return (
    <group>
      <line>
        <primitive object={geo} attach="geometry" />
        <lineBasicMaterial color={color} transparent opacity={active ? 0.75 : 0.18} />
      </line>
      <mesh ref={dot}>
        <boxGeometry args={[0.26, 0.34, 0.03]} />
        <meshBasicMaterial color="#ffffff" toneMapped={false} />
      </mesh>
    </group>
  );
}

function Core({ status, motion }: { status: string; motion: number }) {
  const ico = useRef<THREE.Mesh>(null);
  const ring = useRef<THREE.Mesh>(null);
  const color = status === 'completed' ? TONE.done : status === 'failed' ? TONE.fail : TONE.run;
  const halo = useMemo(() => glow(color), [color]);
  useFrame((s, dt) => {
    if (ico.current) ico.current.rotation.y += dt * 0.5 * motion;
    if (ico.current) ico.current.rotation.x += dt * 0.2 * motion;
    if (ring.current) ring.current.rotation.z += dt * 0.3 * motion;
    const k = status === 'running' ? 1 + Math.sin(s.clock.elapsedTime * 3) * 0.06 : 1;
    ico.current?.scale.setScalar(k);
  });
  return (
    <group position={[0, 0.2, 0]}>
      <sprite scale={[5.2, 5.2, 1]}>
        <spriteMaterial map={halo} transparent opacity={0.65} blending={THREE.AdditiveBlending} depthWrite={false} />
      </sprite>
      <mesh ref={ico}>
        <icosahedronGeometry args={[0.8, 1]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.7} wireframe />
      </mesh>
      <mesh>
        <icosahedronGeometry args={[0.45, 2]} />
        <meshBasicMaterial color="#e0fbff" toneMapped={false} />
      </mesh>
      <mesh ref={ring} rotation={[Math.PI / 2.4, 0, 0]}>
        <torusGeometry args={[1.25, 0.012, 8, 120]} />
        <meshBasicMaterial color={color} transparent opacity={0.7} />
      </mesh>
    </group>
  );
}

function World({ nodes, steps, missionStatus, labels, motion }: MissionSceneProps & { motion: number }) {
  const group = useRef<THREE.Group>(null);
  const radius = Math.max(3.8, nodes.length * 0.62);
  const camera = useThree((st) => st.camera);
  useEffect(() => {
    camera.position.set(0, 7.2, 8.6);
    camera.lookAt(0, 0, 0.4);
  }, [camera]);
  const positions = useMemo(
    () => nodes.map((_, i) => {
      const a = (i / Math.max(nodes.length, 1)) * Math.PI * 2 - Math.PI / 2;
      return new THREE.Vector3(Math.cos(a) * radius, 0.2, Math.sin(a) * radius * 0.78);
    }),
    [nodes, radius],
  );
  const index = new Map(nodes.map((n, i) => [n.id, i]));
  const core = new THREE.Vector3(0, 0.2, 0);
  useFrame((s) => {
    if (group.current) group.current.rotation.y = Math.sin(s.clock.elapsedTime * 0.12 * motion) * 0.25 + s.pointer.x * 0.25 * motion;
  });
  return (
    <group ref={group}>
      <ambientLight intensity={0.6} />
      <pointLight position={[0, 4, 3]} intensity={30} color="#22d3ee" />
      <pointLight position={[-5, 2, -3]} intensity={12} color="#a78bfa" />
      <gridHelper args={[26, 26, '#164e63', '#0b2540']} position={[0, -0.9, 0]} />
      <Core status={missionStatus} motion={motion} />
      {nodes.map((n, i) => (
        <AgentNode key={n.id} node={n} pos={positions[i]} state={stateOf(steps, n.id)} index={i} />
      ))}
      {/* hand-offs: core -> first employee, then employee -> next employee in step order */}
      {steps.map((s, i) => {
        const to = s.agentId != null ? index.get(s.agentId) : undefined;
        if (to === undefined) return null;
        const prev = i > 0 ? steps[i - 1] : null;
        const fromIdx = prev && prev.agentId != null ? index.get(prev.agentId) : undefined;
        const from = fromIdx !== undefined ? positions[fromIdx] : core;
        if (from === positions[to]) return null;
        const tone = s.status === 'completed' ? TONE.done : s.status === 'running' ? TONE.run : s.status === 'failed' ? TONE.fail : '#64748b';
        return <Beam key={s.id} from={from} to={positions[to]} active={s.status === 'running'} color={tone} />;
      })}
    </group>
  );
}

export function MissionScene(props: MissionSceneProps) {
  const reduced = usePrefersReducedMotion();
  if (!supportsWebGL()) {
    return <div className="fb-muted grid h-full place-items-center p-6 text-center text-sm">{props.labels.noWebgl}</div>;
  }
  return (
    <Canvas camera={{ position: [0, 7.2, 8.6], fov: 44 }} dpr={[1, 1.75]} gl={{ antialias: true }} style={{ background: 'transparent' }}>
      <World {...props} motion={reduced ? 0 : 1} />
      <Glow />
    </Canvas>
  );
}

export default MissionScene;
