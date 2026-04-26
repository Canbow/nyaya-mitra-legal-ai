from django.db import models
from pgvector.django import VectorField

class KnowledgeBaseLaw(models.Model):
    source_act = models.CharField(max_length=255, default="Model Tenancy Act 2021", help_text="Source of the law")
    clause_text = models.TextField(help_text="The actual text of the law clause")
    embedding = VectorField(dimensions=3072, help_text="Gemini text-embedding-004 representation")

    def __str__(self):
        return f"{self.source_act} Clause: {self.clause_text[:30]}..."

class Document(models.Model):
    user_id = models.CharField(max_length=255, help_text="ID of the user who uploaded the document")
    file_url = models.URLField(max_length=1000, help_text="URL where the document file is stored")
    upload_date = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"Document(user_id={self.user_id}, id={self.id})"

class AnalysisReport(models.Model):
    document_hash = models.CharField(
        max_length=64, 
        unique=True, 
        db_index=True,
        help_text="SHA-256 hash of the document text"
    )
    bias_score = models.IntegerField()
    summary_text = models.TextField()
    red_flags = models.JSONField()

    def __str__(self):
        return f"AnalysisReport(hash={self.document_hash[:8]}...)"
