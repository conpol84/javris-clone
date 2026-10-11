import { useEffect, useState } from 'react';

let cached: boolean | null = null;

/** True when a WebGL context can be created. Cached; safe on the server. */
export function supportsWebGL(): boolean {
  if (cached !== null) return cached;
  try {
    const canvas = document.createElement('canvas');
    cached = !!(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch {
    cached = false;
  }
  return cached;
}

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!mq) return;
    const on = () => setReduced(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return reduced;
}

/** Adaptive decorative 3D only. Never affects the microphone, CEO inference,
 * saved tasks or device permissions. Mobile/coarse-pointer/limited-core clients
 * use lightweight geometry and canvases stop rendering in background tabs.
 */
function compactSceneRequested():boolean {
  if(typeof window==='undefined')return true;
  const small=!!window.matchMedia?.('(max-width: 767px)').matches;
  const coarse=!!window.matchMedia?.('(pointer: coarse)').matches;
  const cores=typeof navigator!=='undefined'?navigator.hardwareConcurrency:undefined;
  const saveData=typeof navigator!=='undefined'
    && (navigator as Navigator & {connection?:{saveData?:boolean}}).connection?.saveData===true;
  return small||coarse||!!saveData||(typeof cores==='number'&&cores>0&&cores<=4);
}
export function useScenePerformance():{compact:boolean;visible:boolean} {
  const [compact,setCompact]=useState(compactSceneRequested);
  const [visible,setVisible]=useState(()=>typeof document==='undefined'||document.visibilityState!=='hidden');
  useEffect(()=>{
    const onChange=()=>setCompact(compactSceneRequested());
    const m1=window.matchMedia?.('(max-width: 767px)');
    const m2=window.matchMedia?.('(pointer: coarse)');
    m1?.addEventListener?.('change',onChange);
    m2?.addEventListener?.('change',onChange);
    window.addEventListener('resize',onChange);
    const onVisibility=()=>setVisible(document.visibilityState!=='hidden');
    document.addEventListener('visibilitychange',onVisibility);
    onChange();onVisibility();
    return()=>{
      m1?.removeEventListener?.('change',onChange);
      m2?.removeEventListener?.('change',onChange);
      window.removeEventListener('resize',onChange);
      document.removeEventListener('visibilitychange',onVisibility);
    };
  },[]);
  return{compact,visible};
}
