import os
import base64
import tempfile
import re
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional

# --- IMPORTS ---
from langchain_community.document_loaders import PyMuPDFLoader
from langchain_openai import ChatOpenAI
# NEW: HuggingFace Embeddings (Runs on CPU, perfect for Cloud)
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_chroma import Chroma
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_community.retrievers import BM25Retriever
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser
import edge_tts

# --- PATHS ---
CURRENT_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.abspath(os.path.join(CURRENT_SCRIPT_DIR, "../../"))
# Note: In cloud, you might need to change DB_STORAGE_PATH to /tmp or a persistent volume
DB_STORAGE_PATH = os.path.join(PROJECT_ROOT, "db_storage")
SOURCE_DOCS_PATH = os.path.join(PROJECT_ROOT, "source_documents")

os.makedirs(DB_STORAGE_PATH, exist_ok=True)
os.makedirs(SOURCE_DOCS_PATH, exist_ok=True)

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# --- 1. CONFIGURATION ---

if "GITHUB_TOKEN" not in os.environ:
    # For cloud, ensure this var is set in your Deployment Settings (e.g. Heroku Config Vars)
    print("WARNING: GITHUB_TOKEN not found. App may fail.")

# [CLOUD] Brain: GitHub Models (GPT-5)
text_llm = ChatOpenAI(
    base_url="https://models.github.ai/inference/v1",
    api_key=os.environ.get("GITHUB_TOKEN"),
    model="gpt-4o", 
    temperature=0.1,
)

# [CLOUD] Memory: HuggingFace (Local CPU)
# This downloads a small efficient model (80MB) that runs inside the cloud container.
# No external API key needed for this part.
print("📥 Initializing Embedding Model (all-MiniLM-L6-v2)...")
embeddings = HuggingFaceEmbeddings(model_name="all-MiniLM-L6-v2")

ensemble_retriever = None

# --- 2. AUDIO CLEANER ---
def clean_for_audio(text: str) -> str:
    text = re.sub(r'\([^\)]+\.pdf, Page \d+\)', '', text)
    text = re.sub(r'\*\*References:\*\*.*', '', text, flags=re.DOTALL)
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

# --- 3. DATA INGESTION ---
def ingest_documents():
    global ensemble_retriever
    print(f"\n📂 Loading Documents: {SOURCE_DOCS_PATH}")
    
    if not os.path.exists(SOURCE_DOCS_PATH):
        print("⚠️ Source Docs path does not exist.")
        return

    files = [f for f in os.listdir(SOURCE_DOCS_PATH) if f.endswith(".pdf")]
    
    if not files:
        print("⚠️ No PDFs found.")
        return

    # Initialize Vector DB
    vectorstore = Chroma(persist_directory=DB_STORAGE_PATH, embedding_function=embeddings)
    
    # Check if we need to index
    if vectorstore._collection.count() == 0:
        print("⚡ Indexing Documents (HuggingFace CPU)...")
        all_chunks = []
        char_splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=200)

        for filename in files:
            file_path = os.path.join(SOURCE_DOCS_PATH, filename)
            try:
                print(f"   📖 Reading: {filename}")
                loader = PyMuPDFLoader(file_path)
                raw_docs = loader.load()
                
                chunks = char_splitter.split_documents(raw_docs)
                for chunk in chunks:
                    chunk.metadata["source"] = filename
                    first_line = chunk.page_content.split('\n')[0]
                    section_name = first_line[:50] if len(first_line) > 3 else "General Section"
                    chunk.metadata["section"] = section_name

                all_chunks.extend(chunks)
            except Exception as e:
                print(f"   ❌ Error reading {filename}: {e}")

        if all_chunks:
            vectorstore.add_documents(all_chunks)
            print("✅ Indexing Complete.")

    all_docs = vectorstore.get()['documents']
    if all_docs:
        print("⚖️ Balancing Search Engine...")
        bm25 = BM25Retriever.from_texts(all_docs)
        bm25.k = 5
        chroma = vectorstore.as_retriever(search_kwargs={"k": 5})
        
        class UniversalRetriever:
            def invoke(self, query):
                return chroma.invoke(query) + bm25.invoke(query)
                
        ensemble_retriever = UniversalRetriever()
        print("🚀 UNIVERSAL BOT ONLINE (Cloud Ready).")

ingest_documents()

# --- 4. CHAT LOGIC ---
class ChatRequest(BaseModel):
    question: str
    history: Optional[List[str]] = []

@app.post("/chat")
async def chat(req: ChatRequest):
    if not ensemble_retriever: 
        return {"answer": "System initialization incomplete. Documents not loaded."}

    # 1. Retrieve Context
    docs = ensemble_retriever.invoke(req.question)
    formatted_context_list = []
    
    for d in docs:
        if hasattr(d, 'metadata'):
            source = d.metadata.get('source', 'Unknown')
            page = d.metadata.get('page', 0) + 1
            section = d.metadata.get('section', 'General')
            content = d.page_content.replace("\n", " ")
            formatted_context_list.append(
                f"<doc><meta source='{source}' page='{page}' section='{section}'/><content>{content}</content></doc>"
            )

    context_text = "\n".join(formatted_context_list)
    
    # 2. PROMPT
    SYSTEM_INSTRUCTIONS = """
    You are the **Senior Corporate Compliance Officer**.
    Answer strictly based on the provided context.
    
    Structure:
    - **Summary:** Direct answer.
    - **Details:** Bullet points.
    - **References:** Cite the source documents.
    """
    
    prompt = ChatPromptTemplate.from_template(
        SYSTEM_INSTRUCTIONS + "\n\nContext:\n{c}\n\nQuestion: {q}\nResponse:"
    )
    
    chain = prompt | text_llm | StrOutputParser()
    
    answer = await chain.ainvoke({"c": context_text, "q": req.question})
    audio = await generate_audio(answer)
    
    return {"answer": answer, "audio": audio}

if __name__ == "__main__":
    import uvicorn
    # 0.0.0.0 is required for Cloud Hosting
    uvicorn.run(app, host="0.0.0.0", port=8000)