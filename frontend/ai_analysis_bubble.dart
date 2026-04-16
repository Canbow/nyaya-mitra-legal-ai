import 'package:flutter/material.dart';

// --- Data Models ---
enum RiskLevel { high, medium, low }

class DocumentClause {
  final String title;
  final String legalText;
  final String simpleText;
  final RiskLevel riskLevel;

  DocumentClause({
    required this.title,
    required this.legalText,
    required this.simpleText,
    required this.riskLevel,
  });
}

// --- Main Chat Bubble Widget ---
class AiAnalysisBubble extends StatelessWidget {
  final List<DocumentClause> clauses;
  final int riskScore; // 0 to 100

  const AiAnalysisBubble({
    Key? key,
    required this.clauses,
    required this.riskScore,
  }) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.symmetric(vertical: 10.0, horizontal: 16.0),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.05),
            blurRadius: 10,
            offset: const Offset(0, 4),
          ),
        ],
        border: Border.all(color: Colors.grey.shade200),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // 1. The Legal Health Dashboard Header
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: riskScore > 70 ? Colors.red.shade50 : Colors.blue.shade50,
              borderRadius: const BorderRadius.only(
                topLeft: Radius.circular(16),
                topRight: Radius.circular(16),
              ),
            ),
            child: Row(
              children: [
                Icon(
                  riskScore > 70 ? Icons.warning_rounded : Icons.check_circle,
                  color: riskScore > 70 ? Colors.red.shade700 : Colors.green.shade700,
                ),
                const SizedBox(width: 10),
                Text(
                  riskScore > 70 ? "High Risk Contract Detected" : "Standard Contract",
                  style: const TextStyle(
                    fontWeight: FontWeight.bold,
                    fontSize: 16,
                  ),
                ),
              ],
            ),
          ),
          
          const Padding(
            padding: EdgeInsets.fromLTRB(16, 16, 16, 8),
            child: Text(
              "Here is the breakdown of your document. Tap on any clause to see the original legal text.",
              style: TextStyle(color: Colors.black87, fontSize: 14),
            ),
          ),

          // 2. The Interactive Clause List
          ListView.builder(
            physics: const NeverScrollableScrollPhysics(),
            shrinkWrap: true,
            itemCount: clauses.length,
            itemBuilder: (context, index) {
              return ClauseCard(clause: clauses[index]);
            },
          ),
          
          // 3. Action Buttons (Next Steps)
          Padding(
            padding: const EdgeInsets.all(16.0),
            child: Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: () {
                      // Trigger Audio TTS
                    },
                    icon: const Icon(Icons.volume_up, size: 18),
                    label: const Text("Listen"),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: ElevatedButton(
                    onPressed: () {
                      // Ask Chatbot how to negotiate
                    },
                    style: ElevatedButton.styleFrom(
                      backgroundColor: const Color(0xFF1E3A8A), // Navy Blue
                      foregroundColor: Colors.white,
                    ),
                    child: const Text("How to Fix"),
                  ),
                ),
              ],
            ),
          )
        ],
      ),
    );
  }
}

// --- The Interactive Expandable Clause Card ---
class ClauseCard extends StatefulWidget {
  final DocumentClause clause;

  const ClauseCard({Key? key, required this.clause}) : super(key: key);

  @override
  State<ClauseCard> createState() => _ClauseCardState();
}

class _ClauseCardState extends State<ClauseCard> {
  bool isSimpleView = true; // Controls the Split-Reality Toggle

  Color getRiskColor() {
    switch (widget.clause.riskLevel) {
      case RiskLevel.high:
        return Colors.red.shade600;
      case RiskLevel.medium:
        return Colors.orange.shade600;
      case RiskLevel.low:
        return Colors.green.shade600;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
      elevation: 0,
      shape: RoundedRectangleBorder(
        side: BorderSide(color: Colors.grey.shade300),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Theme(
        data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
        child: ExpansionTile(
          tilePadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
          // Traffic Light Indicator
          leading: CircleAvatar(
            radius: 8,
            backgroundColor: getRiskColor(),
          ),
          title: Text(
            widget.clause.title,
            style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15),
          ),
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // The Split-Reality Toggle Switch
                  Container(
                    decoration: BoxDecoration(
                      color: Colors.grey.shade100,
                      borderRadius: BorderRadius.circular(8),
                    ),
                    padding: const EdgeInsets.all(4),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        _buildToggleButton("Simple English", true),
                        _buildToggleButton("Legal Text", false),
                      ],
                    ),
                  ),
                  const SizedBox(height: 12),
                  // The Text Display (Changes based on toggle)
                  Text(
                    isSimpleView ? widget.clause.simpleText : widget.clause.legalText,
                    style: TextStyle(
                      fontSize: 14,
                      color: isSimpleView ? Colors.black87 : Colors.black54,
                      fontFamily: isSimpleView ? 'Roboto' : 'Merriweather', // Serif for legal
                      fontStyle: isSimpleView ? FontStyle.normal : FontStyle.italic,
                    ),
                  ),
                ],
              ),
            )
          ],
        ),
      ),
    );
  }

  // Helper for the Toggle Buttons
  Widget _buildToggleButton(String text, bool isSimpleButton) {
    bool isActive = isSimpleView == isSimpleButton;
    return GestureDetector(
      onTap: () => setState(() => isSimpleView = isSimpleButton),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        decoration: BoxDecoration(
          color: isActive ? Colors.white : Colors.transparent,
          borderRadius: BorderRadius.circular(6),
          boxShadow: isActive
              ? [BoxShadow(color: Colors.black12, blurRadius: 4)]
              : [],
        ),
        child: Text(
          text,
          style: TextStyle(
            fontSize: 12,
            fontWeight: isActive ? FontWeight.bold : FontWeight.normal,
            color: isActive ? Colors.black87 : Colors.grey.shade600,
          ),
        ),
      ),
    );
  }
}