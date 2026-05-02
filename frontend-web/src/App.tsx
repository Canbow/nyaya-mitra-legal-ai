import { useState, useRef } from 'react';
import { Send, Paperclip, Wand2, UserCircle, Scale } from 'lucide-react';
import { ChatBubble } from './components/ChatBubble';
import { AiAnalysisBubble } from './components/AiAnalysisBubble';

export default function App() {
  const [messages, setMessages] = useState<any[]>([]);
  const [inputText, setInputText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [userId, setUserId] = useState<string | null>(
    localStorage.getItem('nyaya_user_id')
  );
  const [userName, setUserName] = useState<string>(
    localStorage.getItem('nyaya_user_name') || ''
  );
  const [authEmail, setAuthEmail] = useState('');
  const [authName, setAuthName] = useState('');
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [authError, setAuthError] = useState('');

  
  const fileInputRef = useRef<HTMLInputElement>(null);

  const quickPrompts = [
    'Summarize this contract',
    'What are the highest risks?',
    'Tell me about termination clauses',
    'Is the rent penalty fair?'
  ];

  const sendMessage = async () => {
    if (!inputText.trim()) return;
    const userMessage = { sender: 'user', text: inputText };
    setMessages((prev) => [...prev, userMessage]);
    const currentInput = inputText;
    setInputText('');
    setIsLoading(true);

    try {
      const response = await fetch('http://localhost:3000/api/analyze-document/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ document_text: currentInput })
      });

      if (!response.ok) {
        let errMsg = 'API Error';
        try {
          const errData = await response.json();
          errMsg = errData.error || errMsg;
        } catch (_) {}
        throw new Error(errMsg);
      }
      const data = await response.json();
      
      const newMessages: any[] = [];
      const isDocument = data.red_flags && data.red_flags.length > 0;
      
      if (isDocument) {
        newMessages.push({ 
          sender: 'ai', 
          type: 'analysis',
          riskScore: data.bias_score ?? 50,
          clauses: data.red_flags.map((rf: any) => ({
             title: rf.clause,
             legalText: "Analyzed Text",
             simpleText: rf.reason,
             riskLevel: "high"
          }))
        });
      }
      
      newMessages.push({ 
        sender: 'ai', 
        text: data.summary_text ? `${!isDocument ? '' : 'Summary: '}${data.summary_text}\n\n(Source: ${data.source === 'database_cache' ? 'Database Cache ⚡' : 'AI API 🤖'})` : 'No response.' 
      });

      setMessages((prev) => [...prev, ...newMessages]);
    } catch (e: any) {
      setMessages((prev) => [...prev, { sender: 'ai', text: e.message || 'Error connecting to the backend.' }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      const kbSize = (file.size / 1024).toFixed(1);
      
      setMessages(prev => [...prev, { sender: 'user', text: `📎 Attached Document: ${file.name}\n(Size: ${kbSize} KB)` }]);
      setIsLoading(true);
      
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64String = (reader.result as string)?.split(',')[1];
        if (!base64String) {
          setIsLoading(false);
          return;
        }

        try {
          const extension = file.name.split('.').pop() || '*';
          const response = await fetch('http://localhost:3000/api/upload/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fileName: file.name,
              fileType: extension,
              contentBase64: base64String
            })
          });

          if (!response.ok) {
            let errMsg = 'Upload Error';
            try {
              const errData = await response.json();
              errMsg = errData.error || errMsg;
            } catch (_) {}
            throw new Error(errMsg);
          }
          const data = await response.json();
          
          setMessages(prev => [
            ...prev,
            {
              sender: 'ai',
              type: 'analysis',
              riskScore: data.riskScore ?? 50,
              clauses: data.clauses || []
            },
            {
              sender: 'ai',
              text: data.summary ? `Summary: ${data.summary}\n\n(Source: ${data.source === 'database_cache' ? 'Database Cache ⚡' : 'AI API 🤖'})` : 'Analysis complete.'
            }
          ]);
        } catch(err: any) {
          setMessages(prev => [...prev, { sender: 'ai', text: err.message || 'Error uploading the document to the server.' }]);
        } finally {
          setIsLoading(false);
        }
      };
      
      reader.readAsDataURL(file);
      e.target.value = '';
    }
  };

  const addDemoAnalysis = () => {
    setMessages((prev) => [
      ...prev,
      {
        sender: 'ai',
        type: 'analysis',
        riskScore: 82,
        clauses: [
          {
            title: "Rent & Late Fees",
            legalText: "The Lessee shall remit the monthly rent of ₹15,000 on or before the 5th day of each calendar month. A penal interest of 18% per annum shall be levied on delayed payments.",
            simpleText: "You must pay ₹15,000 by the 5th of every month. If you are late, you will be charged a high penalty fee.",
            riskLevel: "high"
          },
          {
            title: "Maintenance",
            legalText: "The Lessee covenants to keep the demised premises in good tenantable repair, fair wear and tear excepted.",
            simpleText: "You must keep the house clean, but you are not responsible for normal aging of the property.",
            riskLevel: "low"
          }
        ]
      }
    ]);
  };

  return (
    <div className="flex flex-col h-screen bg-gray-50 font-sans relative">
      <header className="bg-primary text-white h-16 flex items-center justify-between px-6 shadow-md z-10 shrink-0">
        <div className="flex items-center space-x-3">
          <Scale className="text-white" />
          <h1 className="font-bold text-xl tracking-wide">Nyaya-Mitra</h1>
        </div>
        <div className="flex items-center space-x-4">
          <button 
            onClick={() => setMessages([])} 
            className="text-sm font-medium hover:text-secondary transition"
          >
            Clear Chat
          </button>
          
          <button onClick={() => setShowAuthModal(!showAuthModal)}>
            {isLoggedIn ? (
              <img src="https://i.pravatar.cc/150?img=68" alt="Profile" className="w-8 h-8 rounded-full border-2 border-secondary object-cover" />
            ) : (
              <UserCircle size={28} className="cursor-pointer hover:text-secondary transition" />
            )}
          </button>
        </div>
      </header>

      {/* Auth Modal Overlay */}
      {showAuthModal && (
        <div className="absolute top-16 right-6 bg-white border border-gray-200 rounded-xl shadow-lg p-5 z-20 w-64 animate-in fade-in zoom-in duration-200">
          <div className="flex flex-col items-center w-full">
            {isLoggedIn ? (
              <>
                <img src="https://i.pravatar.cc/150?img=68" alt="Profile" className="w-16 h-16 rounded-full border border-gray-200 object-cover mb-3" />
                <p className="text-gray-800 font-medium text-center mb-4">Welcome back, User!</p>
                <button 
                  onClick={() => { setIsLoggedIn(false); setShowAuthModal(false); }}
                  className="w-full py-2 bg-red-500 text-white rounded-lg font-medium hover:bg-red-600 transition shadow-sm"
                >
                  Sign Out
                </button>
              </>
            ) : (
              <>
                <UserCircle size={48} className="text-primary/50 mb-3" />
                <p className="text-gray-800 font-medium text-center mb-4 text-sm">
                  Sign in to save your documents and history.
                </p>
                
                <div className="w-full space-y-3 mb-4 flex flex-col gap-3">
                  <input type="email" placeholder="Email" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:border-primary/50" />
                  <input type="password" placeholder="Password" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:border-primary/50" />
                  <button 
                    onClick={() => { setIsLoggedIn(true); setShowAuthModal(false); }}
                    className="w-full py-2 bg-primary text-white rounded-lg font-medium hover:bg-primary/90 transition shadow-sm text-sm p-2"
                  >
                    Log In
                  </button>
                </div>
                
                <div className="flex items-center w-full mb-4">
                  <div className="h-px bg-gray-200 flex-1"></div>
                  <span className="px-2 text-xs text-gray-400 font-bold">OR</span>
                  <div className="h-px bg-gray-200 flex-1"></div>
                </div>

                <button 
                  onClick={() => { setIsLoggedIn(true); setShowAuthModal(false); }}
                  className="w-full py-2.5 bg-white border border-gray-300 text-gray-700 rounded-lg font-medium hover:bg-gray-50 transition shadow-sm flex items-center justify-center space-x-2 text-sm"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" /><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" /><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" /><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" /></svg>
                  <span>Sign In with Google</span>
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Dismiss Modal Area */}
      {showAuthModal && (
        <div className="absolute inset-0 z-10" onClick={() => setShowAuthModal(false)} />
      )}

      <main className="flex-1 overflow-y-auto w-full max-w-4xl mx-auto p-6 flex flex-col z-0">
        {messages.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center pt-10 animate-in fade-in">
            <Scale size={80} className="text-primary/20 mb-6" />
            <h2 className="text-3xl font-bold text-gray-800 mb-2 mt-4">Welcome to Nyaya-Mitra</h2>
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
            {messages.map((msg, i) => (
              msg.type === 'analysis' ? (
                <AiAnalysisBubble key={i} clauses={msg.clauses} riskScore={msg.riskScore} />
              ) : (
                <ChatBubble key={i} text={msg.text} isUser={msg.sender === 'user'} />
              )
            ))}
            {isLoading && (
              <div className="text-gray-400 text-sm ml-2 animate-pulse mt-4">Analyzing document...</div>
            )}
          </div>
        )}
      </main>

      <footer className="bg-white border-t border-gray-200 p-4 shrink-0 shadow-[0_-4px_10px_rgba(0,0,0,0.02)] z-0">
        <div className="max-w-4xl mx-auto flex items-center bg-gray-100 rounded-full px-4 py-2 border border-gray-200 focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20 transition-all">
          <input 
            type="file" 
            className="hidden" 
            ref={fileInputRef} 
            onChange={handleFilePick}
            accept=".jpg,.jpeg,.png,.pdf,.doc,.docx" 
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
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
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
