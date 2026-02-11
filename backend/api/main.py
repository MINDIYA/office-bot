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
    temperature=0.1, # Slightly increased for fluency in long responses
    model_kwargs={"extra_body": {"num_ctx": 8192}} 
)

ensemble_retriever = None

# --- 2. AUDIO CLEANER ---
def clean_for_audio(text: str) -> str:
    # Remove citations and markdown for TTS
    text = re.sub(r'\([^\)]+\.pdf, Page \d+\)', '', text)
    text = re.sub(r'\*\*References:\*\*.*', '', text, flags=re.DOTALL) # Cut off references for audio
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
        return "Hello. I am your Corporate Knowledge Assistant. Please state your inquiry regarding company policy or documentation."
    if re.search(r'how.*(are you|about you|doing|is it going)', q):
        if "process" not in q and "onbord" not in q:
            return "Systems are fully operational. I am ready to process your query."
    return None

# --- 4. DATA INGESTION ---
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
                loader = PyMuPDFLoader(file_path)
                raw_docs = loader.load()
                
                chunks = char_splitter.split_documents(raw_docs)
                for chunk in chunks:
                    chunk.metadata["source"] = filename
                    # Extract section or use default
                    first_line = chunk.page_content.split('\n')[0]
                    section_name = first_line[:50] if len(first_line) > 3 else "General Section"
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
                return chroma.invoke(query) + bm25.invoke(query)
                
        ensemble_retriever = UniversalRetriever()
        print("🚀 UNIVERSAL BOT ONLINE.")

ingest_documents()

# --- 5. QUERY REFINER ---
query_refiner_prompt = ChatPromptTemplate.from_template("""
You are a Query Standardization Engine.
1. Correct spelling (e.g., "polcy" -> "policy").
2. Expand acronyms if standard (e.g., "HR" -> "Human Resources").
3. Output ONLY the refined query string.
User Input: {question}
Refined Output:
""")
query_refiner = query_refiner_prompt | text_llm | StrOutputParser()

# --- 6. CHAT LOGIC WITH "MEGA-PROMPT" ---
class ChatRequest(BaseModel):
    question: str
    history: Optional[List[str]] = []

@app.post("/chat")
async def chat(req: ChatRequest):
    # Check small talk
    small_talk = handle_small_talk(req.question)
    if small_talk:
        audio = await generate_audio(small_talk)
        return {"answer": small_talk, "audio": audio}

    if not ensemble_retriever: 
        return {"answer": "System initialization incomplete. Please upload source documentation."}

    # 1. Refine Query
    clean_question = await query_refiner.ainvoke({"question": req.question})
    print(f"🔍 Refined Search: '{clean_question}'")

    # 2. Retrieve & Metadata Injection
    docs = ensemble_retriever.invoke(clean_question)
    formatted_context_list = []
    
    for d in docs:
        if hasattr(d, 'metadata'):
            source = d.metadata.get('source', 'Unknown Document')
            page = d.metadata.get('page', 0) + 1
            section = d.metadata.get('section', 'General')
            content = d.page_content.replace("\n", " ")
            # Strict XML-style wrapping for the LLM to parse easily
            formatted_context_list.append(
                f"<doc><meta source='{source}' page='{page}' section='{section}'/>"
                f"<content>{content}</content></doc>"
            )
        else:
            formatted_context_list.append(f"<doc><content>{d}</content></doc>")

    context_text = "\n".join(formatted_context_list)
    history_text = "\n".join(req.history) if req.history else "None."

    # 3. THE "MEGA-PROMPT" (approx. 1000 words of instruction logic)
    # We use a raw string literal to allow for extensive instructions.
    
    SYSTEM_INSTRUCTIONS = """
    You are the **Senior Corporate Compliance & Information Officer**. 
    Your mandate is to provide strictly factual, legally sound, and document-backed responses based *solely* on the provided context.
    
    ================================================================================
    **SECTION 1: CORE OPERATIONAL DIRECTIVES**
    ================================================================================
    1. **Absolute Truth Protocol:** You must derive 100% of your answer from the `<doc>` tags provided in the context. If the answer is not explicitly stated in the text, you must state: "The provided documentation does not contain information regarding [specific topic]." Do not halluncinate, do not guess, and do not use outside knowledge.
    
    2. **Tone & Persona:** - Your tone is professional, executive, and objective. 
       - Avoid conversational filler (e.g., "Sure!", "I think", "It seems"). 
       - Speak with authority. Do not say "According to the document..."; instead, state the fact directly (e.g., "Employees must submit Form A by 5 PM").
    
    3. **Structure:**
       - **Summary:** Begin with a direct, 1-2 sentence answer to the core question.
       - **Details:** Use bullet points for lists, conditions, or steps.
       - **References:** Always conclude with a citations section.
    
    ================================================================================
    **SECTION 2: FORMATTING STANDARDS**
    ================================================================================
    - **Markdown:** Use **bold** for key terms or deadlines. Use `> blockquotes` for verbatim policy text.
    - **Lists:** Use unordered lists (-) for non-sequential items and ordered lists (1.) for procedures.
    - **Clarity:** Break long paragraphs into digestible chunks.
    
    ================================================================================
    **SECTION 3: CITATION PROTOCOL (STRICT WESTMINSTER STYLE)**
    ================================================================================
    You are required to append a reference list at the very bottom of your response. 
    You must extract the `source`, `page`, and `section` attributes from the `<meta>` tags in the context.
    
    **Rules for Main Text:**
    - Do NOT put citations (e.g., [Doc1, p.2]) inside the sentences. Keep the reading flow smooth.
    
    **Rules for Reference Section:**
    - Leave two blank lines after the answer.
    - Title the section strictly as "**References:**".
    - Format every used source exactly as follows:
      `* [Author/Organization]. (n.d.). *[Document Filename]*. [Page Number], [Section Name].`
    - If the author is unknown, use "CDB PLC" or "Corporate Policy" as the default author.
    - Deduplicate references. If multiple facts come from the same page of the same doc, list it once.
    
    ================================================================================
    **SECTION 4: NEGATIVE CONSTRAINTS (DO NOT DO)**
    ================================================================================
    - **NO** Apologies: Never say "I'm sorry, but...". Just state the limitation.
    - **NO** Meta-Commentary: Do not say "I found this in the text."
    - **NO** Preachiness: Do not add moralizing language (e.g., "It is important to follows rules").
    - **NO** HTML/JSON output: Output pure Markdown text only.
    
    ================================================================================
    **SECTION 5: EDGE CASE HANDLING**
    ================================================================================
    - **Conflict:** If two documents contradict each other, explicitly note the discrepancy: "Document A states X, whereas Document B states Y."
    - **Ambiguity:** If the user asks a vague question (e.g., "Tell me about the policy"), summarize the most relevant section found in the context.
    - **Irrelevance:** If the context provided contains nothing relevant to the user query, return *only* this exact phrase: "Information unavailable in current repository."
    
    ================================================================================
    **SECTION 6: FINAL OUTPUT CONSTRUCTION**
    ================================================================================
    Step 1: Analyze the User Question.
    Step 2: Scan `DOCUMENT CONTEXT` for keywords.
    Step 3: Synthesize facts into a coherent narrative.
    Step 4: Extract metadata for the footer.
    Step 5: Render final Markdown.
    
    """
    
    prompt = ChatPromptTemplate.from_template(
        SYSTEM_INSTRUCTIONS + 
        """
        
        ### DOCUMENT CONTEXT:
        {c}
        
        ### CONVERSATION HISTORY:
        {h}
        
        ### USER QUESTION: 
        {q}
        
        ### YOUR RESPONSE:
        """
    )
    
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