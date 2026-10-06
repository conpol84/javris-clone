import { createRoot } from 'react-dom/client';
import { CoreOrb } from './components/scenes/CoreOrb';
import './index.css';
import './styles/firbo.css';
const sats=['#22d3ee','#a78bfa','#34d399','#f59e0b','#f472b6','#60a5fa'].map((c,i)=>({id:String(i),color:c,active:i%2===0}));
createRoot(document.getElementById('r')!).render(<CoreOrb satellites={sats} className="" />);
