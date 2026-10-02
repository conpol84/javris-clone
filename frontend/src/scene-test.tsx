import { createRoot } from 'react-dom/client';
import { CeoStage } from './components/scenes/CeoStage';
const sats = ['Research','Sales','Support','Finance'].map((n,i)=>({id:String(i),color:['#22d3ee','#a78bfa','#34d399','#f59e0b'][i],active:i%2===0,name:n}));
createRoot(document.getElementById('r')!).render(<div style={{width:1100,height:640}}><CeoStage state="speaking" satellites={sats} labels={{noWebgl:'x'}} /></div>);
