import { useState } from 'react';
import { AlertCircle, CheckCircle, Download, Wrench, X } from 'lucide-react';
import { cn } from './ChatBubble';

interface DocumentClause {
  title: string;
  legalText: string;
  simpleText: string;
  riskLevel: 'high' | 'medium' | 'low' | 'critical';
}

interface AiAnalysisBubbleProps {
  clauses: DocumentClause[];
  riskScore: number;
}

export const AiAnalysisBubble: React.FC<AiAnalysisBubbleProps> = ({ clauses, riskScore }) => {
  const [showFixModal, setShowFixModal] = useState(false);

  const isHighRisk   = riskScore >= 70;
  const isMediumRisk = riskScore >= 30 && riskScore < 70;

  const getTheme = () => {
    if (isHighRisk)   return { bg: 'bg-red-50',    text: 'text-red-700',    bar: 'bg-red-500',    title: 'High Risk Contract Detected'    };
    if (isMediumRisk) return { bg: 'bg-orange-50', text: 'text-orange-700', bar: 'bg-orange-500', title: 'Moderate Risk Contract Detected' };
    return              { bg: 'bg-green-50',  text: 'text-green-700',  bar: 'bg-green-500',  title: 'Contract looks healthy'          };
  };

  const theme = getTheme();

  const handleSaveContract = () => {
    const lines: string[] = [];
    lines.push('NYAYA-MITRA — LEGAL DOCUMENT ANALYSIS REPORT');
    lines.push('='.repeat(52));
    lines.push(`Generated on : ${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}`);
    lines.push(`Overall Risk : ${riskScore}%  (${isHighRisk ? 'HIGH' : isMediumRisk ? 'MEDIUM' : 'LOW'})`);
    lines.push(`Total Clauses: ${clauses.length}`);
    lines.push(`Risky Clauses: ${clauses.filter(c => c.riskLevel !== 'low').length}`);
    lines.push('');
    lines.push('CLAUSE-BY-CLAUSE ANALYSIS');
    lines.push('-'.repeat(52));
    clauses.forEach((clause, idx) => {
      lines.push('');
      lines.push(`Clause ${idx + 1}: ${clause.title}`);
      lines.push(`Risk Level  : ${clause.riskLevel.toUpperCase()}`);
      lines.push(`Legal Text  : ${clause.legalText}`);
      lines.push(`Analysis    : ${clause.simpleText}`);
      lines.push('-'.repeat(40));
    });
    lines.push('');
    lines.push('Powered by Nyaya-Mitra | AI-Driven Legal Analysis');

    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `nyaya-mitra-analysis-${Date.now()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const riskyClausesList = clauses.filter(c => c.riskLevel !== 'low');

  return (
    <>
      <div className="w-full mt-4 bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden max-w-3xl">

        <div className={cn('p-5 flex items-start space-x-4', theme.bg)}>
          {isHighRisk ? (
            <AlertCircle className="text-red-600 shrink-0 w-8 h-8" />
          ) : (
            <CheckCircle className={cn('shrink-0 w-8 h-8', theme.text)} />
          )}
          <div className="flex-1">
            <div className="flex items-center justify-between">
              <h3 className={cn('font-bold text-lg', theme.text)}>{theme.title}</h3>
              <span className={cn('px-3 py-1 rounded-full text-sm font-bold bg-white/60', theme.text)}>
                {riskScore}% Risk
              </span>
            </div>
            <div className="mt-3 bg-white/50 h-2.5 rounded-full overflow-hidden w-full max-w-md">
              <div className={cn('h-full rounded-full', theme.bar)} style={{ width: `${riskScore}%` }} />
            </div>
            <p className="text-sm mt-3 text-gray-700 font-medium">
              {clauses.length} clauses analyzed ·{' '}
              {isHighRisk ? 'Review urgently' : isMediumRisk ? 'Proceed with caution' : 'No immediate red flags'}
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
          <button
            onClick={handleSaveContract}
            className="flex-1 py-2.5 border border-primary text-primary font-medium rounded-lg hover:bg-primary/5 transition flex items-center justify-center gap-2"
          >
            <Download size={16} />
            Save Contract
          </button>
          <button
            onClick={() => setShowFixModal(true)}
            className="flex-1 py-2.5 bg-[#1E3A8A] text-white font-medium rounded-lg hover:bg-blue-900 transition shadow-sm flex items-center justify-center gap-2"
          >
            <Wrench size={16} />
            How to Fix
          </button>
        </div>
      </div>

      {showFixModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col">

            <div className="p-5 border-b border-gray-100 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <Wrench size={20} className="text-[#1E3A8A]" />
                <h3 className="font-bold text-lg text-gray-800">How to Fix — Recommendations</h3>
              </div>
              <button
                onClick={() => setShowFixModal(false)}
                className="p-1.5 hover:bg-gray-100 rounded-full transition text-gray-400 hover:text-gray-600"
              >
                <X size={20} />
              </button>
            </div>

            <div className="px-5 py-3 bg-blue-50 border-b border-blue-100 shrink-0">
              <p className="text-sm text-blue-700 font-medium">
                {riskyClausesList.length} risky clause{riskyClausesList.length !== 1 ? 's' : ''} found · Review each recommendation carefully before signing.
              </p>
            </div>

            <div className="overflow-y-auto flex-1 p-5 space-y-4">
              {riskyClausesList.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <CheckCircle size={48} className="text-green-400 mb-3" />
                  <p className="text-gray-600 font-medium">No risky clauses found.</p>
                  <p className="text-gray-400 text-sm mt-1">This contract looks good!</p>
                </div>
              ) : (
                riskyClausesList.map((clause, idx) => (
                  <div
                    key={idx}
                    className={cn(
                      'border rounded-xl p-4 space-y-3',
                      clause.riskLevel === 'high' || clause.riskLevel === 'critical'
                        ? 'border-red-200 bg-red-50/50'
                        : 'border-orange-200 bg-orange-50/50'
                    )}
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={cn(
                        'w-2.5 h-2.5 rounded-full shrink-0',
                        clause.riskLevel === 'high' || clause.riskLevel === 'critical'
                          ? 'bg-red-500' : 'bg-orange-500'
                      )} />
                      <span className="font-semibold text-gray-800">{clause.title}</span>
                      <span className={cn(
                        'text-xs px-2 py-0.5 rounded-full font-medium uppercase',
                        clause.riskLevel === 'high' || clause.riskLevel === 'critical'
                          ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700'
                      )}>
                        {clause.riskLevel}
                      </span>
                    </div>

                    <div>
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Problem</p>
                      <p className="text-sm text-gray-700 leading-relaxed">{clause.legalText}</p>
                    </div>

                    <div className="bg-white rounded-lg p-3 border border-gray-200">
                      <p className="text-xs font-semibold text-green-700 uppercase tracking-wide mb-1">✅ Recommendation</p>
                      <p className="text-sm text-gray-700 leading-relaxed">{clause.simpleText}</p>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="p-5 border-t border-gray-100 shrink-0 flex gap-3">
              <button
                onClick={handleSaveContract}
                className="flex-1 py-2.5 border border-primary text-primary font-medium rounded-lg hover:bg-primary/5 transition flex items-center justify-center gap-2 text-sm"
              >
                <Download size={15} />
                Download Report
              </button>
              <button
                onClick={() => setShowFixModal(false)}
                className="flex-1 py-2.5 bg-[#1E3A8A] text-white font-medium rounded-lg hover:bg-blue-900 transition text-sm"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

const ClauseCard: React.FC<{ clause: DocumentClause }> = ({ clause }) => {
  const [isSimpleView, setIsSimpleView] = useState(true);
  const [isOpen, setIsOpen]             = useState(true);

  const getRiskColor = () => {
    switch (clause.riskLevel) {
      case 'critical': return 'bg-red-700';
      case 'high':     return 'bg-red-500';
      case 'medium':   return 'bg-orange-500';
      case 'low':      return 'bg-green-500';
      default:         return 'bg-gray-400';
    }
  };

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden bg-white shadow-sm transition-all">
      <button
        className="w-full px-5 py-3.5 flex items-center justify-between hover:bg-gray-50 transition"
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="flex items-center space-x-3">
          <span className={`w-2.5 h-2.5 rounded-full ${getRiskColor()} shadow-sm shrink-0`} />
          <span className="font-semibold text-gray-800 text-[15px] text-left">{clause.title}</span>
        </div>
        <span className="text-gray-400 text-xs ml-2 shrink-0">{isOpen ? '▲' : '▼'}</span>
      </button>

      {isOpen && (
        <div className="px-5 pb-5 pt-1">
          <div className="flex items-center space-x-1 p-1 bg-gray-100/80 rounded-lg w-fit mb-4 mt-2">
            <button
              className={cn(
                'px-4 py-1.5 text-xs font-semibold rounded-md transition-all',
                isSimpleView ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              )}
              onClick={() => setIsSimpleView(true)}
            >
              Simple English
            </button>
            <button
              className={cn(
                'px-4 py-1.5 text-xs font-semibold rounded-md transition-all',
                !isSimpleView ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              )}
              onClick={() => setIsSimpleView(false)}
            >
              Legal Text
            </button>
          </div>

          <p className={cn(
            'text-[14.5px] leading-relaxed transition-all whitespace-pre-line',
            isSimpleView
              ? 'text-gray-800 font-sans'
              : 'text-gray-600 font-serif italic border-l-2 border-gray-200 pl-4 py-1'
          )}>
            {isSimpleView ? clause.simpleText : clause.legalText}
          </p>
        </div>
      )}
    </div>
  );
};