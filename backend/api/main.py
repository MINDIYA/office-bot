import os
import base64
import tempfile
import re
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional

# --- CHANGED IMPORTS ---
from langchain_community.document_loaders import PyMuPDFLoader # Best for Page Numbers
from langchain_openai import ChatOpenAI
from langchain_ollama import OllamaEmbeddings
from langchain_chroma import Chroma
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_community.retrievers import BM25Retriever
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser
import edge_tts

# --- PATHS ---
CURRENT_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.abspath(os.path.join(CURRENT_SCRIPT_DIR, "../../"))
DB_STORAGE_PATH = os.path.join(PROJECT_ROOT, "db_storage")
SOURCE_DOCS_PATH = os.path.join(PROJECT_ROOT, "source_documents")

os.makedirs(DB_STORAGE_PATH, exist_ok=True)
os.makedirs(SOURCE_DOCS_PATH, exist_ok=True)

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# --- 1. CONFIGURATION ---
text_llm = ChatOpenAI(
    base_url="http://127.0.0.1:11434/v1",
    api_key="EMPTY",
    model="llama3.1",
    temperature=0,
    model_kwargs={"extra_body": {"num_ctx": 8192}} 
)

ensemble_retriever = None

# --- 2. AUDIO CLEANER ---
def clean_for_audio(text: str) -> str:
    # Remove the citation brackets like (Doc.pdf, Page 2) for audio
    text = re.sub(r'\([^\)]+\.pdf, Page \d+\)', '', text)
    text = re.sub(r'[*#`_~]', '', text)
    text = re.sub(r'[^\w\s,!.?\'"]', '', text)
    text = re.sub(r'\s+', ' ', text).strip()
    return text

async def generate_audio(text: str):
    spoken_text = clean_for_audio(text)
    try:
        communicate = edge_tts.Communicate(spoken_text, "en-US-AndrewNeural")
        with tempfile.NamedTemporaryFile(delete=False, suffix=".mp3") as tmp:
            await communicate.save(tmp.name)
            with open(tmp.name, "rb") as f:
                return base64.b64encode(f.read()).decode("utf-8")
    except: return None

# --- 3. SMALL TALK ---
def handle_small_talk(query: str):
    q = query.lower().strip()
    if re.fullmatch(r'(hi|hello|hey|yo|good morning|good afternoon)', q):
        return "Hello! I am your Corporate Assistant. How can I help you?"
    if re.search(r'how.*(are you|about you|doing|is it going|about today|your day)', q):
        if "process" not in q and "onbord" not in q:
            return "I am fully operational. What would you like to know?"
    return None

# --- 4. DATA INGESTION (UPDATED FOR PAGES) ---
def ingest_documents():
    global ensemble_retriever
    print(f"\n📂 Loading Documents: {SOURCE_DOCS_PATH}")
    files = [f for f in os.listdir(SOURCE_DOCS_PATH) if f.endswith(".pdf")]
    
    if not files:
        print("⚠️ No PDFs found.")
        return

    embeddings = OllamaEmbeddings(model="nomic-embed-text")
    vectorstore = Chroma(persist_directory=DB_STORAGE_PATH, embedding_function=embeddings)
    
    if vectorstore._collection.count() == 0:
        print("⚡ Indexing Documents with Page Numbers...")
        
        all_chunks = []
        char_splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=200)

        for filename in files:
            file_path = os.path.join(SOURCE_DOCS_PATH, filename)
            try:
                print(f"   📖 Reading: {filename}")
                
                # CHANGED: Using PyMuPDFLoader to capture Page Numbers automatically
                loader = PyMuPDFLoader(file_path)
                raw_docs = loader.load()
                
                # Split the docs
                chunks = char_splitter.split_documents(raw_docs)
                
                # Ensure metadata is clean
                for chunk in chunks:
                    chunk.metadata["source"] = filename
                    # PyMuPDF adds 'page' (int) to metadata automatically
                    # We can try to extract a section header if it exists in the first line
                    first_line = chunk.page_content.split('\n')[0]
                    section_name = first_line if len(first_line) < 50 else "General Section"
                    chunk.metadata["section"] = section_name

                all_chunks.extend(chunks)
            except Exception as e:
                print(f"   ❌ Error reading {filename}: {e}")

        if all_chunks:
            vectorstore.add_documents(all_chunks)

    all_docs = vectorstore.get()['documents']
    if all_docs:
        print("⚖️ Balancing Search Engine...")
        bm25 = BM25Retriever.from_texts(all_docs)
        bm25.k = 5
        chroma = vectorstore.as_retriever(search_kwargs={"k": 5})
        
        class UniversalRetriever:
            def invoke(self, query):
                # We return actual Document objects here
                return chroma.invoke(query) + bm25.invoke(query)
                
        ensemble_retriever = UniversalRetriever()
        print("🚀 UNIVERSAL BOT ONLINE.")

ingest_documents()

# --- 5. SMART QUERY CLEANER ---
query_refiner_prompt = ChatPromptTemplate.from_template("""
You are a Query Corrector.
1. Fix spelling errors (e.g. "onbord" -> "onboarding").
2. Clarify questions.
User Input: {question}
Corrected Input:
""")
query_refiner = query_refiner_prompt | text_llm | StrOutputParser()

# --- 6. CHAT LOGIC ---
class ChatRequest(BaseModel):
    question: str
    history: Optional[List[str]] = []

@app.post("/chat")
async def chat(req: ChatRequest):
    small_talk = handle_small_talk(req.question)
    if small_talk:
        audio = await generate_audio(small_talk)
        return {"answer": small_talk, "audio": audio}

    if not ensemble_retriever: return {"answer": "Please upload a document."}

    # 1. Refine
    clean_question = await query_refiner.ainvoke({"question": req.question})
    print(f"🔍 Refined Search: '{clean_question}'")

    # 2. Search & Format Context
    docs = ensemble_retriever.invoke(clean_question)
    
    # CHANGED: Inject Metadata into the Context String for the LLM
    formatted_context_list = []
    for d in docs:
        # Check if it's a Chroma Document or BM25 String
        if hasattr(d, 'metadata'):
            source = d.metadata.get('source', 'Unknown Doc')
            page = d.metadata.get('page', 0) + 1 # PyMuPDF is 0-indexed, so we add 1
            section = d.metadata.get('section', 'General')
            content = d.page_content
            # We wrap the content with its specific metadata tag
            formatted_context_list.append(f"Content: {content}\n[Metadata: Document='{source}', Page={page}, Section='{section}']")
        else:
            formatted_context_list.append(d) # Fallback for string-only retrievers

    context_text = "\n---\n".join(formatted_context_list)
    history_text = "\n".join(req.history) if req.history else "No previous chat."

    # 3. Final Prompt (Clean Westminster Style)
    prompt = ChatPromptTemplate.from_template("""
    You are a Corporate Assistant.
    
    ### RULES:
    1. **Direct Answers Only:** Answer the user's question directly as if you are stating facts. 
       - ❌ DO NOT say: "According to the document...", "The document titled X says...", or "As outlined in..."
       - ✅ DO say: "The Internal Code of Business Conduct addresses conflicts of interest..."
       
    2. **Content First:** Do NOT include any inline citations or brackets in the main text.
    
    3. **Reference List (Westminster Style):**
       At the very bottom, leave two blank lines and add a "References" section.
       Format:
       **References:**
       * [Author/Company]. ([Year]). *[Document Name]*. [Page Number], [Section Name].
       
       (Use "CDB PLC" as author and "n.d." if date is unknown).
    
    ### DOCUMENT CONTEXT:
    {c}
    
    ### USER QUESTION: 
    {q}
    
    ### ANSWER:
    """)
    
    chain = prompt | text_llm | StrOutputParser()
    
    answer = await chain.ainvoke({
        "c": context_text, 
        "q": clean_question, 
        "h": history_text 
    })
    
    audio = await generate_audio(answer)
    
    return {"answer": answer, "audio": audio}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)