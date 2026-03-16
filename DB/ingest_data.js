require('dotenv').config();
const { Pool } = require('pg');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// 1. Initialize APIs
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const DATASET_SOURCE = 'IndicLegalQA'; 
const DOCUMENT_TYPE = 'Supreme Court Q&A';

// 2. Hardcoded Dummy Data (Bypassing the CSV file completely!)
const dummyData = [
    { Question: "Can I be evicted without notice?", Answer: "No, the Rent Control Act requires a legal 30-day notice." },
    { Question: "Is a verbal agreement valid?", Answer: "Yes, under the Indian Contract Act, oral agreements are valid but hard to prove." }
];

async function runDirectInjectionTest() {
    console.log("Starting Direct Injection Test...");
    
    for (let i = 0; i < dummyData.length; i++) {
        const row = dummyData[i];
        const combinedText = `Question: ${row.Question}\nAnswer: ${row.Answer}`;
        
        try {
            // A. Get the vector from Gemini
            const model = genAI.getGenerativeModel({ model: "gemini-embedding-001" });
            const result = await model.embedContent(combinedText);
            const embeddingVector = result.embedding.values; 
            
            // B. Format for Database
            const vectorString = `[${embeddingVector.join(',')}]`;
            
            // C. Insert into Database
            const query = `
    INSERT INTO legal_knowledge_base 
    (dataset_source, document_type, content_text, embedding) 
    VALUES ($1, $2, $3, $4::halfvec)
`;
            const values = [DATASET_SOURCE, DOCUMENT_TYPE, combinedText, vectorString];
            
            await pool.query(query, values);
            console.log(`✅ Successfully vectorized and inserted row ${i + 1}`);
            
        } catch (error) {
            console.error(`❌ Error on row ${i + 1}:`, error.message);
        }
        
        // Wait 500ms for API limits
        await new Promise(resolve => setTimeout(resolve, 500)); 
    }
    
    console.log("Test finished! Go check Supabase.");
    process.exit(0);
}

// Run the function
runDirectInjectionTest();
// Run the script with your downloaded Kaggle dataset
//processDataset('./indic_legal_qa_dataset.csv');