import os
import google.generativeai as genai
from django.core.management.base import BaseCommand
from document_analysis.models import KnowledgeBaseLaw

class Command(BaseCommand):
    help = 'Loads and embeds the Model Tenancy Act clauses into the pgvector database.'

    def handle(self, *args, **kwargs):
        api_key = os.environ.get("GEMINI_API_KEY")
        if not api_key:
            self.stdout.write(self.style.ERROR("GEMINI_API_KEY is not set."))
            return
            
        genai.configure(api_key=api_key)
        
        sample_laws = [
            "The landlord must provide a 30-day notice before terminating the lease without cause.",
            "The tenant is responsible for minor repairs and maintenance of the premises.",
            "Security deposit cannot exceed an amount equivalent to two months of rent.",
            "The landlord is responsible for structural repairs and external painting.",
            "Any late payment of rent can incur a maximum penalty of 8% per annum.",
            "The landlord cannot withhold essential services like water or electricity.",
            "Rent can only be increased if there is a prior written agreement allowing it."
        ]
        
        self.stdout.write("Embedding laws using gemini-embedding-001...")
        for clause in sample_laws:
            if not KnowledgeBaseLaw.objects.filter(clause_text=clause).exists():
                response = genai.embed_content(
                    model="models/gemini-embedding-001", 
                    content=clause,
                    task_type="retrieval_document"
                )
                embedding = response['embedding']
                
                KnowledgeBaseLaw.objects.create(
                    source_act="Model Tenancy Act 2021",
                    clause_text=clause,
                    embedding=embedding
                )
                self.stdout.write(self.style.SUCCESS(f"Saved: {clause[:30]}..."))
            else:
                self.stdout.write(self.style.WARNING(f"Skipped existing: {clause[:30]}..."))
                
        self.stdout.write(self.style.SUCCESS('Successfully loaded knowledge base!'))
