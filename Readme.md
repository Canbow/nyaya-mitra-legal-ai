# ⚖️ Nyaya-Mitra: Smart Legal Document Analyzer

![Flutter](https://img.shields.io/badge/Frontend-Flutter-02569B?style=flat&logo=flutter)
![Django](https://img.shields.io/badge/Backend-Django-092E20?style=flat&logo=django)
![PostgreSQL](https://img.shields.io/badge/Database-PostgreSQL-316192?style=flat&logo=postgresql)
![AI](https://img.shields.io/badge/AI_Engine-Gemini%20%2F%20Claude-8A2BE2?style=flat)

Nyaya-Mitra is an AI-powered LegalTech application designed to bridge the gap between complex legal jargon and the common person. It analyzes contracts (like rental agreements), detects potentially unfair clauses, and explains them in simple, 8th-grade English and regional Indian languages.

## ✨ Outstanding Features

* **🚩 Red Flag Detection System:** Automatically highlights and categorizes potentially unfair clauses with severity ratings (High/Medium/Low) based on consumer protection standards.
* **🧘‍♂️ Calm Tech UI ("Split-Reality Reader"):** A cognitive-load-reducing interface that allows users to seamlessly toggle between dense legal text and AI-simplified explanations line-by-line.
* **🛡️ Denial of Wallet (DoW) Protection:** Implements a Database-First Caching Layer. Document text is hashed via SHA-256 and checked against PostgreSQL before querying the LLM, reducing latency and saving API costs.
* **⚖️ Responsibility Matrix:** Automatically extracts and categorizes financial liabilities and duties for both parties (e.g., Landlord vs. Tenant) into a clean visual format.
* **🗣️ Vakil-Bot (Accessibility):** Features a built-in TTS (Text-to-Speech) engine to read simplified clauses aloud in regional languages (Hindi, Marathi, etc.).

---

## 📚 Academic Research Foundation

This project is not just an API wrapper; it is an implementation of frameworks proposed in recent (2024-2025) Legal NLP research:

| Research Paper | Core Finding Implemented in Nyaya-Mitra |
| :--- | :--- |
| **IL-TUR (ACL, 2024)** | Utilized multi-task learning prompting to handle Indian-specific legal terminologies (e.g., *Stamp Duty, Vakalatnama*) rather than relying on Western-trained default models. |
| **Lagioia (Springer, 2025)** | Implemented a zero-shot cross-lingual framework to detect unfair clauses, even when contracts contain broken English or "Hinglish". |
| **Tezel & Balali (MDPI, 2025)** | Adopted a Dynamic RAG approach to prevent AI hallucination, cross-referencing AI summaries with standard templates like the *Model Tenancy Act (2021)*. |
| **Al-Mhdawi et al. (2025)** | Integrated their proposed taxonomy for distinguishing between "passive risk" and "active responsibility" to power our Responsibility Matrix UI. |

---

## 🛠️ System Architecture & Tech Stack

### Frontend (Mobile/PWA)
* **Framework:** Flutter (Dart)
* **Design Philosophy:** Calm Tech, Progressive Disclosure

### Backend (REST API)
* **Framework:** Python / Django REST Framework
* **Database:** PostgreSQL (Schema includes `Users`, `Documents`, `AnalysisReports`, `RedFlags`)
* **Security:** Cryptographic Hashing for API call caching

### AI & Processing
* **Engine:** Gemini Pro / Claude API via LangChain
* **Pre-processing:** OCR (Tesseract / Cloud Vision) for scanned documents

---

## 🚀 Local Installation & Setup

### Prerequisites
* Python 3.10+
* Flutter SDK
* PostgreSQL installed and running locally
* Gemini or Claude API Key

### 1. Backend Setup (Django)
```bash
# Clone the repository
git clone [https://github.com/YourUsername/Nyaya-Mitra.git](https://github.com/YourUsername/Nyaya-Mitra.git)
cd Nyaya-Mitra/backend

# Create a virtual environment
python -m venv venv
source venv/bin/activate  # On Windows use: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Create a .env file (DO NOT commit this file)
echo "GEMINI_API_KEY=your_api_key_here" > .env
echo "DATABASE_URL=postgres://user:password@localhost:5432/nyayamitra" >> .env

# Run database migrations
python manage.py makemigrations
python manage.py migrate

# Start the server
python manage.py runserver

### 2. Frontend Setup (Flutter)
# Open a new terminal and navigate to the frontend folder
cd Nyaya-Mitra/frontend

# Fetch Flutter packages
flutter pub get

# Run the app
flutter run

🔒 Security Note
This application utilizes sensitive API keys and database credentials. Never commit the .env file to version control. Ensure .env is listed in your .gitignore before pushing any code