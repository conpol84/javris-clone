import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { Persona } from '../../lib/company/persona';
import { HAIR_COLORS, OUTFITS, SKINS } from '../../lib/company/persona';
import type { AgentState } from '../../lib/company/status';

const HALF = [0, Math.PI * 2, 0, Math.PI / 2] as const;

function Hair({ style, color, cap }: { style: number; color: string; cap: string }) {
  if (style === 0) return null;
  const mat = <meshStandardMaterial color={color} roughness={0.7} />;
  if (style === 4) {
    return (
      <group>
        <mesh position={[0, 0.03, 0]}>
          <sphereGeometry args={[0.215, 24, 16, ...HALF]} />
          <meshStandardMaterial color={cap} roughness={0.5} />
        </mesh>
        <mesh position={[0, 0.04, 0.2]} rotation={[-0.15, 0, 0]}>
          <boxGeometry args={[0.3, 0.02, 0.2]} />
          <meshStandardMaterial color={cap} roughness={0.5} />
        </mesh>
      </group>
    );
  }
  return (
    <group>
      <mesh position={[0, 0.02, -0.01]}>
        <sphereGeometry args={[0.22, 24, 16, ...HALF]} />
        {mat}
      </mesh>
      {style === 2 && (
        <mesh position={[0, -0.13, -0.1]} scale={[1, 1.5, 0.7]}>
          <sphereGeometry args={[0.2, 20, 14]} />
          {mat}
        </mesh>
      )}
      {style === 3 && (
        <mesh position={[0, 0.25, -0.05]}>
          <sphereGeometry args={[0.09, 14, 12]} />
          {mat}
        </mesh>
      )}
    </group>
  );
}

function Accessory({ kind, outfit }: { kind: number; outfit: string }) {
  if (kind === 1) {
    return (
      <group position={[0, 0.0, 0.205]}>
        {[-0.075, 0.075].map((x) => (
          <mesh key={x} position={[x, 0, 0]}>
            <torusGeometry args={[0.052, 0.008, 8, 24]} />
            <meshStandardMaterial color="#111827" metalness={0.6} roughness={0.3} />
          </mesh>
        ))}
        <mesh>
          <boxGeometry args={[0.04, 0.008, 0.008]} />
          <meshStandardMaterial color="#111827" />
        </mesh>
      </group>
    );
  }
  if (kind === 2) {
    return (
      <group>
        <mesh position={[0, 0.03, 0]} rotation={[0, 0, 0]}>
          <torusGeometry args={[0.235, 0.014, 8, 36, Math.PI]} />
          <meshStandardMaterial color="#1f2937" metalness={0.5} roughness={0.4} />
        </mesh>
        <mesh position={[0.235, -0.01, 0]}>
          <sphereGeometry args={[0.05, 12, 12]} />
          <meshStandardMaterial color="#1f2937" />
        </mesh>
        <mesh position={[0.2, -0.1, 0.16]}>
          <sphereGeometry args={[0.017, 8, 8]} />
          <meshBasicMaterial color={outfit} toneMapped={false} />
        </mesh>
      </group>
    );
  }
  if (kind === 4) {
    return (
      <mesh position={[0, 0.0, 0.2]}>
        <boxGeometry args={[0.34, 0.08, 0.05]} />
        <meshBasicMaterial color={outfit} transparent opacity={0.75} toneMapped={false} />
      </mesh>
    );
  }
  return null;
}

/** A stylised full-body character: breathes, looks around, types when working, raises a hand when waiting. */
export function Person({ persona, color, state, speaking = false }: { persona: Persona; color: string; state: AgentState; speaking?: boolean }) {
  const root = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const armL = useRef<THREE.Group>(null);
  const armR = useRef<THREE.Group>(null);
  const mouth = useRef<THREE.Mesh>(null);
  const aura = useRef<THREE.Mesh>(null);
  const disabled = state === 'disabled';
  const skin = SKINS[persona.skin] ?? SKINS[0];
  const hairC = HAIR_COLORS[persona.hairColor] ?? HAIR_COLORS[0];
  const outfit = disabled ? '#475569' : OUTFITS[persona.outfit] ?? color;
  const pants = '#1e293b';

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (!root.current || !head.current || !armL.current || !armR.current) return;
    const breathe = Math.sin(t * 1.6) * 0.012;
    root.current.position.y = disabled ? -0.02 : breathe;
    head.current.rotation.set(disabled ? 0.4 : Math.sin(t * 0.5) * 0.04, state === 'idle' ? Math.sin(t * 0.35) * 0.35 : state === 'active' ? -0.2 + Math.sin(t * 2) * 0.05 : 0, 0);
    if (state === 'active') {
      armL.current.rotation.x = -1.1 + Math.sin(t * 14) * 0.22;
      armR.current.rotation.x = -1.1 + Math.cos(t * 14) * 0.22;
    } else if (state === 'waiting') {
      armL.current.rotation.x = -0.1;
      armR.current.rotation.set(-2.6 + Math.sin(t * 3.5) * 0.25, 0, -0.2);
    } else if (speaking) {
      armL.current.rotation.set(-0.5 + Math.sin(t * 2.1) * 0.15, 0, 0.1);
      armR.current.rotation.set(-0.9 + Math.sin(t * 2.7) * 0.35, 0, -0.15 + Math.sin(t * 1.9) * 0.1);
    } else {
      armL.current.rotation.x = Math.sin(t * 1.6) * 0.04;
      armR.current.rotation.set(Math.sin(t * 1.6 + 1) * 0.04, 0, 0);
    }
    if (mouth.current) mouth.current.scale.y = speaking ? 0.6 + Math.abs(Math.sin(t * 12)) * 1.6 : 0.6;
    if (aura.current) {
      aura.current.rotation.z = t * 0.5;
      (aura.current.material as THREE.MeshBasicMaterial).opacity = disabled ? 0.12 : state === 'active' ? 0.9 : state === 'waiting' ? 0.55 + Math.sin(t * 5) * 0.3 : 0.45;
    }
  });

  return (
    <group>
      <mesh ref={aura} position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.52, 0.58, 48]} />
        <meshBasicMaterial color={color} transparent opacity={0.5} toneMapped={false} />
      </mesh>
      <group ref={root}>
        {/* legs and shoes */}
        {[-0.1, 0.1].map((x) => (
          <group key={x}>
            <mesh position={[x, 0.42, 0]}>
              <capsuleGeometry args={[0.07, 0.62, 6, 12]} />
              <meshStandardMaterial color={pants} roughness={0.8} />
            </mesh>
            <mesh position={[x, 0.05, 0.05]}>
              <boxGeometry args={[0.13, 0.09, 0.26]} />
              <meshStandardMaterial color="#0b1220" roughness={0.5} />
            </mesh>
          </group>
        ))}
        {/* torso */}
        <mesh position={[0, 1.12, 0]}>
          <capsuleGeometry args={[0.22, 0.42, 8, 16]} />
          <meshStandardMaterial color={outfit} roughness={0.55} metalness={0.15} emissive={outfit} emissiveIntensity={state === 'active' ? 0.25 : 0.06} />
        </mesh>
        <mesh position={[0, 1.02, 0.215]}>
          <boxGeometry args={[0.1, 0.1, 0.01]} />
          <meshBasicMaterial color={color} toneMapped={false} />
        </mesh>
        {persona.accessory === 3 && (
          <mesh position={[0, 1.22, 0.225]}>
            <boxGeometry args={[0.05, 0.28, 0.02]} />
            <meshStandardMaterial color="#111827" />
          </mesh>
        )}
        {/* arms pivot at the shoulders */}
        {([['L', -0.3, armL], ['R', 0.3, armR]] as const).map(([k, x, ref]) => (
          <group key={k} ref={ref} position={[x, 1.38, 0]}>
            <mesh position={[0, -0.26, 0]}>
              <capsuleGeometry args={[0.065, 0.4, 6, 12]} />
              <meshStandardMaterial color={outfit} roughness={0.6} />
            </mesh>
            <mesh position={[0, -0.55, 0]}>
              <sphereGeometry args={[0.065, 12, 12]} />
              <meshStandardMaterial color={skin} roughness={0.7} />
            </mesh>
          </group>
        ))}
        {/* neck + head */}
        <mesh position={[0, 1.5, 0]}>
          <cylinderGeometry args={[0.07, 0.08, 0.1, 12]} />
          <meshStandardMaterial color={skin} roughness={0.7} />
        </mesh>
        <group ref={head} position={[0, 1.72, 0]}>
          <mesh>
            <sphereGeometry args={[0.2, 28, 22]} />
            <meshStandardMaterial color={skin} roughness={0.65} />
          </mesh>
          {[-0.075, 0.075].map((x) => (
            <group key={x} position={[x, 0.02, 0.17]}>
              <mesh>
                <sphereGeometry args={[0.032, 12, 12]} />
                <meshStandardMaterial color="#f8fafc" />
              </mesh>
              <mesh position={[0, 0, 0.022]}>
                <sphereGeometry args={[0.016, 10, 10]} />
                <meshBasicMaterial color={disabled ? '#334155' : '#0b1b2b'} />
              </mesh>
            </group>
          ))}
          <mesh position={[0, -0.075, 0.185]}>
            <sphereGeometry args={[0.026, 10, 10]} />
            <meshStandardMaterial color={skin} roughness={0.7} />
          </mesh>
          <mesh ref={mouth} position={[0, -0.1, 0.18]} scale={[1, 0.6, 1]}>
            <boxGeometry args={[0.07, 0.018, 0.012]} />
            <meshStandardMaterial color="#7f1d1d" />
          </mesh>
          <Hair style={persona.hair} color={hairC} cap={outfit} />
          <Accessory kind={persona.accessory} outfit={disabled ? '#475569' : color} />
        </group>
      </group>
    </group>
  );
}
