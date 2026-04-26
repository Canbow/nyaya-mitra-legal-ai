import hashlib
import json
import os
import google.generativeai as genai
from dotenv import load_dotenv
from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response
from pgvector.django import CosineDistance
from .models import AnalysisReport, KnowledgeBaseLaw

# Load environment variables
load_dotenv()

# Configure Gemini
api_key = os.environ.get("GEMINI_API_KEY")
if api_key:
    genai.configure(api_key=api_key)

def get_rag_context(text):
    try:
        if not text.strip(): return ""
        response = genai.embed_content(
            model="models/gemini-embedding-001",
            content=text[:10000],  # Embed up to 10k chars directly
            task_type="retrieval_query"
        )
        user_emb = response['embedding']
        
        laws = KnowledgeBaseLaw.objects.order_by(CosineDistance('embedding', user_emb))[:4]
        retrieved_laws = [f"[{law.source_act}]: {law.clause_text}" for law in laws]
        return "\n".join(retrieved_laws)
    except Exception as e:
        print(f"RAG Error: {e}")
        return ""

def call_gemini_api(document_text):
    """
    Call the actual Gemini API.
    """
    try:
        context = get_rag_context(document_text)
        model = genai.GenerativeModel('gemini-2.5-flash')
        prompt = f"""
You are an AI legal assistant. The user has provided an input which may be a legal document or a general legal query/question.
Input: {document_text}

Official Law Context Retrieved:
{context}

If the input is a legal document:
1. Extract a bias_score from 0 to 100 (where 100 is extremely biased/unfair) judged strictly against the Official Law Context.
2. Provide a summary_text of the document.
3. Provide a list of red_flags, where each red flag has a 'clause' name and a 'reason' why it is unfair.

If the input is a question or general query:
1. Provide a bias_score of 0.
2. Provide the detailed answer to the query in the 'summary_text'.
3. Leave 'red_flags' as an empty list [].

Return ONLY a raw JSON object with this exact structure, nothing else:
{{
    "bias_score": <int>,
    "summary_text": "<string>",
    "red_flags": [
        {{"clause": "<string>", "reason": "<string>"}}
    ]
}}
"""
        response = model.generate_content(prompt)
        text = response.text.strip()
        
        # Clean up markdown code block syntax if present
        if text.startswith("```json"):
            text = text[7:]
        elif text.startswith("```"):
            text = text[3:]
        if text.endswith("```"):
            text = text[:-3]
        text = text.strip()
        
        parsed_data = json.loads(text)
        return {
            "bias_score": parsed_data.get("bias_score", 0),
            "summary_text": parsed_data.get("summary_text", ""),
            "red_flags": parsed_data.get("red_flags", [])
        }
    except Exception as e:
        print(f"Error calling Gemini: {e}")
        raise e

@api_view(['POST'])
def analyze_document(request):
    try:
        # Step A: Extract document_text
        document_text = request.data.get('document_text', '')
        if isinstance(document_text, str):
            document_text = document_text.strip()
        
        # Step B: Pre-Validation
        if not document_text:
            return Response(
                {"error": "Invalid input: 'document_text' must be provided."},
                status=status.HTTP_400_BAD_REQUEST
            )
            
        # Step C: Hashing
        # Create a SHA-256 hash of the document_text to use as an exact-match cache key
        document_hash = hashlib.sha256(document_text.encode('utf-8')).hexdigest()
        
        # Step D: Cache Check
        try:
            # Step E: Cache Hit
            report = AnalysisReport.objects.get(document_hash=document_hash)
            
            return Response({
                "source": "database_cache",
                "bias_score": report.bias_score,
                "summary_text": report.summary_text,
                "red_flags": report.red_flags
            }, status=status.HTTP_200_OK)
            
        except AnalysisReport.DoesNotExist:
            # Step F: Cache Miss & API Call
            ai_data = call_gemini_api(document_text)
            
            # Step G: Save to DB & Return
            report = AnalysisReport.objects.create(
                document_hash=document_hash,
                bias_score=ai_data.get('bias_score', 0),
                summary_text=ai_data.get('summary_text', ''),
                red_flags=ai_data.get('red_flags', [])
            )
            
            return Response({
                "source": "ai_api",
                "bias_score": report.bias_score,
                "summary_text": report.summary_text,
                "red_flags": report.red_flags
            }, status=status.HTTP_201_CREATED)
            
    except Exception as e:
        # Catch unexpected errors to prevent the app from crashing
        return Response(
            {"error": f"An internal server error occurred: {str(e)}"},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR
        )

import base64

def call_gemini_vision_api(base64_data, mime_type, text_context=""):
    """
    Call Gemini using multi-modal capabilities for PDF/image uploads.
    """
    try:
        context = get_rag_context(text_context) if text_context else "No text extracted for context prior to analysis."
        model = genai.GenerativeModel('gemini-2.5-flash')
        prompt = f"""
Analyze the following legal document and extract:
1. A bias_score from 0 to 100 (where 100 is extremely biased/unfair). Use the official law context provided below to judge fairness.
2. A summary_text of the document.
3. A list of red_flags, where each red flag has a 'clause' name and a 'reason' why it's unfair based on the official laws.

Official Law Context Retrieved:
{context}

Return ONLY a raw JSON object with this exact structure, nothing else:
{
    "bias_score": <int>,
    "summary_text": "<string>",
    "red_flags": [
        {"clause": "<string>", "reason": "<string>"}
    ]
}
"""
        doc_part = {
            'mime_type': mime_type,
            'data': base64.b64decode(base64_data)
        }
        response = model.generate_content([prompt, doc_part])
        text = response.text.strip()
        
        # Clean up markdown code block syntax if present
        if text.startswith("```json"):
            text = text[7:]
        elif text.startswith("```"):
            text = text[3:]
        if text.endswith("```"):
            text = text[:-3]
        text = text.strip()
        
        parsed_data = json.loads(text)
        return {
            "bias_score": parsed_data.get("bias_score", 0),
            "summary_text": parsed_data.get("summary_text", ""),
            "red_flags": parsed_data.get("red_flags", [])
        }
    except Exception as e:
        print(f"Error calling Gemini Vision: {e}")
        raise e

@api_view(['POST'])
def upload_document(request):
    try:
        fileType = request.data.get('fileType', '*').lower()
        contentBase64 = request.data.get('contentBase64', '')

        if not contentBase64:
            return Response(
                {"error": "Invalid input: 'contentBase64' must be provided."},
                status=status.HTTP_400_BAD_REQUEST
            )
            
        file_hash = hashlib.sha256(contentBase64.encode('utf-8')).hexdigest()
        
        mime_type = "application/pdf"
        if fileType in ['jpg', 'jpeg']:
            mime_type = "image/jpeg"
        elif fileType == 'png':
            mime_type = "image/png"
        
        try:
            report = AnalysisReport.objects.get(document_hash=file_hash)
            return Response({
                "source": "database_cache",
                "riskScore": report.bias_score,
                "summary": report.summary_text,
                "clauses": [{"title": r.get('clause'), "simpleText": r.get('reason'), "riskLevel": "high"} for r in report.red_flags]
            }, status=status.HTTP_200_OK)
            
        except AnalysisReport.DoesNotExist:
            ai_data = call_gemini_vision_api(contentBase64, mime_type)
            
            report = AnalysisReport.objects.create(
                document_hash=file_hash,
                bias_score=ai_data.get('bias_score', 0),
                summary_text=ai_data.get('summary_text', ''),
                red_flags=ai_data.get('red_flags', [])
            )
            
            return Response({
                "source": "ai_api",
                "riskScore": report.bias_score,
                "summary": report.summary_text,
                "clauses": [{"title": r.get('clause'), "simpleText": r.get('reason'), "riskLevel": "high"} for r in report.red_flags]
            }, status=status.HTTP_200_OK)
            
    except Exception as e:
        return Response(
            {"error": f"An internal server error occurred: {str(e)}"},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR
        )
