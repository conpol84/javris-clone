import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { MeshSurfaceSampler } from 'three/examples/jsm/math/MeshSurfaceSampler.js';
import { voiceLevel } from '../../lib/company/voice';
import type { HoloState } from './HologramScene';

// Head scan: "Lee Perry-Smith" by Infinite Realities (CC BY 3.0), via the three.js examples. See public/CREDITS.txt.
export const HEAD_URL = '/models/firbo-head.glb';

const COLORS: Record<HoloState, string> = { idle: '#22d3ee', listening: '#34d399', thinking: '#a78bfa', speaking: '#7dd3fc' };

const vertex = /* glsl */ `
  uniform float uTime;
  uniform float uLevel;
  uniform float uScan;
  uniform float uPx;
  attribute float aSeed;
  attribute vec3 aNormal;
  varying float vGlow;
  varying float vRim;
  varying float vSeed;
  void main() {
    vec3 p = position;
    // the jaw drops with the voice
    float jaw = (1.0 - smoothstep(-0.8, -0.32, p.y)) * smoothstep(-0.1, 0.25, p.z);
    p.y -= jaw * uLevel * 0.09;
    p.z += jaw * uLevel * 0.02;
    // slow shimmer so the hologram never sits perfectly still
    p += aNormal * (sin(uTime * 2.0 + aSeed * 40.0) * 0.004 + uLevel * 0.01 * sin(aSeed * 90.0 + uTime * 14.0));
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vec3 n = normalize(normalMatrix * aNormal);
    vRim = pow(1.0 - abs(dot(n, normalize(-mv.xyz))), 1.6);
    float d = (p.y - uScan) * 9.0;
    vGlow = exp(-d * d);
    vSeed = aSeed;
    gl_PointSize = uPx * (0.55 + aSeed * 0.9 + vGlow * 0.8 + uLevel * 0.6) * (3.2 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;
const fragment = /* glsl */ `
  uniform vec3 uColor;
  varying float vGlow;
  varying float vRim;
  varying float vSeed;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float r = length(c);
    if (r > 0.5) discard;
    float soft = 1.0 - smoothstep(0.05, 0.5, r);
    float a = soft * (0.16 + vRim * 0.55 + vGlow * 0.38);
    vec3 col = mix(uColor, vec3(1.0), vGlow * 0.7 + vRim * 0.2);
    gl_FragColor = vec4(col, a);
  }
`;

/** A real human head scan turned into a living hologram of 16 000 light points: rim-lit, scanned by a moving beam, and its jaw moves with the voice. */
export function HoloHead({ state, motion, pointCount = 16000 }: { state: HoloState; motion: number; pointCount?: number }) {
  const gltf = useGLTF(HEAD_URL);
  const mat = useRef<THREE.ShaderMaterial>(null);
  const group = useRef<THREE.Group>(null);
  const smooth = useRef(0);
  const col = useMemo(() => new THREE.Color(COLORS.idle), []);
  const target = useMemo(() => new THREE.Color(), []);

  const geo = useMemo(() => {
    let mesh: THREE.Mesh | null = null;
    gltf.scene.traverse((o) => {
      if (!mesh && (o as THREE.Mesh).isMesh) mesh = o as THREE.Mesh;
    });
    const src = (mesh as unknown as THREE.Mesh).geometry.clone();
    src.computeBoundingBox();
    const box = src.boundingBox!;
    const size = box.getSize(new THREE.Vector3());
    const centre = box.getCenter(new THREE.Vector3());
    const scale = 2.6 / size.y;
    src.translate(-centre.x, -centre.y, -centre.z);
    src.scale(scale, scale, scale);
    const sampler = new MeshSurfaceSampler(new THREE.Mesh(src)).build();
    const pos = new Float32Array(pointCount * 3);
    const nor = new Float32Array(pointCount * 3);
    const seed = new Float32Array(pointCount);
    const p = new THREE.Vector3();
    const n = new THREE.Vector3();
    for (let i = 0; i < pointCount; i++) {
      sampler.sample(p, n);
      pos.set([p.x, p.y, p.z], i * 3);
      nor.set([n.x, n.y, n.z], i * 3);
      seed[i] = (Math.sin(i * 12.9898) * 43758.5453) % 1;
      seed[i] = Math.abs(seed[i]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aNormal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    src.dispose();
    return g;
  }, [gltf, pointCount]);
  useEffect(() => () => geo.dispose(), [geo]);

  const uniforms = useMemo(() => ({ uTime: { value: 0 }, uLevel: { value: 0 }, uScan: { value: 0 }, uPx: { value: 6 }, uColor: { value: new THREE.Color(COLORS.idle) } }), []);

  useFrame((s, dt) => {
    const t = s.clock.elapsedTime * motion;
    const lvl = state === 'speaking' ? voiceLevel.value : state === 'listening' ? 0.12 + voiceLevel.value * 0.3 : state === 'thinking' ? 0.18 + Math.sin(t * 9) * 0.08 : 0.03;
    smooth.current += (lvl - smooth.current) * Math.min(1, dt * 12);
    col.lerp(target.set(COLORS[state]), Math.min(1, dt * 4));
    const u = mat.current?.uniforms;
    if (u) {
      u.uTime.value = t;
      u.uLevel.value = Math.min(1, smooth.current);
      u.uScan.value = -1.4 + ((t * 0.28) % 1) * 2.9;
      (u.uColor.value as THREE.Color).copy(col);
    }
    if (group.current) {
      group.current.rotation.y = Math.sin(t * 0.28) * (state === 'thinking' ? 0.18 : 0.08);
      group.current.rotation.x = Math.sin(t * 0.35) * 0.012 + (state === 'listening' ? 0.025 : 0);
    }
  });

  return (
    <group ref={group}>
      <points geometry={geo} frustumCulled={false}>
        <shaderMaterial ref={mat} uniforms={uniforms} vertexShader={vertex} fragmentShader={fragment} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
      </points>
    </group>
  );
}

useGLTF.preload(HEAD_URL);
