from django.urls import path
from . import views

urlpatterns = [
    path('analyze-document/', views.analyze_document, name='analyze_document'),
    path('upload/', views.upload_document, name='upload_document'),
]
