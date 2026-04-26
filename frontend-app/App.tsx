import "./global.css";
import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, SafeAreaView, KeyboardAvoidingView, Platform, Modal, Image } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { AiAnalysisBubble } from './components/AiAnalysisBubble';

export default function App() {
  const [messages, setMessages] = useState<any[]>([]);
  const [inputText, setInputText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);

  const quickPrompts = [
    'Summarize this contract',
    'What are the highest risks?',
    'Tell me about termination clauses',
    'Is the rent penalty fair?'
  ];

  const API_BASE = Platform.OS === 'android' ? 'http://10.0.2.2:3000' : 'http://localhost:3000';

  const sendMessage = async () => {
    if (!inputText.trim()) return;
    const currentInput = inputText;
    setMessages(prev => [...prev, { sender: "user", text: currentInput }]);
    setInputText("");
    setIsLoading(true);

    try {
      const response = await fetch(`${API_BASE}/api/analyze-document/`, {
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
          riskScore: data.bias_score || 50,
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

      setMessages(prev => [...prev, ...newMessages]);
    } catch (err: any) {
      setMessages(prev => [...prev, { sender: "ai", text: err.message || "Error connecting to the backend server. Make sure it is running." }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleFilePick = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const file = result.assets[0];
        const kbSize = file.size ? (file.size / 1024).toFixed(1) : 'Unknown';
        
        setMessages(prev => [...prev, { sender: 'user', text: `📎 Attached Document: ${file.name}\n(Size: ${kbSize} KB)` }]);
        setIsLoading(true);
        
        const base64String = await FileSystem.readAsStringAsync(file.uri, { encoding: 'base64' });
        const extension = file.name.split('.').pop() || '*';

        try {
          const response = await fetch(`${API_BASE}/api/upload/`, {
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
          setMessages(prev => [...prev, { sender: 'ai', text: err.message || 'Error uploading document to backend.' }]);
        } finally {
          setIsLoading(false);
        }
      }
    } catch (err) {
      console.error(err);
      setIsLoading(false);
    }
  };

  const addDemoAnalysis = () => {
    setMessages(prev => [
      ...prev,
      {
        sender: 'ai',
        type: 'analysis',
        riskScore: 82,
        clauses: [
          {
            title: "Rent & Late Fees",
            legalText: "The Lessee shall remit the monthly rent of ₹15,000 on or before the 5th day of each calendar month. A penal interest of 18% per annum shall be levied on delayed payments.",
            simpleText: "You must pay ₹15,000 by the 5th of every month. If you are late, you will be charged a high penalty.",
            riskLevel: "high"
          },
          {
            title: "Maintenance",
            legalText: "The Lessee covenants to keep the demised premises in good tenantable repair, fair wear and tear excepted.",
            simpleText: "You must keep the house clean, but not normal aging.",
            riskLevel: "low"
          }
        ]
      }
    ]);
  };

  return (
    <View className="flex-1 bg-gray-100">
      <SafeAreaView className="flex-1 bg-[#F5F5F7] w-full sm:max-w-md sm:mx-auto sm:my-8 sm:rounded-3xl sm:shadow-2xl overflow-hidden sm:border sm:border-gray-300">
        <View className="h-14 bg-primary flex-row items-center justify-between px-4 shadow-sm z-10">
        <View className="flex-row items-center">
          <Text className="text-white text-lg font-bold ml-2">Nyaya-Mitra</Text>
        </View>
        <View className="flex-row items-center">
          <TouchableOpacity onPress={() => setMessages([])} className="mr-4">
            <Text className="text-white/80 font-medium">Clear</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setShowAuthModal(true)}>
            {isLoggedIn ? (
              <Image source={{ uri: "https://i.pravatar.cc/150?img=68" }} className="w-8 h-8 rounded-full border-2 border-secondary" />
            ) : (
              <View className="w-8 h-8 rounded-full border-2 border-white/50 items-center justify-center">
                <Text className="text-white text-xs">Profile</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>
      </View>
      
      {/* Auth Modal */}
      <Modal
        visible={showAuthModal}
        transparent={true}
        animationType="fade"
      >
        <TouchableOpacity 
          className="flex-1 bg-black/40 justify-center items-center" 
          activeOpacity={1} 
          onPress={() => setShowAuthModal(false)}
        >
          <TouchableOpacity 
            activeOpacity={1} 
            className="w-[80%] bg-white rounded-2xl p-6 items-center shadow-lg"
          >
            {isLoggedIn ? (
              <>
                <Image source={{ uri: "https://i.pravatar.cc/150?img=68" }} className="w-20 h-20 rounded-full mb-4" />
                <Text className="text-lg font-bold text-gray-800 text-center mb-6">Welcome back, User!</Text>
                <TouchableOpacity 
                  className="bg-red-500 w-full py-3 rounded-xl items-center shadow-sm"
                  onPress={() => { setIsLoggedIn(false); setShowAuthModal(false); }}
                >
                  <Text className="text-white font-bold text-base">Sign Out</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <View className="w-16 h-16 bg-primary/10 rounded-full mb-3 items-center justify-center">
                  <Text className="text-2xl">👤</Text>
                </View>
                <Text className="text-sm font-medium text-gray-800 text-center mb-4">
                  Sign in to save your documents and history.
                </Text>

                <View className="w-full mb-4 space-y-3">
                  <TextInput
                    placeholder="Email"
                    className="w-full bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 text-base"
                    keyboardType="email-address"
                    autoCapitalize="none"
                  />
                  <TextInput
                    placeholder="Password"
                    className="w-full bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 text-base mt-2"
                    secureTextEntry
                  />
                  <TouchableOpacity 
                    className="bg-primary w-full py-3 rounded-xl items-center shadow-sm mt-3"
                    onPress={() => { setIsLoggedIn(true); setShowAuthModal(false); }}
                  >
                    <Text className="text-white font-bold text-base">Log In</Text>
                  </TouchableOpacity>
                </View>

                <View className="flex-row items-center w-full mb-4">
                  <View className="flex-1 h-px bg-gray-200" />
                  <Text className="text-xs text-gray-400 px-2 font-bold">OR</Text>
                  <View className="flex-1 h-px bg-gray-200" />
                </View>

                <TouchableOpacity 
                  className="bg-white border border-gray-300 w-full py-3 rounded-xl flex-row items-center justify-center shadow-sm"
                  onPress={() => { setIsLoggedIn(true); setShowAuthModal(false); }}
                >
                  <Text className="text-lg mr-2 font-bold text-[#4285F4]">G</Text>
                  <Text className="text-gray-700 font-bold text-base">Sign In with Google</Text>
                </TouchableOpacity>
              </>
            )}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <KeyboardAvoidingView 
        className="flex-1" 
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView className="flex-1 px-4 pt-2">
          {messages.length === 0 ? (
            <View className="flex-1 items-center justify-center mt-12 mb-10">
              <View className="bg-primary/10 w-20 h-20 rounded-full mb-4 items-center justify-center">
                <Text className="text-3xl">⚖️</Text>
              </View>
              <Text className="text-2xl font-bold text-gray-800">Welcome</Text>
              <Text className="text-gray-500 text-center mt-2 px-6">
                Upload a legal document to analyze it, or ask a question.
              </Text>

              <View className="flex-row flex-wrap justify-center gap-2 mt-8">
                {quickPrompts.map((prompt, i) => (
                  <TouchableOpacity 
                    key={i}
                    onPress={() => setInputText(prompt)}
                    className="px-4 py-2 bg-secondary/30 rounded-full"
                  >
                    <Text className="text-primary text-xs font-semibold">{prompt}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <TouchableOpacity 
                onPress={addDemoAnalysis}
                className="mt-8 border border-primary px-5 py-3 rounded-xl flex-row items-center"
              >
                <Text className="text-primary font-bold">✨ Show Demo Analysis</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View className="pb-4">
              {messages.map((msg, idx) => {
                if (msg.type === "analysis") {
                  return <AiAnalysisBubble key={idx} clauses={msg.clauses || []} riskScore={msg.riskScore || 0} />;
                }
                return (
                  <View 
                    key={idx} 
                    className={`p-3 rounded-2xl max-w-[80%] my-1.5 shadow-sm ${msg.sender === "user" ? "bg-primary self-end rounded-br-sm" : "bg-white self-start border border-gray-200 rounded-bl-sm"}`}
                  >
                    {msg.text?.split('\n').map((paragraph: string, pIdx: number) => (
                      <Text key={pIdx} className={`text-[15px] ${msg.sender === "user" ? "text-white" : "text-gray-800"} ${pIdx > 0 ? 'mt-1.5' : ''}`}>
                        {paragraph}
                      </Text>
                    ))}
                  </View>
                );
              })}
              {isLoading && <Text className="text-gray-400 text-xs my-2 italic">Analyzing...</Text>}
            </View>
          )}
        </ScrollView>

        <View className="p-3 bg-white shadow-md flex-row items-center border-t border-gray-200">
          <TouchableOpacity className="p-2 mr-1" onPress={handleFilePick}>
            <Text className="text-primary text-xl pl-1 pr-2">📎</Text>
          </TouchableOpacity>
          <TextInput
            className="flex-1 bg-gray-100 rounded-full px-4 py-2.5 mr-2 text-[15px] text-gray-800"
            placeholder="Type a query..."
            value={inputText}
            onChangeText={setInputText}
            onSubmitEditing={sendMessage}
          />
          <TouchableOpacity 
            className="bg-primary w-10 h-10 rounded-full items-center justify-center shadow-sm"
            onPress={sendMessage}
          >
            <Text className="text-white text-lg font-bold">↑</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}
