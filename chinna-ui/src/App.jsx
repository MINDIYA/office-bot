import { useState, useEffect, useRef, useCallback, useMemo, Suspense } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Sphere, MeshDistortMaterial, Float, Sparkles as ThreeSparkles } from "@react-three/drei";
import { motion, AnimatePresence } from "framer-motion";
import { 
  Send, Mic, Plus, PanelLeftClose, PanelLeft, 
  Trash2, MessageSquare, Sparkles, User, X 
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm"; // <--- Enables Tables
import * as THREE from "three";

// ==========================================
// 🧠 THE NEURAL CLOUD (ChatGPT Style)
// ==========================================
function NeuralCloud({ status, analyserRef }) {
  const meshRef = useRef();
  const materialRef = useRef();
  
  // Minimalist, Elegant Color Palette
  const config = useMemo(() => ({
    idle: { color: "#ffffff", emissive: "#ffffff", speed: 0.5 },       // Soft White
    listening: { color: "#3B82F6", emissive: "#2563EB", speed: 1.5 },  // Deep Blue
    processing: { color: "#A855F7", emissive: "#9333EA", speed: 3 },   // Purple
    speaking: { color: "#ffffff", emissive: "#ffffff", speed: 2 },     // Bright White
  }), []);

  useFrame((state) => {
    if (!meshRef.current || !materialRef.current) return;

    // 1. Audio Reactivity
    let volume = 0;
    if (status === 'speaking' && analyserRef.current) {
      const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
      analyserRef.current.getByteFrequencyData(dataArray);
      const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
      volume = Math.min(avg / 100, 1.5); 
    }

    const target = config[status] || config.idle;
    
    // 2. Smooth Color Transitions
    materialRef.current.color.lerp(new THREE.Color(target.color), 0.05);
    materialRef.current.emissive.lerp(new THREE.Color(target.emissive), 0.05);

    // 3. Liquid Distortion Logic
    const targetDistort = status === 'speaking' ? 0.5 + (volume * 0.5) : 0.3;
    const targetSpeed = status === 'speaking' ? 2 + (volume * 5) : target.speed;

    materialRef.current.distort = THREE.MathUtils.lerp(materialRef.current.distort, targetDistort, 0.05);
    materialRef.current.speed = THREE.MathUtils.lerp(materialRef.current.speed, targetSpeed, 0.05);

    // 4. Rotation
    meshRef.current.rotation.y += 0.002;
    meshRef.current.rotation.z += 0.001;
  });

  return (
    <Float speed={2} rotationIntensity={0.5} floatIntensity={0.5}>
      <Sphere args={[1, 128, 128]} ref={meshRef} scale={1.8}>
        <MeshDistortMaterial
          ref={materialRef}
          toneMapped={false}
          color="#ffffff"
          emissive="#ffffff"
          emissiveIntensity={status === 'speaking' ? 0.8 : 0.2}
          roughness={0.1}
          metalness={0.1}
          radius={1}
          distort={0.4}
        />
      </Sphere>
      <ThreeSparkles count={40} scale={4} size={2} speed={0.4} opacity={0.3} color="#ffffff" />
    </Float>
  );
}

// ==========================================
// 🎨 3D SCENE WRAPPER
// ==========================================
function ThreeVisualizer({ status, audioRef }) {
  const analyserRef = useRef(null);
  const audioContextRef = useRef(null);

  useEffect(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (status === 'speaking' && audioRef.current) {
      const audio = audioRef.current;
      const ctx = audioContextRef.current;
      try {
        if (ctx.state === 'suspended') ctx.resume();
        if (!analyserRef.current) {
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 64; 
          analyserRef.current = analyser;
          if (!audio.sourceNode) {
            const source = ctx.createMediaElementSource(audio);
            source.connect(analyser);
            analyser.connect(ctx.destination);
            audio.sourceNode = source;
          }
        }
      } catch (e) { console.warn(e); }
    }
  }, [status, audioRef]);

  return (
    <div className="absolute inset-0 w-full h-full z-0">
      <Canvas camera={{ position: [0, 0, 5], fov: 45 }}>
        <ambientLight intensity={0.5} />
        <pointLight position={[10, 10, 10]} intensity={1} color="white" />
        <pointLight position={[-10, -10, -10]} intensity={0.5} color="#3B82F6" />
        <Suspense fallback={null}>
            <NeuralCloud status={status} analyserRef={analyserRef} />
        </Suspense>
      </Canvas>
    </div>
  );
}

// ==========================================
// 1. LIVE MODE UI
// ==========================================
function LiveMode({ status, onClose, audioRef }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] flex flex-col font-sans text-white overflow-hidden bg-black"
    >
      <div className="absolute inset-0 bg-black pointer-events-none" />

      {/* Header */}
      <div className="relative z-20 w-full flex justify-between px-8 pt-8">
        <div className="flex items-center gap-3 opacity-60">
          <div className={`w-2 h-2 rounded-full ${status === 'listening' ? 'bg-blue-500 animate-pulse' : 'bg-white'}`} />
          <span className="text-xs font-medium tracking-[0.2em] uppercase">Chinna Live</span>
        </div>
        <button 
          onClick={onClose} 
          className="p-3 bg-white/5 rounded-full hover:bg-white/10 cursor-pointer backdrop-blur-md transition-all"
        >
          <X size={20} />
        </button>
      </div>

      {/* Main Content */}
      <div className="relative flex-1 w-full flex flex-col items-center justify-center">
        <ThreeVisualizer status={status} audioRef={audioRef} />
        
        <motion.div 
          key={status} 
          initial={{ opacity: 0 }} 
          animate={{ opacity: 1 }} 
          className="relative z-10 mt-64 text-center pointer-events-none" 
        >
          <p className="text-lg font-light tracking-widest text-white/50">
            {status === 'listening' && "Listening"}
            {status === 'processing' && "Thinking"}
            {status === 'speaking' && "Speaking"}
            {status === 'idle' && "Tap to speak"}
          </p>
        </motion.div>
      </div>
      
      {/* Footer Controls */}
      <div className="relative z-20 w-full flex justify-center pb-12">
          <div className="flex gap-6">
              <button 
                onClick={() => onClose()} 
                className="w-14 h-14 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center backdrop-blur-md transition-all"
              >
                  <X size={24} />
              </button>
              <button className="w-14 h-14 rounded-full bg-white text-black flex items-center justify-center hover:scale-105 transition-all">
                   <Mic size={24} />
              </button>
          </div>
      </div>
    </motion.div>
  );
}

// ==========================================
// 2. MAIN APP
// ==========================================
export default function App() {
  const [sessions, setSessions] = useState(() => {
    try { const saved = localStorage.getItem("chinna_sessions"); return saved ? JSON.parse(saved) : []; } catch { return []; }
  });
  const [currentSessionId, setCurrentSessionId] = useState(() => {
    const savedId = localStorage.getItem("chinna_last_active_id"); return savedId ? Number(savedId) : null;
  });
  const [messages, setMessages] = useState(() => {
    const savedId = localStorage.getItem("chinna_last_active_id");
    if (savedId && sessions.length > 0) { const found = sessions.find(s => s.id === Number(savedId)); return found ? found.messages : []; }
    return [];
  });
  const [input, setInput] = useState("");
  const [isSidebarOpen, setSidebarOpen] = useState(true);
  const [isLiveMode, setLiveMode] = useState(false);
  const [liveStatus, setLiveStatus] = useState('idle'); 
  
  const liveModeRef = useRef(false);
  const chatEndRef = useRef(null);
  const recognitionRef = useRef(null);
  const currentAudioRef = useRef(typeof Audio !== "undefined" ? new Audio() : null); 
  const utteranceRef = useRef(null);

  useEffect(() => { liveModeRef.current = isLiveMode; }, [isLiveMode]);
  useEffect(() => { localStorage.setItem("chinna_sessions", JSON.stringify(sessions)); }, [sessions]);
  useEffect(() => { if (currentSessionId) localStorage.setItem("chinna_last_active_id", currentSessionId); }, [currentSessionId]);
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, liveStatus]);

  const playAudio = (b64, textFallback) => {
    if (currentAudioRef.current) { currentAudioRef.current.pause(); currentAudioRef.current.currentTime = 0; }
    window.speechSynthesis.cancel();
    if (liveModeRef.current) setLiveStatus('speaking');

    if (b64 && currentAudioRef.current) {
      currentAudioRef.current.crossOrigin = "anonymous"; 
      currentAudioRef.current.src = `data:audio/mp3;base64,${b64}`;
      currentAudioRef.current.onend = () => {
        if (liveModeRef.current) { setLiveStatus('listening'); setTimeout(() => startListening(), 200); }
      };
      currentAudioRef.current.play().catch(err => { console.error("Audio Error:", err); speakFallback(textFallback); });
      return;
    }
    speakFallback(textFallback);
  };

  const speakFallback = (text) => {
    if (!text) { if (liveModeRef.current) { setLiveStatus('listening'); startListening(); } return; }
    utteranceRef.current = new SpeechSynthesisUtterance(text);
    const voices = window.speechSynthesis.getVoices();
    const humanVoice = voices.find(v => v.name.includes("Google") || v.name.includes("Samantha"));
    if (humanVoice) utteranceRef.current.voice = humanVoice;
    utteranceRef.current.onend = () => { if (liveModeRef.current) { setLiveStatus('listening'); startListening(); }};
    window.speechSynthesis.speak(utteranceRef.current);
  };

  const stopAudio = () => { currentAudioRef.current?.pause(); window.speechSynthesis.cancel(); };

  const startListening = () => {
    if (!("webkitSpeechRecognition" in window)) { alert("Speech recognition not supported."); return; }
    if (recognitionRef.current) try { recognitionRef.current.stop(); } catch(e){}
    const recognition = new window.webkitSpeechRecognition();
    recognition.lang = "en-US";
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onstart = () => { if (liveModeRef.current) setLiveStatus('listening'); };
    recognition.onresult = (e) => {
      const text = e.results[0][0].transcript;
      if (liveModeRef.current) setLiveStatus('processing');
      handleSend(text);
    };
    recognition.onerror = (e) => {
       if (liveModeRef.current && e.error === 'no-speech') { try { recognition.stop(); } catch(e){} setTimeout(() => startListening(), 200); }
    };
    recognition.onend = () => { if (liveModeRef.current && liveStatus === 'listening') startListening(); };
    recognitionRef.current = recognition;
    recognition.start();
  };

  const handleSend = useCallback(async (txt) => {
    const q = txt || input;
    if (!q.trim()) return;
    let activeId = currentSessionId;
    if (!activeId) { activeId = Date.now(); setCurrentSessionId(activeId); }

    const newMsgs = [...messages, { role: "user", content: q }];
    setMessages(newMsgs);
    setInput("");
    const historyContext = newMsgs.slice(-10).map(m => `${m.role === 'user' ? 'User' : 'Chinna'}: ${m.content}`);

    try {
      const res = await fetch("http://localhost:8000/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, history: historyContext }),
      });
      const data = await res.json();
      const finalMsgs = [...newMsgs, { role: "bot", content: data.answer }];
      setMessages(finalMsgs);
      setSessions(prev => {
        const idx = prev.findIndex(s => s.id === activeId);
        const newData = { id: activeId, title: q.slice(0,30), messages: finalMsgs };
        return idx > -1 ? prev.map((s, i) => i === idx ? newData : s) : [newData, ...prev];
      });
      playAudio(data.audio, data.answer);
    } catch (e) {
      console.error("API Error:", e);
      if (liveModeRef.current) { setLiveStatus('listening'); startListening(); }
    }
  }, [messages, input, currentSessionId]);

  const toggleLiveMode = () => {
    if (isLiveMode) { setLiveMode(false); setLiveStatus('idle'); stopAudio(); recognitionRef.current?.stop(); } 
    else { setLiveMode(true); setLiveStatus('listening'); setTimeout(() => startListening(), 100); }
  };
  const startNewChat = () => { stopAudio(); setCurrentSessionId(Date.now()); setMessages([]); };
  const loadSession = (id) => { stopAudio(); const s = sessions.find(x => x.id === id); if(s) { setCurrentSessionId(id); setMessages(s.messages || []); }};
  const deleteChat = (id) => { setSessions(prev => prev.filter(s => s.id !== id)); if(currentSessionId === id) startNewChat(); };

  return (
    <div className="flex h-screen bg-white text-gray-900 font-sans overflow-hidden">
      <AnimatePresence>
        {isLiveMode && (<LiveMode status={liveStatus} onClose={toggleLiveMode} audioRef={currentAudioRef} />)}
      </AnimatePresence>

      <div className={`fixed md:static inset-y-0 left-0 h-full bg-[#f0f4f9] border-r border-gray-200 overflow-hidden z-40 transition-all duration-300 ${isSidebarOpen ? 'w-[280px]' : 'w-0 opacity-0'}`}>
        <div className="w-[280px] h-full flex flex-col p-4">
           <div className="mb-6"><button onClick={() => setSidebarOpen(false)} className="p-2 hover:bg-gray-200 rounded-lg text-gray-500"><PanelLeftClose size={20} /></button></div>
           <button onClick={startNewChat} className="flex items-center gap-3 px-4 py-3 bg-[#dde3ea] hover:bg-white rounded-xl text-sm font-medium text-gray-900 transition-all mb-4"><Plus size={20} /> New Chat</button>
           <div className="flex-1 overflow-y-auto space-y-1 scrollbar-thin">
             {sessions.map(chat => (
               <div key={chat.id} className="group relative">
                 <button onClick={() => loadSession(chat.id)} className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left text-sm transition-colors ${currentSessionId === chat.id ? 'bg-blue-100 text-blue-900 font-medium' : 'text-gray-700 hover:bg-gray-100'}`}><MessageSquare size={16} /><span className="truncate flex-1">{chat.title || "New Chat"}</span></button>
                 <button onClick={(e) => { e.stopPropagation(); deleteChat(chat.id); }} className="absolute right-2 top-2 p-1 text-gray-400 hover:text-red-600 opacity-0 group-hover:opacity-100"><Trash2 size={14} /></button>
               </div>
             ))}
           </div>
        </div>
      </div>

      <div className="flex-1 flex flex-col relative h-full bg-white">
        {!isSidebarOpen && (<button onClick={() => setSidebarOpen(true)} className="absolute top-4 left-4 p-2 bg-white shadow rounded-full z-10"><PanelLeft/></button>)}
        <div className="flex-1 overflow-y-auto px-4 py-6 pb-32 scroll-smooth">
           <div className="max-w-3xl mx-auto space-y-6 pt-10">
             {messages.length === 0 && (
               <div className="flex flex-col items-center justify-center h-[60vh] text-center opacity-80 select-none">
                  <div className="w-20 h-20 bg-blue-100 rounded-full flex items-center justify-center mb-6"><Sparkles size={40} className="text-blue-600" /></div>
                  <h1 className="text-4xl font-medium bg-clip-text text-transparent bg-gradient-to-r from-blue-600 to-purple-600 mb-2">Hello, Human</h1>
               </div>
             )}
             {messages.map((m, i) => (
                <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                   <div className={`flex gap-4 max-w-[85%] ${m.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                       <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${m.role === 'user' ? 'bg-black text-white' : 'bg-white border border-gray-200 text-blue-600'}`}>{m.role === 'user' ? <User size={16} /> : <Sparkles size={16} />}</div>
                       {/* TABLE FIX APPLIED HERE 👇 */}
                       <div className={`px-5 py-3 rounded-2xl text-[15px] leading-relaxed shadow-sm overflow-x-auto ${m.role === 'user' ? 'bg-[#f0f4f9] text-gray-900' : 'bg-white border border-gray-100'}`}>
                           <ReactMarkdown 
                             remarkPlugins={[remarkGfm]}
                             components={{
                               table: ({node, ...props}) => <table className="border-collapse border border-gray-300 my-4 w-full text-sm" {...props} />,
                               thead: ({node, ...props}) => <thead className="bg-gray-100" {...props} />,
                               th: ({node, ...props}) => <th className="border border-gray-300 px-4 py-2 text-left font-semibold text-gray-700" {...props} />,
                               td: ({node, ...props}) => <td className="border border-gray-300 px-4 py-2 text-gray-600" {...props} />,
                               a: ({node, ...props}) => <a className="text-blue-600 hover:underline" {...props} />,
                               ul: ({node, ...props}) => <ul className="list-disc pl-5 my-2" {...props} />,
                               ol: ({node, ...props}) => <ol className="list-decimal pl-5 my-2" {...props} />,
                             }}
                           >
                               {String(m.content)}
                           </ReactMarkdown>
                       </div>
                   </div>
                </div>
             ))}
             <div ref={chatEndRef} />
           </div>
        </div>
        <div className="fixed bottom-0 left-0 right-0 bg-white/80 backdrop-blur pb-6 pt-4 z-10">
           <div className="max-w-2xl mx-auto px-4">
              <div className="bg-[#f0f4f9] p-2 rounded-full flex items-center gap-2 shadow-sm border border-gray-200">
                 <button onClick={toggleLiveMode} className="p-3 bg-gray-900 text-white rounded-full hover:bg-black transition-all shadow-md flex items-center gap-2 px-4"><Mic size={20} /> <span className="text-xs font-bold">LIVE</span></button>
                 <input className="flex-1 bg-transparent border-none outline-none px-4 text-gray-800" placeholder="Message Chinna..." value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSend()} />
                 <button onClick={() => handleSend()} className="p-3 text-blue-600 hover:bg-blue-100 rounded-full"><Send size={20}/></button>
              </div>
           </div>
        </div>
      </div>
    </div>
  );
}