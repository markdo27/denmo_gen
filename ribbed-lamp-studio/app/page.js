import Scene from '../components/viewport/Scene';
import LeftPanel from '../components/panels/LeftPanel';
import RightPanel from '../components/panels/RightPanel';

export default function Home() {
  return (
    <main className="w-screen h-screen flex overflow-hidden bg-neutral-950 text-neutral-200">
      <LeftPanel />
      <div className="flex-1 relative">
        <div className="absolute top-0 left-0 w-full p-4 pointer-events-none z-10 flex justify-center">
          <h1 className="text-xl font-mono font-bold tracking-widest text-white drop-shadow-md">RIBBED LAMP STUDIO</h1>
        </div>
        <Scene />
      </div>
      <RightPanel />
    </main>
  );
}
