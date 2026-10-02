import { Glow } from './fx';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Edges, Grid, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { AgentRow } from '../../lib/company/types';
import { agentColor, type AgentState } from '../../lib/company/status';
import { supportsWebGL, usePrefersReducedMotion } from './webgl';

export interface OfficeProps {
  agents: AgentRow[];
  states: Record<string, AgentState>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  openTasks: number;
  pendingApprovals: number;
  /** Pre-translated text: the WebGL canvas is a separate React root and cannot read i18n context. */
  labels: {
    agentName: (agent: AgentRow) => string;
    state: Record<AgentState, string>;
    tableOpen: string;
    tableApprovals: string;
    noWebgl: string;
  };
}

/** Fixed floor plan: department -> slot. Unknown/custom agents fill the spare slots. */
const SLOT_BY_TYPE: Record<string, [number, number]> = {
  ceo: [0, -4.6],
  research: [-5.6, -4.6],
  sales: [5.6, -4.6],
  marketing: [-5.6, 0.2],
  operations: [5.6, 0.2],
  finance: [-5.6, 5],
  developer: [5.6, 5],
};
/** Spare rooms: first the lounge slot, then an unbounded grid of rows behind the main floor. */
export function spareSlot(i: number): [number, number] {
  if (i === 0) return [0, 5];
  const j = i - 1;
  return [[-5.6, 0, 5.6][j % 3], 9.8 + 4.8 * Math.floor(j / 3)];
}

export function layoutAgents(agents: AgentRow[]): { agent: AgentRow; pos: [number, number] }[] {
  const taken = new Set<string>();
  let spareIndex = 0;
  const placed: { agent: AgentRow; pos: [number, number] }[] = [];
  const leftovers: AgentRow[] = [];
  for (const agent of agents) {
    const slot = SLOT_BY_TYPE[agent.type];
    if (slot && !taken.has(agent.type)) {
      taken.add(agent.type);
      placed.push({ agent, pos: slot });
    } else {
      leftovers.push(agent);
    }
  }
  for (const agent of leftovers) placed.push({ agent, pos: spareSlot(spareIndex++) });
  return placed;
}


/** Canvas-texture label (no DOM roots, so it is cheap and React-19 safe). */
export function Label3D({
  text,
  sub,
  dot,
  border,
  glow,
  position,
  height = 0.62,
}: {
  text: string;
  sub?: string;
  dot: string;
  border: string;
  glow?: boolean;
  position: [number, number, number];
  height?: number;
}) {
  const label = useMemo(() => {
    const H = 72;
    const font = (w: number) =>
      `${w} 28px system-ui, -apple-system, 'Segoe UI', 'Noto Sans', 'Noto Sans Arabic', 'Noto Sans CJK SC', 'PingFang SC', 'Microsoft YaHei', sans-serif`;
    const rtl = /[\u0590-\u08FF]/.test(text + (sub ?? ''));
    const probe = document.createElement('canvas').getContext('2d')!;
    probe.font = font(600);
    const w1 = probe.measureText(text).width;
    probe.font = font(500);
    const w2 = sub ? probe.measureText(sub).width : 0;
    const padX = 30;
    const W = Math.ceil(padX * 2 + 26 + w1 + (sub ? 16 + w2 : 0));
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d')!;
    g.beginPath();
    g.roundRect(3, 3, W - 6, H - 6, (H - 6) / 2);
    g.fillStyle = 'rgba(6,14,26,0.88)';
    g.fill();
    g.lineWidth = glow ? 4 : 2.5;
    g.strokeStyle = border;
    g.stroke();
    g.beginPath();
    g.arc(padX, H / 2, 8, 0, Math.PI * 2);
    g.fillStyle = dot;
    g.fill();
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    g.direction = rtl ? 'rtl' : 'ltr';
    g.font = font(600);
    g.fillStyle = '#ecfdf3';
    g.fillText(text, padX + 26, H / 2 + 1);
    if (sub) {
      g.font = font(500);
      g.fillStyle = 'rgba(230,241,255,0.6)';
      g.fillText(sub, padX + 26 + w1 + 16, H / 2 + 1);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return { tex, aspect: W / H };
  }, [text, sub, dot, border, glow]);
  useEffect(() => () => label.tex.dispose(), [label]);
  return (
    <sprite position={position} scale={[label.aspect * height, height, 1]} renderOrder={10}>
      <spriteMaterial map={label.tex} transparent depthTest={false} toneMapped={false} />
    </sprite>
  );
}

export function Robot({ color, state }: { color: string; state: AgentState }) {
  const body = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const armL = useRef<THREE.Mesh>(null);
  const armR = useRef<THREE.Mesh>(null);
  const halo = useRef<THREE.Mesh>(null);
  const beacon = useRef<THREE.MeshBasicMaterial>(null);
  const disabled = state === 'disabled';
  const tint = disabled ? '#475569' : color;

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const b = body.current;
    const h = head.current;
    if (!b || !h || !armL.current || !armR.current) return;
    if (state === 'active') {
      b.position.y = Math.sin(t * 7) * 0.018;
      armL.current.rotation.x = -1 + Math.sin(t * 15) * 0.28;
      armR.current.rotation.x = -1 + Math.cos(t * 15) * 0.28;
      h.rotation.z = Math.sin(t * 2) * 0.05;
    } else if (state === 'waiting') {
      b.position.y = Math.sin(t * 1.4) * 0.01;
      armL.current.rotation.x = -0.3;
      armR.current.rotation.x = -1.7 + Math.sin(t * 3) * 0.3; // raised hand
      h.rotation.z = Math.sin(t * 3) * 0.1;
    } else if (state === 'idle') {
      b.position.y = Math.sin(t * 1.5) * 0.01;
      armL.current.rotation.x = -0.25;
      armR.current.rotation.x = -0.25;
      h.rotation.z = 0;
    } else {
      b.position.y = -0.03;
      armL.current.rotation.x = 0.1;
      armR.current.rotation.x = 0.1;
      h.rotation.x = 0.45;
    }
    if (halo.current) {
      halo.current.visible = state === 'active';
      halo.current.rotation.z = t * 2.2;
    }
    if (beacon.current) {
      beacon.current.opacity = state === 'waiting' ? 0.4 + (Math.sin(t * 6) + 1) * 0.3 : 0;
    }
  });

  return (
    <group ref={body}>
      <mesh position={[0, 0.55, 0]}>
        <capsuleGeometry args={[0.2, 0.34, 6, 14]} />
        <meshStandardMaterial color={tint} roughness={0.35} metalness={0.4} emissive={tint} emissiveIntensity={state === 'active' ? 0.35 : 0.08} />
      </mesh>
      <group ref={head} position={[0, 1.08, 0]}>
        <mesh>
          <boxGeometry args={[0.38, 0.3, 0.34]} />
          <meshStandardMaterial color="#e2e8f0" roughness={0.3} metalness={0.2} />
        </mesh>
        <mesh position={[0, 0.01, 0.175]}>
          <boxGeometry args={[0.3, 0.14, 0.02]} />
          <meshBasicMaterial color={disabled ? '#1e293b' : '#04141f'} />
        </mesh>
        {[-0.07, 0.07].map((x) => (
          <mesh key={x} position={[x, 0.01, 0.19]}>
            <sphereGeometry args={[0.028, 10, 10]} />
            <meshBasicMaterial color={disabled ? '#334155' : color} toneMapped={false} />
          </mesh>
        ))}
        <mesh position={[0, 0.26, 0]}>
          <cylinderGeometry args={[0.012, 0.012, 0.2, 6]} />
          <meshStandardMaterial color="#94a3b8" />
        </mesh>
        <mesh position={[0, 0.37, 0]}>
          <sphereGeometry args={[0.045, 12, 12]} />
          <meshBasicMaterial ref={beacon} color="#fbbf24" transparent opacity={0} toneMapped={false} />
        </mesh>
      </group>
      <mesh ref={armL} position={[-0.27, 0.72, 0.02]}>
        <boxGeometry args={[0.08, 0.34, 0.08]} />
        <meshStandardMaterial color={tint} roughness={0.4} metalness={0.4} />
      </mesh>
      <mesh ref={armR} position={[0.27, 0.72, 0.02]}>
        <boxGeometry args={[0.08, 0.34, 0.08]} />
        <meshStandardMaterial color={tint} roughness={0.4} metalness={0.4} />
      </mesh>
      <mesh ref={halo} position={[0, 1.62, 0]} rotation={[Math.PI / 2, 0, 0]} visible={false}>
        <torusGeometry args={[0.22, 0.012, 8, 40]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
    </group>
  );
}

function Desk({ color, state }: { color: string; state: AgentState }) {
  const screen = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(({ clock }) => {
    if (!screen.current) return;
    const t = clock.elapsedTime;
    screen.current.opacity = state === 'active' ? 0.75 + Math.sin(t * 9) * 0.15 : state === 'disabled' ? 0.08 : 0.4;
  });
  return (
    <group position={[0, 0, -0.55]}>
      <mesh position={[0, 0.72, 0]}>
        <boxGeometry args={[2, 0.07, 0.85]} />
        <meshStandardMaterial color="#0f1f33" roughness={0.5} metalness={0.5} />
        <Edges color={color} threshold={15} />
      </mesh>
      {[-0.9, 0.9].map((x) => (
        <mesh key={x} position={[x, 0.36, 0]}>
          <boxGeometry args={[0.06, 0.72, 0.7]} />
          <meshStandardMaterial color="#0b1626" />
        </mesh>
      ))}
      <mesh position={[0, 1.12, -0.12]}>
        <boxGeometry args={[1.05, 0.64, 0.05]} />
        <meshStandardMaterial color="#05101c" />
      </mesh>
      <mesh position={[0, 1.12, -0.09]}>
        <planeGeometry args={[0.95, 0.54]} />
        <meshBasicMaterial ref={screen} color={color} transparent opacity={0.4} toneMapped={false} />
      </mesh>
    </group>
  );
}

function Zone({
  agent,
  pos,
  state,
  selected,
  onSelect,
  labels,
}: {
  labels: OfficeProps['labels'];
  agent: AgentRow;
  pos: [number, number];
  state: AgentState;
  selected: boolean;
  onSelect: (id: string | null) => void;
}) {
  const color = agentColor(agent.type, agent.slug);
  const [hover, setHover] = useState(false);
  const ring = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (ring.current) ring.current.scale.setScalar(1 + Math.sin(clock.elapsedTime * 3) * 0.03);
  });

  return (
    <group position={[pos[0], 0, pos[1]]}>
      <mesh position={[0, 0.05, 0]} receiveShadow>
        <boxGeometry args={[4.6, 0.1, 3.6]} />
        <meshStandardMaterial color="#0d2038" roughness={0.7} metalness={0.25} emissive="#0a2a44" emissiveIntensity={0.35} />
        <Edges color={color} threshold={15} />
      </mesh>
      {/* glass walls */}
      <mesh position={[0, 0.65, -1.78]}>
        <boxGeometry args={[4.6, 1.1, 0.05]} />
        <meshStandardMaterial color={color} transparent opacity={0.1} roughness={0.1} metalness={0.6} />
        <Edges color={color} threshold={15} />
      </mesh>
      <mesh position={[-2.28, 0.65, 0]}>
        <boxGeometry args={[0.05, 1.1, 3.6]} />
        <meshStandardMaterial color={color} transparent opacity={0.1} roughness={0.1} metalness={0.6} />
        <Edges color={color} threshold={15} />
      </mesh>
      <Desk color={color} state={state} />
      {/* chair */}
      <mesh position={[0, 0.34, 0.12]}>
        <cylinderGeometry args={[0.26, 0.26, 0.07, 16]} />
        <meshStandardMaterial color="#13243b" />
      </mesh>
      <mesh position={[0, 0.17, 0.12]}>
        <cylinderGeometry args={[0.03, 0.03, 0.34, 8]} />
        <meshStandardMaterial color="#334155" />
      </mesh>
      <group position={[0, 0.34, 0.12]} rotation={[0, 2.6, 0]} scale={0.95}>
        <Robot color={color} state={state} />
      </group>

      {state === 'active' && <pointLight position={[0, 1.6, 0.3]} color={color} intensity={6} distance={5} />}
      {selected && (
        <mesh ref={ring} position={[0, 0.12, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[1.95, 2.05, 64]} />
          <meshBasicMaterial color={color} toneMapped={false} />
        </mesh>
      )}
      {/* click target covers the whole zone */}
      <mesh
        position={[0, 0.9, 0]}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(selected ? null : agent.id);
        }}
        onPointerOver={() => {
          setHover(true);
          document.body.style.cursor = 'pointer';
        }}
        onPointerOut={() => {
          setHover(false);
          document.body.style.cursor = '';
        }}
      >
        <boxGeometry args={[4.4, 1.8, 3.4]} />
        <meshBasicMaterial transparent opacity={hover ? 0.05 : 0} color={color} depthWrite={false} />
      </mesh>
      <Label3D
        position={[0, 2.35, 0]}
        text={labels.agentName(agent)}
        sub={labels.state[state]}
        dot={state === 'waiting' ? '#fbbf24' : state === 'active' ? '#00d97a' : state === 'disabled' ? '#64748b' : color}
        border={selected ? color : 'rgba(0, 217, 122,0.3)'}
        glow={selected}
      />
    </group>
  );
}

function CommandTable({ open, approvals, labels }: { open: number; approvals: number; labels: OfficeProps['labels'] }) {
  const ring = useRef<THREE.Mesh>(null);
  const core = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (ring.current) ring.current.rotation.z = t * 0.6;
    if (core.current) {
      core.current.rotation.y = t * 0.8;
      core.current.position.y = 1.5 + Math.sin(t * 1.6) * 0.06;
    }
  });
  return (
    <group position={[0, 0, 0.2]}>
      <mesh position={[0, 0.5, 0]}>
        <cylinderGeometry args={[1.1, 1.3, 1, 32]} />
        <meshStandardMaterial color="#0b1a2e" roughness={0.4} metalness={0.6} />
        <Edges color="#00f58a" threshold={15} />
      </mesh>
      <mesh ref={ring} position={[0, 1.02, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.95, 0.018, 8, 64]} />
        <meshBasicMaterial color="#00f58a" toneMapped={false} />
      </mesh>
      <mesh ref={core} position={[0, 1.5, 0]}>
        <icosahedronGeometry args={[0.32, 1]} />
        <meshBasicMaterial color="#5dffb0" wireframe toneMapped={false} />
      </mesh>
      <pointLight position={[0, 1.6, 0]} color="#00f58a" intensity={5} distance={7} />
      <Label3D
        position={[0, 2.55, 0]}
        text={labels.tableOpen}
        sub={labels.tableApprovals}
        dot={approvals ? '#fbbf24' : '#00d97a'}
        border="rgba(0, 217, 122,0.4)"
      />
    </group>
  );
}

function Scene({ agents, states, selectedId, onSelect, openTasks, pendingApprovals, labels }: OfficeProps) {
  const [auto, setAuto] = useState(true);
  const reduced = usePrefersReducedMotion();
  const placed = useMemo(() => layoutAgents(agents), [agents]);
  return (
    <>
      <color attach="background" args={['#04100a']} />
      <fog attach="fog" args={['#04100a', 34, 70]} />
      <ambientLight intensity={0.7} />
      <hemisphereLight args={['#b9ffda', '#07140d', 0.5]} />
      <directionalLight position={[10, 16, 8]} intensity={1.1} />
      <Grid
        position={[0, 0, 2]}
        args={[60, 60]}
        cellSize={0.6}
        cellThickness={0.5}
        cellColor="#0c3550"
        sectionSize={3}
        sectionThickness={1}
        sectionColor="#00a257"
        fadeDistance={38}
        fadeStrength={1.5}
        infiniteGrid
      />
      <CommandTable open={openTasks} approvals={pendingApprovals} labels={labels} />
      {placed.map(({ agent, pos }) => (
        <Zone
          key={agent.id}
          agent={agent}
          pos={pos}
          state={states[agent.id] ?? 'idle'}
          selected={selectedId === agent.id}
          onSelect={onSelect}
          labels={labels}
        />
      ))}
      <OrbitControls
        makeDefault
        enablePan={false}
        target={[1.6, 0.6, 2.2]}
        minDistance={14}
        maxDistance={44}
        minPolarAngle={0.45}
        maxPolarAngle={1.3}
        enableDamping
        autoRotate={auto && !reduced}
        autoRotateSpeed={0.35}
        onStart={() => setAuto(false)}
      />
    </>
  );
}

/** Interactive 3D office: one room per agent, animated from live company data. */
export function OfficeScene(props: OfficeProps) {
  const reduced = usePrefersReducedMotion();
  if (!supportsWebGL()) {
    return (
      <div className="fb-muted grid h-full w-full place-items-center p-6 text-center text-sm">
        {props.labels.noWebgl}
      </div>
    );
  }
  return (
    <Canvas
      dpr={[1, 1.6]}
      camera={{ position: [22, 18, 24], fov: 34 }}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      frameloop={reduced ? 'demand' : 'always'}
      onPointerMissed={() => props.onSelect(null)}
    >
      <Scene {...props} />
      <Glow strength={0.6} threshold={0.45} vignette />
    </Canvas>
  );
}

export default OfficeScene;
