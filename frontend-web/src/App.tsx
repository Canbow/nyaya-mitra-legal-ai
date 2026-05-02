import { useState, useRef, useEffect } from 'react';
import { Send, Paperclip, Wand2, Scale } from 'lucide-react';
import { ChatBubble } from './components/ChatBubble';
import { AiAnalysisBubble } from './components/AiAnalysisBubble';

export default function App() {
  const [messages, setMessages]   = useState<any[]>([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [userId, setUserId]       = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const quickPrompts = [
    'Summarize this contract',
    'What are the highest risks?',
    'Tell me about termination clauses',
    'Is the rent penalty fair?'
  ];

  // ─── Auto-create guest user on first visit ───────────────────────────────
  useEffect(() => {
    const initUser = async () => {
      // Check if we already have a user_id from a previous visit
      const stored = localStorage.getItem('nyaya_user_id');
      if (stored) {
        setUserId(stored);
        return;
      }

      // First visit — create a guest user automatically
      try {
        const res  = await fetch('/api/auth/guest', { method: 'POST' });
        const data = await res.json();
        if (data.user_id) {
          localStorage.setItem('nyaya_user_id', data.user_id);
          setUserId(data.user_id);
          console.log('[Nyaya-Mitra] Guest user created:', data.user_id);
        }
      } catch (err) {
        console.error('[Nyaya-Mitra] Failed to create guest user:', err);
      }
    };

    initUser();
  }, []);

  // ─── Chat: send text message ──────────────────────────────────────────────
  const sendMessage = async () => {
    if (!inputText.trim() || !userId) return;

    const userMessage = { sender: 'user', text: inputText };
    setMessages(prev => [...prev, userMessage]);
    const currentInput = inputText;
    setInputText('');
    setIsLoading(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, message: currentInput })
      });

      const data = await res.json();

      if (!res.ok) throw new Error(data.error || 'API Error');

      setMessages(prev => [
        ...prev,
        { sender: 'ai', text: data.response || 'No response.' }
      ]);
    } catch (e: any) {
      setMessages(prev => [
        ...prev,
        { sender: 'ai', text: e.message || 'Error connecting to the backend.' }
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  // ─── Document upload ──────────────────────────────────────────────────────
  const handleFilePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;

    const file   = e.target.files[0];
    const kbSize = (file.size / 1024).toFixed(1);

    setMessages(prev => [
      ...prev,
      { sender: 'user', text: `📎 Uploaded: ${file.name} (${kbSize} KB)` }
    ]);
    setIsLoading(true);

    try {
      // userId is guaranteed here because initUser runs on mount
      const formData = new FormData();
      formData.append('file', file);
      formData.append('user_id', userId!);

      const res = await fetch('/api/documents/upload', {
        method: 'POST',
        body: formData
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload Error');

      // Map backend response to what AiAnalysisBubble expects
      const clauses = (data.analysis || []).map((item: any) => ({
        title:     `Clause ${item.clause_number}`,
        legalText: item.clause_text,
        simpleText: item.is_risky
          ? `⚠️ ${item.issue}\n\n📖 Law: ${item.relevant_law || 'N/A'}\n\n✅ Recommendation: ${item.recommendation || 'N/A'}`
          : '✅ This clause appears standard and fair.',
        riskLevel: item.risk_level || 'low'
      }));

      // Calculate risk score from percentage of risky clauses
      const riskyCount = (data.analysis || []).filter((c: any) => c.is_risky).length;
      const totalCount = (data.analysis || []).length;
      const riskScore  = totalCount > 0
        ? Math.round((riskyCount / totalCount) * 100)
        : 0;

      setMessages(prev => [
        ...prev,
        {
          sender:    'ai',
          type:      'analysis',
          riskScore: riskScore,
          clauses:   clauses
        },
        {
          sender: 'ai',
          text:   data.summary
            ? `📋 Summary: ${data.summary}`
            : 'Analysis complete.'
        }
      ]);
    } catch (err: any) {
      setMessages(prev => [
        ...prev,
        { sender: 'ai', text: err.message || 'Error uploading document.' }
      ]);
    } finally {
      setIsLoading(false);
      e.target.value = '';
    }
  };

  // ─── Demo analysis ────────────────────────────────────────────────────────
  const addDemoAnalysis = () => {
    setMessages(prev => [
      ...prev,
      {
        sender:    'ai',
        type:      'analysis',
        riskScore: 82,
        clauses:   [
          {
            title:     'Rent & Late Fees',
            legalText: 'The Lessee shall remit the monthly rent of ₹15,000 on or before the 5th day of each calendar month. A penal interest of 18% per annum shall be levied on delayed payments.',
            simpleText:'You must pay ₹15,000 by the 5th every month. If late, you will be charged a high penalty fee.',
            riskLevel: 'high'
          },
          {
            title:     'Maintenance',
            legalText: 'The Lessee covenants to keep the demised premises in good tenantable repair, fair wear and tear excepted.',
            simpleText:'You must keep the house clean but are not responsible for normal aging of the property.',
            riskLevel: 'low'
          }
        ]
      }
    ]);
  };

  // ─── UI ───────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-screen bg-gray-50 font-sans">

      {/* Header */}
      <header className="bg-primary text-white h-16 flex items-center justify-between px-6 shadow-md shrink-0">
        <div className="flex items-center space-x-3">
          <Scale className="text-white" />
          <h1 className="font-bold text-xl tracking-wide">Nyaya-Mitra</h1>
        </div>
        <button
          onClick={() => setMessages([])}
          className="text-sm font-medium hover:text-secondary transition"
        >
          Clear Chat
        </button>
      </header>

      {/* Main chat area */}
      <main className="flex-1 overflow-y-auto w-full max-w-4xl mx-auto p-6 flex flex-col">
        {messages.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center pt-10 animate-in fade-in">
            <Scale size={80} className="text-primary/20 mb-6" />
            <h2 className="text-3xl font-bold text-gray-800 mb-2 mt-4">
              Welcome to Nyaya-Mitra
            </h2>
            <p className="text-gray-500 text-lg mb-10 text-center max-w-md">
              Upload a lease agreement or click below to see a sample analysis.
            </p>

            <div className="mb-4 font-medium text-gray-600">Quick suggestions:</div>
            <div className="flex flex-wrap justify-center gap-3">
              {quickPrompts.map((prompt, i) => (
                <button
                  key={i}
                  onClick={() => setInputText(prompt)}
                  className="px-4 py-2 bg-secondary/30 text-primary hover:bg-secondary/50 rounded-full text-sm font-medium transition"
                >
                  {prompt}
                </button>
              ))}
            </div>

            <button
              onClick={addDemoAnalysis}
              className="mt-8 flex items-center space-x-2 bg-white border border-primary/20 px-5 py-3 rounded-xl shadow-sm hover:shadow-md transition text-primary font-semibold"
            >
              <Wand2 size={18} />
              <span>Show Demo Analysis</span>
            </button>
          </div>
        ) : (
          <div className="flex flex-col space-y-4 pb-4">
            {messages.map((msg, i) =>
              msg.type === 'analysis' ? (
                <AiAnalysisBubble
                  key={i}
                  clauses={msg.clauses}
                  riskScore={msg.riskScore}
                />
              ) : (
                <ChatBubble
                  key={i}
                  text={msg.text}
                  isUser={msg.sender === 'user'}
                />
              )
            )}
            {isLoading && (
              <div className="text-gray-400 text-sm ml-2 animate-pulse mt-4">
                Analyzing document...
              </div>
            )}
          </div>
        )}
      </main>

      {/* Footer input */}
      <footer className="bg-white border-t border-gray-200 p-4 shrink-0 shadow-[0_-4px_10px_rgba(0,0,0,0.02)]">
        <div className="max-w-4xl mx-auto flex items-center bg-gray-100 rounded-full px-4 py-2 border border-gray-200 focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20 transition-all">
          <input
            type="file"
            className="hidden"
            ref={fileInputRef}
            onChange={handleFilePick}
            accept=".pdf,.docx"
          />
          <button
            className="p-2 text-primary hover:bg-gray-200 rounded-full transition"
            onClick={() => fileInputRef.current?.click()}
          >
            <Paperclip size={20} />
          </button>
          <input
            type="text"
            className="flex-1 bg-transparent border-none outline-none px-4 text-gray-800"
            placeholder="Type a query or upload a contract..."
            value={inputText}
            onChange={e => setInputText(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && sendMessage()}
          />
          <button
            className="p-2 bg-primary text-white rounded-full hover:bg-primary/90 transition shadow-sm ml-2"
            onClick={sendMessage}
          >
            <Send size={18} />
          </button>
        </div>
      </footer>
    </div>
  );
}