import { useState } from 'react';
import { AlertCircle, CheckCircle } from 'lucide-react';
import { cn } from './ChatBubble';

interface DocumentClause {
  title: string;
  legalText: string;
  simpleText: string;
  riskLevel: 'high' | 'medium' | 'low';
}

interface AiAnalysisBubbleProps {
  clauses: DocumentClause[];
  riskScore: number;
}

export const AiAnalysisBubble: React.FC<AiAnalysisBubbleProps> = ({ clauses, riskScore }) => {
  const isHighRisk = riskScore >= 70;
  const isMediumRisk = riskScore >= 30 && riskScore < 70;

  const getTheme = () => {
    if (isHighRisk) return { bg: 'bg-red-50', text: 'text-red-700', bar: 'bg-red-500', title: 'High Risk Contract Detected' };
    if (isMediumRisk) return { bg: 'bg-orange-50', text: 'text-orange-700', bar: 'bg-orange-500', title: 'Moderate Risk Contract Detected' };
    return { bg: 'bg-green-50', text: 'text-green-700', bar: 'bg-green-500', title: 'Contract looks healthy' };
  };

  const theme = getTheme();

  return (
    <div className="w-full mt-4 bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden max-w-3xl">
      {/* Header */}
      <div className={cn("p-5 flex items-start space-x-4", theme.bg)}>
        {isHighRisk ? (
          <AlertCircle className="text-red-600 shrink-0 w-8 h-8" />
        ) : (
          <CheckCircle className={cn("shrink-0 w-8 h-8", theme.text)} />
        )}
        <div className="flex-1">
          <div className="flex items-center justify-between">
            <h3 className={cn("font-bold text-lg", theme.text)}>
              {theme.title}
            </h3>
            <span className={cn(
              "px-3 py-1 rounded-full text-sm font-bold bg-white/60",
              theme.text
            )}>
              {riskScore}% Risk
            </span>
          </div>
          
          <div className="mt-3 bg-white/50 h-2.5 rounded-full overflow-hidden w-full max-w-md">
            <div 
              className={cn("h-full rounded-full", theme.bar)}
              style={{ width: `${riskScore}%` }}
            />
          </div>
          
          <p className="text-sm mt-3 text-gray-700 font-medium">
            {clauses.length} clauses analyzed · {isHighRisk ? 'Review urgently' : isMediumRisk ? 'Proceed with caution' : 'No immediate red flags'}
          </p>
        </div>
      </div>

      <div className="p-4 px-6 border-b border-gray-100 bg-gray-50/50">
        <p className="text-sm text-gray-600">
          Summary of key clauses below. Toggle to switch between simple English and legal text.
        </p>
      </div>

      <div className="p-4 space-y-3">
        {clauses.map((clause, idx) => (
          <ClauseCard key={idx} clause={clause} />
        ))}
      </div>
      
      <div className="px-5 py-4 border-t border-gray-100 bg-gray-50 flex gap-3">
        <button className="flex-1 py-2 border border-primary text-primary font-medium rounded-lg hover:bg-primary/5 transition">
          Save Contract
        </button>
        <button className="flex-1 py-2 bg-[#1E3A8A] text-white font-medium rounded-lg hover:bg-blue-900 transition shadow-sm">
          How to Fix
        </button>
      </div>
    </div>
  );
};

const ClauseCard: React.FC<{ clause: DocumentClause }> = ({ clause }) => {
  const [isSimpleView, setIsSimpleView] = useState(true);
  const [isOpen, setIsOpen] = useState(true);

  const getRiskColor = () => {
    switch (clause.riskLevel) {
      case 'high': return 'bg-red-500';
      case 'medium': return 'bg-orange-500';
      case 'low': return 'bg-green-500';
      default: return 'bg-gray-500';
    }
  };

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden bg-white shadow-sm transition-all">
      <button 
        className="w-full px-5 py-3.5 flex items-center justify-between hover:bg-gray-50 transition"
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="flex items-center space-x-3">
          <span className={`w-2.5 h-2.5 rounded-full ${getRiskColor()} shadow-sm`} />
          <span className="font-semibold text-gray-800 text-[15px]">{clause.title}</span>
        </div>
        <div className="text-gray-400">
          {isOpen ? '▲' : '▼'}
        </div>
      </button>

      {isOpen && (
        <div className="px-5 pb-5 pt-1">
          <div className="flex items-center space-x-1 p-1 bg-gray-100/80 rounded-lg w-fit mb-4 mt-2">
            <button 
              className={cn(
                "px-4 py-1.5 text-xs font-semibold rounded-md transition-all", 
                isSimpleView ? "bg-white text-gray-800 shadow-sm" : "text-gray-500 hover:text-gray-700"
              )}
              onClick={() => setIsSimpleView(true)}
            >
              Simple English
            </button>
            <button 
              className={cn(
                "px-4 py-1.5 text-xs font-semibold rounded-md transition-all", 
                !isSimpleView ? "bg-white text-gray-800 shadow-sm" : "text-gray-500 hover:text-gray-700"
              )}
              onClick={() => setIsSimpleView(false)}
            >
              Legal Text
            </button>
          </div>

          <p className={cn(
            "text-[14.5px] leading-relaxed transition-all",
            isSimpleView 
              ? "text-gray-800 font-sans" 
              : "text-gray-600 font-serif italic border-l-2 border-gray-200 pl-4 py-1"
          )}>
            {isSimpleView ? clause.simpleText : clause.legalText}
          </p>
        </div>
      )}
    </div>
  );
};
