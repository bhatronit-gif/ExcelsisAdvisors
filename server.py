# server.py
import os
import json
import sqlite3
from datetime import datetime
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="Excelsis Audit Server", version="2.0")

# Enable CORS so local HTML file can fetch from http://localhost:8000 or custom host
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DATABASE_URL = os.environ.get("DATABASE_URL")
IS_POSTGRES = DATABASE_URL is not None
PLACEHOLDER = "%s" if IS_POSTGRES else "?"

# Database Connection Router
def get_db_connection():
    if IS_POSTGRES:
        import psycopg2
        return psycopg2.connect(DATABASE_URL)
    else:
        DATABASE_DIR = "/data" if os.path.exists("/data") else "."
        DATABASE_FILE = os.path.join(DATABASE_DIR, "audit_database.db")
        return sqlite3.connect(DATABASE_FILE)

# Initialize database schema dynamically with automated migrations
def init_db():
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Check if table schema is outdated (does not have filename column)
    schema_outdated = False
    try:
        cursor.execute("SELECT filename FROM audits LIMIT 1")
        cursor.fetchone()
    except Exception:
        # Table exists but fails when selecting filename => schema outdated
        schema_outdated = True
        
    if schema_outdated:
        print("Upgrading database: Dropping old schema to apply filename & auditor separation...")
        cursor.execute("DROP TABLE IF EXISTS audits")
        conn.commit()
        
    if IS_POSTGRES:
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS audits (
                id SERIAL PRIMARY KEY,
                filename TEXT,
                school TEXT,
                auditor TEXT,
                date TEXT,
                score REAL,
                audit_data TEXT,
                last_updated TEXT,
                UNIQUE(filename, auditor)
            )
        """)
    else:
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS audits (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                filename TEXT,
                school TEXT,
                auditor TEXT,
                date TEXT,
                score REAL,
                audit_data TEXT,
                last_updated TEXT,
                UNIQUE(filename, auditor)
            )
        """)
    conn.commit()
    conn.close()

init_db()

# Pydantic schema for audit payloads
class AuditPayload(BaseModel):
    filename: str
    school: str
    auditor: str
    date: str
    score: float
    audit_data: dict

@app.get("/")
def read_root():
    db_type = "PostgreSQL (Cloud)" if IS_POSTGRES else "SQLite (Local File)"
    return {"status": "Excelsis Audit Server is running", "database_type": db_type}

# Get list of all saved audits for a specific auditor (auditor separation)
@app.get("/api/history")
def get_history(auditor: str):
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        if auditor == "Superadmin":
            query = """
                SELECT filename, school, auditor, date, score, last_updated 
                FROM audits 
                ORDER BY last_updated DESC
            """
            cursor.execute(query)
        else:
            query = f"""
                SELECT filename, school, auditor, date, score, last_updated 
                FROM audits 
                WHERE auditor = {PLACEHOLDER}
                ORDER BY last_updated DESC
            """
            cursor.execute(query, (auditor,))
        rows = cursor.fetchall()
        conn.close()
        
        history = []
        for r in rows:
            history.append({
                "filename": r[0],
                "school": r[1],
                "auditor": r[2],
                "date": r[3],
                "score": r[4],
                "last_updated": r[5]
            })
        return history
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Save or update an audit (upsert by filename and auditor)
@app.post("/api/save")
def save_audit(payload: AuditPayload):
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        data_json = json.dumps(payload.audit_data)
        
        query = f"""
            INSERT INTO audits (filename, school, auditor, date, score, audit_data, last_updated)
            VALUES ({PLACEHOLDER}, {PLACEHOLDER}, {PLACEHOLDER}, {PLACEHOLDER}, {PLACEHOLDER}, {PLACEHOLDER}, {PLACEHOLDER})
            ON CONFLICT(filename, auditor) DO UPDATE SET
                school=EXCLUDED.school,
                date=EXCLUDED.date,
                score=EXCLUDED.score,
                audit_data=EXCLUDED.audit_data,
                last_updated=EXCLUDED.last_updated
        """
        cursor.execute(query, (payload.filename, payload.school, payload.auditor, payload.date, payload.score, data_json, now_str))
        conn.commit()
        conn.close()
        return {"status": "success", "message": f"Audit file '{payload.filename}' saved successfully."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Load a specific audit record
@app.get("/api/load")
def load_audit(filename: str, auditor: str):
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        query = f"""
            SELECT school, date, score, audit_data 
            FROM audits 
            WHERE filename = {PLACEHOLDER} AND auditor = {PLACEHOLDER}
        """
        cursor.execute(query, (filename, auditor))
        row = cursor.fetchone()
        conn.close()
        
        if not row:
            raise HTTPException(status_code=404, detail="Audit file not found")
            
        return {
            "school": row[0],
            "date": row[1],
            "score": row[2],
            "audit_data": json.loads(row[3])
        }
    except Exception as e:
        if isinstance(e, HTTPException):
            raise e
        raise HTTPException(status_code=500, detail=str(e))

# Delete a specific audit record
@app.delete("/api/delete")
def delete_audit(filename: str, auditor: str):
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        query = f"""
            DELETE FROM audits 
            WHERE filename = {PLACEHOLDER} AND auditor = {PLACEHOLDER}
        """
        cursor.execute(query, (filename, auditor))
        conn.commit()
        deleted_count = cursor.rowcount
        conn.close()
        
        if deleted_count == 0:
            raise HTTPException(status_code=404, detail="Audit record not found to delete")
            
        return {"status": "success", "message": f"Audit file '{filename}' deleted."}
    except Exception as e:
        if isinstance(e, HTTPException):
            raise e
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server:app", host="127.0.0.1", port=8000, reload=True)
