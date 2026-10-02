import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing';
import * as THREE from 'three';
import { usePrefersReducedMotion } from './webgl';

/** Cinematic glow for every 3D scene. Skipped on weak devices and for people who prefer reduced motion. */
export function Glow({ strength = 0.9, threshold = 0.25, vignette = false }: { strength?: number; threshold?: number; vignette?: boolean }) {
  const reduced = usePrefersReducedMotion();
  const weak = typeof navigator !== 'undefined' && (navigator.hardwareConcurrency ?? 4) < 4;
  if (reduced || weak) return null;
  return (
    <EffectComposer multisampling={0}>
      <Bloom intensity={strength} luminanceThreshold={threshold} luminanceSmoothing={0.35} mipmapBlur />
      {vignette ? <Vignette eskil={false} offset={0.2} darkness={0.55} /> : <></>}
    </EffectComposer>
  );
}

/** A slow field of stars behind the scene. */
export function Stars({ count = 1400, radius = 38, spread = 40, speed = 0.01, size = 0.14, color = '#d6ffe9' }: { count?: number; radius?: number; spread?: number; speed?: number; size?: number; color?: string }) {
  const ref = useRef<THREE.Points>(null);
  const pos = useMemo(() => {
    const a = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const r = radius + Math.random() * spread;
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1);
      a[i * 3] = r * Math.sin(ph) * Math.cos(th);
      a[i * 3 + 1] = r * Math.cos(ph);
      a[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
    }
    return a;
  }, [count, radius, spread]);
  useFrame((_, dt) => {
    if (ref.current) ref.current.rotation.y += dt * speed;
  });
  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[pos, 3]} />
      </bufferGeometry>
      <pointsMaterial size={size} color={color} transparent opacity={0.85} sizeAttenuation depthWrite={false} blending={THREE.AdditiveBlending} />
    </points>
  );
}
