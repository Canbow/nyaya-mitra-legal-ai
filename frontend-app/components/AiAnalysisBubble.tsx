import React, { useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';

export interface DocumentClause {
  title: string;
  legalText: string;
  simpleText: string;
  riskLevel: 'high' | 'medium' | 'low';
}

interface Props {
  clauses: DocumentClause[];
  riskScore: number;
}

export const AiAnalysisBubble: React.FC<Props> = ({ clauses, riskScore }) => {
  const isHighRisk = riskScore >= 70;
  const isMediumRisk = riskScore >= 30 && riskScore < 70;
  
  const getTheme = () => {
    if (isHighRisk) return { bg: 'bg-red-50', text: 'text-red-700', bar: 'bg-red-500', title: 'High Risk Contract Detected' };
    if (isMediumRisk) return { bg: 'bg-orange-50', text: 'text-orange-700', bar: 'bg-orange-500', title: 'Moderate Risk Contract Detected' };
    return { bg: 'bg-green-50', text: 'text-green-700', bar: 'bg-green-500', title: 'Contract looks healthy' };
  };
  
  const theme = getTheme();

  return (
    <View className="bg-white rounded-2xl w-full my-2 border border-gray-200 overflow-hidden shadow-sm">
      {/* Header section */}
      <View className={`p-4 ${theme.bg}`}>
        <View className="flex-row items-center justify-between mb-3">
          <Text className={`font-bold text-base flex-1 ${theme.text}`}>
            {theme.title}
          </Text>
          <View className={`px-3 py-1 rounded-full bg-white/60 ml-2`}>
            <Text className={`font-bold text-xs ${theme.text}`}>
              {riskScore}% Risk
            </Text>
          </View>
        </View>

        <View className="bg-white/50 h-2 w-full rounded-full overflow-hidden">
          <View 
            className={`h-full rounded-full ${theme.bar}`} 
            style={{ width: `${riskScore}%` }} 
          />
        </View>

        <Text className="text-gray-700 mt-2 text-xs font-medium">
          {clauses.length} clauses analyzed
        </Text>
      </View>

      <View className="px-4 py-3 bg-gray-50 border-b border-gray-100">
        <Text className="text-gray-600 text-xs">
          Summary of key clauses. Expand to read simple or legal text.
        </Text>
      </View>

      <View className="p-3">
        {clauses.map((c, i) => (
          <ClauseCard key={i} clause={c} />
        ))}
      </View>
      
      <View className="p-4 pt-1 flex-row">
        <TouchableOpacity className="flex-1 p-2 border border-primary rounded-lg items-center mr-2">
          <Text className="text-primary font-medium">Save</Text>
        </TouchableOpacity>
        <TouchableOpacity className="flex-1 p-2 bg-[#1E3A8A] rounded-lg items-center">
          <Text className="text-white font-medium">How to Fix</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const ClauseCard = ({ clause }: { clause: DocumentClause }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isSimpleView, setIsSimpleView] = useState(true);

  const getRiskColor = () => {
    switch (clause.riskLevel) {
      case 'high': return 'bg-red-500';
      case 'medium': return 'bg-orange-500';
      case 'low': return 'bg-green-500';
      default: return 'bg-gray-500';
    }
  };

  return (
    <View className="border border-gray-200 rounded-xl mb-3 overflow-hidden bg-white">
      <TouchableOpacity 
        className="p-3 flex-row items-center justify-between"
        onPress={() => setIsOpen(!isOpen)}
        activeOpacity={0.7}
      >
        <View className="flex-row items-center flex-1 pr-2">
          <View className={`w-2 h-2 rounded-full ${getRiskColor()} mr-2`} />
          <Text className="font-semibold text-gray-800 flex-shrink">{clause.title}</Text>
        </View>
        <Text className="text-gray-400">{isOpen ? "▲" : "▼"}</Text>
      </TouchableOpacity>

      {isOpen && (
        <View className="px-3 pb-4 pt-1">
          <View className="flex-row bg-gray-100 rounded-md p-1 mb-3">
            <TouchableOpacity 
              className={`flex-1 py-1 items-center rounded ${isSimpleView ? 'bg-white shadow-sm' : ''}`}
              onPress={() => setIsSimpleView(true)}
            >
              <Text className={`text-xs ${isSimpleView ? 'font-bold text-gray-800' : 'text-gray-500'}`}>Simple</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              className={`flex-1 py-1 items-center rounded ${!isSimpleView ? 'bg-white shadow-sm' : ''}`}
              onPress={() => setIsSimpleView(false)}
            >
              <Text className={`text-xs ${!isSimpleView ? 'font-bold text-gray-800' : 'text-gray-500'}`}>Legal</Text>
            </TouchableOpacity>
          </View>
          <Text className={`text-[13px] ${isSimpleView ? 'text-gray-800' : 'text-gray-500 pl-2 border-l-2 border-gray-200'}`}>
            {isSimpleView ? clause.simpleText : clause.legalText}
          </Text>
        </View>
      )}
    </View>
  );
};
