import ChatLayout from '@/components/ChatLayout';

export default function Home() {
  return (
    <main className="flex h-screen w-full items-center justify-center p-4 sm:p-8 relative overflow-hidden bg-zinc-950">
      {/* Background gradients */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden z-0 pointer-events-none">
        <div className="absolute -top-[40%] -left-[10%] w-[70%] h-[70%] rounded-full bg-indigo-900/20 blur-[120px]" />
        <div className="absolute top-[60%] -right-[10%] w-[60%] h-[60%] rounded-full bg-blue-900/20 blur-[120px]" />
      </div>
      
      <div className="z-10 w-full h-full max-w-6xl max-h-[900px]">
        <ChatLayout />
      </div>
    </main>
  );
}
