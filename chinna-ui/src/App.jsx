import { useState, useEffect, useRef, useCallback } from "react";
import { 
  Send, Plus, PanelLeftClose, PanelLeft, 
  Trash2, MessageSquare, Sparkles, User, Loader2 
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export default function App() {
  // --- STATE ---
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
  
  // ✨ NEW: Loading State
  const [isLoading, setIsLoading] = useState(false);

  // --- REFS ---
  const chatEndRef = useRef(null);

  // --- EFFECTS ---
  useEffect(() => { localStorage.setItem("chinna_sessions", JSON.stringify(sessions)); }, [sessions]);
  useEffect(() => { if (currentSessionId) localStorage.setItem("chinna_last_active_id", currentSessionId); }, [currentSessionId]);
  
  // Scroll to bottom whenever messages change OR loading state changes
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, isLoading]);

  // --- HANDLERS ---
  const handleSend = useCallback(async (txt) => {
    const q = txt || input;
    if (!q.trim() || isLoading) return; // Prevent double send
    
    let activeId = currentSessionId;
    if (!activeId) { activeId = Date.now(); setCurrentSessionId(activeId); }

    // 1. Add User Message immediately
    const newMsgs = [...messages, { role: "user", content: q }];
    setMessages(newMsgs);
    setInput("");
    setIsLoading(true); // ✨ Start Loading
    
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

    } catch (e) {
      console.error("API Error:", e);
      setMessages(prev => [...prev, { role: "bot", content: "⚠️ Error connecting to server." }]);
    } finally {
      setIsLoading(false); // ✨ Stop Loading
    }
  }, [messages, input, currentSessionId, isLoading]);

  const startNewChat = () => { setCurrentSessionId(Date.now()); setMessages([]); };
  const loadSession = (id) => { const s = sessions.find(x => x.id === id); if(s) { setCurrentSessionId(id); setMessages(s.messages || []); }};
  const deleteChat = (id) => { setSessions(prev => prev.filter(s => s.id !== id)); if(currentSessionId === id) startNewChat(); };

  // --- RENDER ---
  return (
    <div className="flex h-screen bg-white text-gray-900 font-sans overflow-hidden">
      
      {/* SIDEBAR */}
      <div className={`fixed md:static inset-y-0 left-0 h-full bg-[#f0f4f9] border-r border-gray-200 overflow-hidden z-40 transition-all duration-300 ${isSidebarOpen ? 'w-[280px]' : 'w-0 opacity-0'}`}>
        <div className="w-[280px] h-full flex flex-col p-4">
           <div className="mb-6"><button onClick={() => setSidebarOpen(false)} className="p-2 hover:bg-gray-200 rounded-lg text-gray-500"><PanelLeftClose size={20} /></button></div>
           
           <button onClick={startNewChat} className="flex items-center gap-3 px-4 py-3 bg-[#dde3ea] hover:bg-white rounded-xl text-sm font-medium text-gray-900 transition-all mb-4">
             <Plus size={20} /> New Chat
           </button>
           
           <div className="flex-1 overflow-y-auto space-y-1 scrollbar-thin">
             {sessions.map(chat => (
               <div key={chat.id} className="group relative">
                 <button onClick={() => loadSession(chat.id)} className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left text-sm transition-colors ${currentSessionId === chat.id ? 'bg-blue-100 text-blue-900 font-medium' : 'text-gray-700 hover:bg-gray-100'}`}>
                   <MessageSquare size={16} />
                   <span className="truncate flex-1">{chat.title || "New Chat"}</span>
                 </button>
                 <button onClick={(e) => { e.stopPropagation(); deleteChat(chat.id); }} className="absolute right-2 top-2 p-1 text-gray-400 hover:text-red-600 opacity-0 group-hover:opacity-100">
                   <Trash2 size={14} />
                 </button>
               </div>
             ))}
           </div>
        </div>
      </div>

      {/* MAIN CHAT AREA */}
      <div className="flex-1 flex flex-col relative h-full bg-white">
        {!isSidebarOpen && (<button onClick={() => setSidebarOpen(true)} className="absolute top-4 left-4 p-2 bg-white shadow rounded-full z-10"><PanelLeft/></button>)}
        
        <div className="flex-1 overflow-y-auto px-4 py-6 pb-32 scroll-smooth">
           <div className="max-w-3xl mx-auto space-y-6 pt-10">
             
             {messages.length === 0 && (
               <div className="flex flex-col items-center justify-center h-[60vh] text-center opacity-80 select-none">
                  <div className="w-20 h-20 bg-blue-100 rounded-full flex items-center justify-center mb-6">
                    <Sparkles size={40} className="text-blue-600" />
                  </div>
                  <h1 className="text-4xl font-medium bg-clip-text text-transparent bg-gradient-to-r from-blue-600 to-purple-600 mb-2">
                    Hello, Human
                  </h1>
               </div>
             )}

             {messages.map((m, i) => (
                <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                   <div className={`flex gap-4 max-w-[85%] ${m.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                       <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${m.role === 'user' ? 'bg-black text-white' : 'bg-white border border-gray-200 text-blue-600'}`}>
                         {m.role === 'user' ? <User size={16} /> : <Sparkles size={16} />}
                       </div>
                       
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

             {/* ✨ LOADING BUBBLE ✨ */}
             {isLoading && (
               <div className="flex justify-start">
                 <div className="flex gap-4 max-w-[85%] flex-row">
                    <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 bg-white border border-gray-200 text-blue-600 animate-pulse">
                      <Sparkles size={16} />
                    </div>
                    <div className="px-5 py-4 rounded-2xl bg-white border border-gray-100 shadow-sm flex items-center gap-2">
                      <Loader2 size={16} className="animate-spin text-blue-600" />
                      <span className="text-gray-500 text-sm">Thinking...</span>
                    </div>
                 </div>
               </div>
             )}

             <div ref={chatEndRef} />
           </div>
        </div>

        {/* INPUT AREA */}
        <div className="fixed bottom-0 left-0 right-0 bg-white/80 backdrop-blur pb-6 pt-4 z-10">
           <div className="max-w-2xl mx-auto px-4">
              <div className="bg-[#f0f4f9] p-2 rounded-full flex items-center gap-2 shadow-sm border border-gray-200">
                 <input 
                   className="flex-1 bg-transparent border-none outline-none px-4 text-gray-800 disabled:opacity-50" 
                   placeholder="Message Chinna..." 
                   value={input} 
                   onChange={e => setInput(e.target.value)} 
                   onKeyDown={e => e.key === 'Enter' && !isLoading && handleSend()} 
                   disabled={isLoading}
                 />
                 <button 
                   onClick={() => handleSend()} 
                   disabled={isLoading || !input.trim()}
                   className="p-3 text-blue-600 hover:bg-blue-100 rounded-full transition-colors disabled:opacity-30 disabled:hover:bg-transparent"
                 >
                   <Send size={20}/>
                 </button>
              </div>
           </div>
        </div>

      </div>
    </div>
  );
}