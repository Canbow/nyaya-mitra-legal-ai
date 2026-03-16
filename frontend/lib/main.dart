import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'dart:convert';
import 'package:file_picker/file_picker.dart'; // New import for attachments

void main() {
  runApp(const NyayaMitraApp());
}

class NyayaMitraApp extends StatelessWidget {
  const NyayaMitraApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Nyaya-Mitra',
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF4A148C),
          primary: const Color(0xFF4A148C),
          secondary: const Color(0xFFE1BEE7),
        ),
        useMaterial3: true,
        fontFamily: 'Roboto',
      ),
      home: const ChatScreen(),
      debugShowCheckedModeBanner: false,
    );
  }
}

class ChatScreen extends StatefulWidget {
  const ChatScreen({super.key});

  @override
  State<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends State<ChatScreen> {
  final TextEditingController _controller = TextEditingController();
  final List<Map<String, String>> _messages = [];
  bool _isLoading = false;
  bool _isLoggedIn = false; // Track Auth state

  // --- FILE UPLOAD FUNCTIONALITY ---
  Future<void> _pickFile() async {
    try {
      // Opens the device gallery/folder allowing specific formats
      FilePickerResult? result = await FilePicker.platform.pickFiles(
        type: FileType.custom,
        allowedExtensions: ['jpg', 'jpeg', 'png', 'pdf', 'doc', 'docx'],
      );

      if (result != null) {
        PlatformFile file = result.files.first;
        
        setState(() {
          // Add the file upload message to the chat UI
          _messages.add({
            "sender": "user", 
            "text": "📎 Attached Document: ${file.name}\n(Size: ${(file.size / 1024).toStringAsFixed(1)} KB)"
          });
        });

        // NOTE: In the next phase, we will send this 'file.bytes' to the Node.js backend for OCR/AI analysis!
      }
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Error picking file: $e')),
      );
    }
  }

  // --- SEND MESSAGE FUNCTIONALITY ---
  Future<void> _sendMessage() async {
    String userText = _controller.text.trim();
    if (userText.isEmpty) return;

    setState(() {
      _messages.add({"sender": "user", "text": userText});
      _isLoading = true;
    });
    _controller.clear();

    try {
      final response = await http.post(
        Uri.parse('http://localhost:3000/api/chat'),
        headers: {"Content-Type": "application/json"},
        body: jsonEncode({"question": userText}),
      );

      if (response.statusCode == 200) {
        final data = jsonDecode(response.body);
        setState(() {
          _messages.add({"sender": "ai", "text": data['answer']});
        });
      } else {
        setState(() {
          _messages.add({"sender": "ai", "text": "Server Error ${response.statusCode}: Please check backend."});
        });
      }
    } catch (e) {
      setState(() {
        _messages.add({"sender": "ai", "text": "Network Error: Cannot reach the Node.js server."});
      });
    } finally {
      setState(() {
        _isLoading = false;
      });
    }
  }

  // --- AUTHENTICATION MOCK DIALOG ---
  void _showAuthDialog() {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(_isLoggedIn ? 'User Profile' : 'Sign In'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            CircleAvatar(
              radius: 40,
              backgroundColor: Colors.deepPurple[100],
              backgroundImage: _isLoggedIn 
                  ? const NetworkImage('https://i.pravatar.cc/150?img=68') // Mock Profile Pic
                  : null,
              child: _isLoggedIn ? null : const Icon(Icons.person, size: 40, color: Colors.deepPurple),
            ),
            const SizedBox(height: 16),
            Text(_isLoggedIn ? 'Welcome back, User!' : 'Please sign in to save your legal documents and chat history.'),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF4A148C), foregroundColor: Colors.white),
            onPressed: () {
              setState(() {
                _isLoggedIn = !_isLoggedIn; // Toggle login state
              });
              Navigator.pop(context);
            },
            child: Text(_isLoggedIn ? 'Sign Out' : 'Sign In with Google'),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF5F5F7),
      appBar: AppBar(
        elevation: 2,
        shadowColor: Colors.black26,
        leading: const Icon(Icons.balance, color: Colors.white),
        title: const Text(
          'Nyaya-Mitra',
          style: TextStyle(fontWeight: FontWeight.bold, color: Colors.white, letterSpacing: 1.2),
        ),
        backgroundColor: const Color(0xFF4A148C),
        actions: [
          // PROFILE PICTURE / AUTH BUTTON
          Padding(
            padding: const EdgeInsets.only(right: 12.0),
            child: GestureDetector(
              onTap: _showAuthDialog,
              child: CircleAvatar(
                radius: 18,
                backgroundColor: Colors.white24,
                backgroundImage: _isLoggedIn 
                    ? const NetworkImage('https://i.pravatar.cc/150?img=68') // Show pic if logged in
                    : null,
                child: _isLoggedIn ? null : const Icon(Icons.person_outline, color: Colors.white),
              ),
            ),
          )
        ],
      ),
      body: Column(
        children: [
          if (_messages.isEmpty)
            Expanded(
              child: Center(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(Icons.gavel_rounded, size: 80, color: Colors.deepPurple.withOpacity(0.5)),
                    const SizedBox(height: 20),
                    const Text(
                      "Welcome to Nyaya-Mitra",
                      style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold, color: Colors.black87),
                    ),
                    const SizedBox(height: 10),
                    const Text(
                      "Upload a contract or ask a legal question.",
                      textAlign: TextAlign.center,
                      style: TextStyle(fontSize: 16, color: Colors.black54),
                    ),
                  ],
                ),
              ),
            )
          else
            Expanded(
              child: ListView.builder(
                padding: const EdgeInsets.all(20),
                itemCount: _messages.length,
                itemBuilder: (context, index) {
                  final msg = _messages[index];
                  final isUser = msg["sender"] == "user";
                  return Align(
                    alignment: isUser ? Alignment.centerRight : Alignment.centerLeft,
                    child: Container(
                      margin: const EdgeInsets.only(bottom: 16),
                      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
                      constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.75),
                      decoration: BoxDecoration(
                        color: isUser ? const Color(0xFF4A148C) : Colors.white,
                        borderRadius: BorderRadius.only(
                          topLeft: const Radius.circular(20),
                          topRight: const Radius.circular(20),
                          bottomLeft: Radius.circular(isUser ? 20 : 0),
                          bottomRight: Radius.circular(isUser ? 0 : 20),
                        ),
                        boxShadow: [
                          BoxShadow(color: Colors.black.withOpacity(0.05), blurRadius: 5, offset: const Offset(0, 2))
                        ],
                      ),
                      child: Text(
                        msg["text"]!,
                        style: TextStyle(fontSize: 16, height: 1.4, color: isUser ? Colors.white : Colors.black87),
                      ),
                    ),
                  );
                },
              ),
            ),
          
          if (_isLoading)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 10.0),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2)),
                  SizedBox(width: 10),
                  Text("Analyzing...", style: TextStyle(color: Colors.grey)),
                ],
              ),
            ),

          // --- CHAT INPUT AREA WITH ATTACHMENT ICON ---
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
            decoration: BoxDecoration(
              color: Colors.white,
              boxShadow: [BoxShadow(color: Colors.black.withOpacity(0.05), blurRadius: 10, offset: const Offset(0, -2))],
            ),
            child: Row(
              children: [
                // THE "+" ATTACHMENT BUTTON
                IconButton(
                  icon: const Icon(Icons.add_circle_outline, color: Color(0xFF4A148C), size: 28),
                  onPressed: _pickFile,
                  tooltip: 'Upload Document or Image',
                ),
                Expanded(
                  child: TextField(
                    controller: _controller,
                    maxLines: null,
                    textInputAction: TextInputAction.send,
                    onSubmitted: (value) => _sendMessage(),
                    decoration: InputDecoration(
                      hintText: 'Type a query or attach a file...',
                      hintStyle: TextStyle(color: Colors.grey[400]),
                      filled: true,
                      fillColor: const Color(0xFFF5F5F7),
                      contentPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
                      border: OutlineInputBorder(borderRadius: BorderRadius.circular(30), borderSide: BorderSide.none),
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                Container(
                  decoration: const BoxDecoration(color: Color(0xFF4A148C), shape: BoxShape.circle),
                  child: IconButton(
                    icon: const Icon(Icons.send_rounded, color: Colors.white),
                    onPressed: _sendMessage,
                  ),
                )
              ],
            ),
          )
        ],
      ),
    );
  }
}