import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { Persona } from '../../lib/company/persona';
import { OUTFITS } from '../../lib/company/persona';
import { voiceLevel } from '../../lib/company/voice';
import type { AgentState } from '../../lib/company/status';

// Body: Khronos/three.js "Xbot" humanoid (CC0 / MIT sample model), idle pose baked to 8 500 surface points. See public/CREDITS.txt.
const BODY_URL = '/models/firbo-body.bin';

interface Body {
  position: Float32Array;
  normal: Float32Array;
  seed: Float32Array;
}
let bodyPromise: Promise<Body> | null = null;
function loadBody(): Promise<Body> {
  bodyPromise ??= fetch(BODY_URL)
    .then((r) => r.arrayBuffer())
    .then((buf) => {
      const n = new Uint32Array(buf, 0, 1)[0];
      const q = new Int16Array(buf, 4, n * 3);
      const nn = new Int8Array(buf, 4 + n * 6, n * 3);
      const position = new Float32Array(n * 3);
      const normal = new Float32Array(n * 3);
      const seed = new Float32Array(n);
      for (let i = 0; i < n * 3; i++) {
        position[i] = q[i] / 4000;
        normal[i] = nn[i] / 127;
      }
      for (let i = 0; i < n; i++) seed[i] = Math.abs(Math.sin(i * 12.9898) * 43758.5453) % 1;
      return { position, normal, seed };
    });
  return bodyPromise;
}

const vertex = /* glsl */ `
  uniform float uTime;
  uniform float uScan;
  uniform float uPx;
  uniform float uPower;
  attribute float aSeed;
  attribute vec3 aNormal;
  varying float vGlow;
  varying float vRim;
  void main() {
    vec3 p = position;
    p.x += sin(uTime * 1.3 + p.y * 2.0) * 0.004 * uPower;
    p += aNormal * sin(uTime * 2.2 + aSeed * 50.0) * 0.004;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vec3 n = normalize(normalMatrix * aNormal);
    vRim = pow(1.0 - abs(dot(n, normalize(-mv.xyz))), 1.5);
    float d = (p.y - uScan) * 7.0;
    vGlow = exp(-d * d);
    gl_PointSize = max(1.4, uPx * (0.6 + aSeed * 0.8 + vGlow * 0.35) * (9.0 / -mv.z));
    gl_Position = projectionMatrix * mv;
  }
`;
const fragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uPower;
  varying float vGlow;
  varying float vRim;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float r = length(c);
    if (r > 0.5) discard;
    float soft = smoothstep(0.5, 0.05, r);
    float a = soft * (0.22 + vRim * 0.6 + vGlow * 0.22) * uPower;
    gl_FragColor = vec4(mix(uColor, vec3(1.0), vGlow * 0.3 + vRim * 0.1), a);
  }
`;

/** An AI employee as a living hologram of 8 500 light points: tinted with the employee's colour, scanned by a moving beam, brighter while working. */
export function Person({ persona, color, state, speaking = false }: { persona: Persona; color: string; state: AgentState; speaking?: boolean }) {
  const [body, setBody] = useState<Body | null>(null);
  useEffect(() => {
    let live = true;
    void loadBody().then((b) => live && setBody(b));
    return () => {
      live = false;
    };
  }, []);
  const mat = useRef<THREE.ShaderMaterial>(null);
  const ring = useRef<THREE.Mesh>(null);
  const root = useRef<THREE.Group>(null);
  const disabled = state === 'disabled';
  const tint = useMemo(() => new THREE.Color(disabled ? '#475569' : color).lerp(new THREE.Color(OUTFITS[persona.outfit] ?? '#00d4ff'), 0.25), [color, persona.outfit, disabled]);
  const seed = useMemo(() => Math.random() * 10, []);
  const uniforms = useMemo(() => ({ uTime: { value: 0 }, uScan: { value: 0 }, uPx: { value: 2.3 }, uPower: { value: 1 }, uColor: { value: new THREE.Color() } }), []);
  const geo = useMemo(() => {
    if (!body) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(body.position, 3));
    g.setAttribute('aNormal', new THREE.BufferAttribute(body.normal, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(body.seed, 1));
    return g;
  }, [body]);

  useFrame(({ clock, gl }) => {
    const t = clock.elapsedTime + seed;
    const u = mat.current?.uniforms;
    if (u) {
      const speed = state === 'active' ? 0.7 : 0.3;
      u.uTime.value = t;
      u.uScan.value = -0.1 + ((t * speed) % 1) * 2.0;
      u.uPower.value = disabled ? 0.35 : state === 'active' ? 1.25 : speaking ? 1.1 + voiceLevel.value * 0.6 : 0.95;
      u.uPx.value = 2.3 * gl.getPixelRatio();
      (u.uColor.value as THREE.Color).copy(tint);
    }
    if (root.current) {
      root.current.position.y = disabled ? 0 : Math.sin(t * 1.6) * 0.012;
      root.current.rotation.y = Math.sin(t * 0.4) * (state === 'idle' ? 0.12 : 0.04);
    }
    if (ring.current) {
      ring.current.rotation.z = t * 0.5;
      (ring.current.material as THREE.MeshBasicMaterial).opacity = disabled ? 0.12 : state === 'active' ? 0.9 : state === 'waiting' ? 0.55 + Math.sin(t * 5) * 0.3 : 0.45;
    }
  });

  return (
    <group>
      <mesh ref={ring} position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.5, 0.55, 64]} />
        <meshBasicMaterial color={state === 'waiting' ? '#fbbf24' : color} transparent opacity={0.5} toneMapped={false} />
      </mesh>
      <mesh position={[0, 0.005, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.5, 48]} />
        <meshBasicMaterial color={color} transparent opacity={disabled ? 0.03 : 0.1} toneMapped={false} depthWrite={false} />
      </mesh>
      {geo && (
        <group ref={root} scale={1.08}>
          <points geometry={geo} frustumCulled={false}>
            <shaderMaterial ref={mat} uniforms={uniforms} vertexShader={vertex} fragmentShader={fragment} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
          </points>
        </group>
      )}
    </group>
  );
}
